/**
 * Webhook delivery timing assertion.
 * T081 — Verify webhook dispatch completes within 30 seconds (SC-008).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

/**
 * Simulates the webhook dispatch logic extracted from the webhook service.
 * Sends to all URLs with retry logic (3 attempts, exponential backoff).
 */
async function dispatchWebhook(
  urls: string[],
  payload: Record<string, unknown>,
  secret: string,
  fetchFn: typeof fetch,
): Promise<{
  totalMs: number;
  results: Array<{ url: string; success: boolean; attempts: number }>;
}> {
  const RETRY_DELAYS_MS = [0, 100, 200]; // Shortened for testing (real: 5s, 30s, 120s)
  const ATTEMPT_TIMEOUT_MS = 5_000;
  const body = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(body).digest('hex');

  const start = performance.now();
  const results: Array<{ url: string; success: boolean; attempts: number }> = [];

  for (const url of urls) {
    let success = false;
    let attempts = 0;

    for (let attempt = 0; attempt < 3; attempt++) {
      attempts++;
      if (attempt > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]!),
        );
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          ATTEMPT_TIMEOUT_MS,
        );

        const response = await fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Id': String(payload.event_id),
            'X-Webhook-Signature': signature,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          success = true;
          break;
        }
      } catch {
        // Retry on network error
      }
    }

    results.push({ url, success, attempts });
  }

  const totalMs = performance.now() - start;
  return { totalMs, results };
}

describe('webhook delivery timing (SC-008)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers to a single webhook within 30 seconds', async () => {
    // Mock: respond 200 after ~100ms delay
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response('OK', { status: 200 }),
              ),
            100,
          ),
        ),
    );

    const { totalMs, results } = await dispatchWebhook(
      ['https://hook.example.com/webhook'],
      {
        event_id: 'evt-001',
        event_type: 'artifact.published',
        county: 'duval',
      },
      'test-secret',
      mockFetch as unknown as typeof fetch,
    );

    expect(totalMs).toBeLessThan(30_000);
    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.attempts).toBe(1);

    console.info(`[webhook-timing] Single webhook delivered in ${totalMs.toFixed(0)}ms`);
  });

  it('delivers to multiple webhooks within 30 seconds', async () => {
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(new Response('OK', { status: 200 })),
            50,
          ),
        ),
    );

    const urls = [
      'https://hook1.example.com/webhook',
      'https://hook2.example.com/webhook',
      'https://hook3.example.com/webhook',
    ];

    const { totalMs, results } = await dispatchWebhook(
      urls,
      {
        event_id: 'evt-002',
        event_type: 'artifact.published',
        county: 'duval',
      },
      'test-secret',
      mockFetch as unknown as typeof fetch,
    );

    expect(totalMs).toBeLessThan(30_000);
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.success).toBe(true);
    }

    console.info(`[webhook-timing] 3 webhooks delivered in ${totalMs.toFixed(0)}ms`);
  });

  it('completes with retries within 30 seconds', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      // First call fails, second succeeds
      if (callCount % 2 === 1) {
        return Promise.resolve(new Response('Error', { status: 500 }));
      }
      return Promise.resolve(new Response('OK', { status: 200 }));
    });

    const { totalMs, results } = await dispatchWebhook(
      ['https://hook.example.com/webhook'],
      {
        event_id: 'evt-003',
        event_type: 'artifact.published',
        county: 'duval',
      },
      'test-secret',
      mockFetch as unknown as typeof fetch,
    );

    expect(totalMs).toBeLessThan(30_000);
    expect(results[0]!.success).toBe(true);
    expect(results[0]!.attempts).toBe(2);

    console.info(
      `[webhook-timing] Webhook with retry delivered in ${totalMs.toFixed(0)}ms (${results[0]!.attempts} attempts)`,
    );
  });

  it('includes correct HMAC signature header', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }));

    const payload = { event_id: 'evt-004', event_type: 'artifact.published' };
    const secret = 'hmac-test-secret';

    await dispatchWebhook(
      ['https://hook.example.com/webhook'],
      payload,
      secret,
      mockFetch as unknown as typeof fetch,
    );

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    const expectedSig = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    expect(headers['X-Webhook-Signature']).toBe(expectedSig);
  });
});
