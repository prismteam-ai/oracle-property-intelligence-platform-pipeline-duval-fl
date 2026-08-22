/**
 * Webhook dispatch service — sends HTTP POST notifications after publish.
 * T042 — POST to registered URLs, HMAC-SHA256 signature, retry 3x with backoff.
 *
 * Payload follows contracts/webhook-event.md.
 * Non-blocking: webhook failure does not fail the pipeline run.
 */

import * as restate from '@restatedev/restate-sdk';
import { createHmac, randomUUID } from 'node:crypto';
import type { WebhookEvent, DeltaCounts } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookDispatchRequest {
  runId: string;
  county: string;
  ipnsPointer: string;
  artifactCid: string;
  delta: DeltaCounts;
  newParcelIds?: string[];
  updatedParcelIds?: string[];
  removedParcelIds?: string[];
}

export interface WebhookDeliveryResult {
  url: string;
  success: boolean;
  statusCode: number | null;
  attempts: number;
  error: string | null;
  latencyMs: number;
}

export interface WebhookDispatchResult {
  eventId: string;
  deliveries: WebhookDeliveryResult[];
  totalSuccess: number;
  totalFailed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Retry backoff delays in milliseconds: 5s, 30s, 120s */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** Max attempts = initial + retries */
const MAX_ATTEMPTS = 3;

/** Timeout per attempt in milliseconds */
const ATTEMPT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get registered webhook URLs from environment.
 * Multiple URLs separated by commas.
 */
function getWebhookUrls(): string[] {
  const urls = process.env.WEBHOOK_URLS ?? '';
  return urls
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

/**
 * Get the webhook secret for HMAC signing.
 */
function getWebhookSecret(): string {
  return process.env.WEBHOOK_SECRET ?? '';
}

/**
 * Compute HMAC-SHA256 signature for a payload.
 */
function computeSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Build the webhook event payload.
 */
function buildEvent(eventId: string, request: WebhookDispatchRequest): WebhookEvent {
  return {
    event_id: eventId,
    event_type: 'artifact.published',
    county: request.county,
    run_id: request.runId,
    ipns_pointer: request.ipnsPointer,
    artifact_cid: request.artifactCid,
    timestamp: new Date().toISOString(),
    delta: {
      new_count: request.delta.new_count,
      updated_count: request.delta.updated_count,
      removed_count: request.delta.removed_count,
      new_parcel_ids: request.newParcelIds ?? [],
      updated_parcel_ids: request.updatedParcelIds ?? [],
      removed_parcel_ids: request.removedParcelIds ?? [],
    },
  };
}

/**
 * Send a single webhook POST to a URL with retries.
 */
async function deliverWebhook(
  url: string,
  body: string,
  signature: string,
  eventId: string,
): Promise<WebhookDeliveryResult> {
  const startTime = Date.now();
  let lastError: string | null = null;
  let lastStatusCode: number | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Wait for backoff before retry (skip on first attempt)
      if (attempt > 0) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 5_000;
        console.info(`[webhook] Retry ${attempt}/${MAX_ATTEMPTS} for ${url} after ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Id': eventId,
            'X-Webhook-Signature': signature,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatusCode = response.status;

        if (response.ok) {
          return {
            url,
            success: true,
            statusCode: response.status,
            attempts: attempt + 1,
            error: null,
            latencyMs: Date.now() - startTime,
          };
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
        console.warn(`[webhook] ${url} returned ${response.status} on attempt ${attempt + 1}`);
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastError = `Timeout after ${ATTEMPT_TIMEOUT_MS}ms`;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
      console.warn(`[webhook] ${url} attempt ${attempt + 1} failed: ${lastError}`);
    }
  }

  return {
    url,
    success: false,
    statusCode: lastStatusCode,
    attempts: MAX_ATTEMPTS,
    error: lastError,
    latencyMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Restate service: webhook
// ---------------------------------------------------------------------------

export const webhookService = restate.service({
  name: 'webhook',
  handlers: {
    /**
     * Dispatch webhook events to all registered URLs.
     * Non-blocking: individual failures are recorded but do not throw.
     */
    dispatch: async (
      ctx: restate.Context,
      request: WebhookDispatchRequest,
    ): Promise<WebhookDispatchResult> => {
      const urls = getWebhookUrls();
      const eventId = randomUUID();

      if (urls.length === 0) {
        console.info('[webhook] No webhook URLs configured, skipping dispatch');
        return {
          eventId,
          deliveries: [],
          totalSuccess: 0,
          totalFailed: 0,
        };
      }

      // Build event payload
      const event = buildEvent(eventId, request);
      const body = JSON.stringify(event);
      const secret = getWebhookSecret();
      const signature = computeSignature(body, secret);

      console.info(`[webhook] Dispatching event ${eventId} to ${urls.length} URL(s)`);

      // Deliver to each URL (sequentially to avoid overwhelming targets)
      const deliveries: WebhookDeliveryResult[] = [];

      for (const url of urls) {
        const result = await ctx.run(`deliver-${url}`, () =>
          deliverWebhook(url, body, signature, eventId),
        );
        deliveries.push(result);
      }

      const totalSuccess = deliveries.filter((d) => d.success).length;
      const totalFailed = deliveries.filter((d) => !d.success).length;

      console.info(
        `[webhook] Dispatch complete: ${totalSuccess} success, ${totalFailed} failed out of ${urls.length}`,
      );

      return {
        eventId,
        deliveries,
        totalSuccess,
        totalFailed,
      };
    },
  },
});

export type WebhookApi = typeof webhookService;
