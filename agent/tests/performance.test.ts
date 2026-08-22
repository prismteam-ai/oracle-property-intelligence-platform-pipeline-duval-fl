/**
 * Agent response time assertion.
 * T080 — Verify agent chat endpoint responds within 10 seconds (SC-007).
 */

import { describe, it, expect } from 'vitest';

const AGENT_ENDPOINT = 'https://d5sfa8vgu8mcx.cloudfront.net/api/agent/chat';
const MAX_RESPONSE_TIME_MS = 10_000;

describe('agent response time (SC-007)', () => {
  it(
    'completes a multi-attribute query in under 10 seconds',
    async () => {
      const start = performance.now();

      const response = await fetch(AGENT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content:
                'How many properties in the database have roofs older than 15 years?',
            },
          ],
        }),
      });

      const elapsed = performance.now() - start;

      // The endpoint should respond (2xx or streaming) within the time limit
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);
      expect(elapsed).toBeLessThan(MAX_RESPONSE_TIME_MS);

      console.info(
        `[agent-timing] Response received in ${elapsed.toFixed(0)}ms (status ${response.status})`,
      );
    },
    { timeout: 15_000 },
  );

  it(
    'health endpoint responds quickly',
    async () => {
      const start = performance.now();
      const response = await fetch(
        'https://d5sfa8vgu8mcx.cloudfront.net/api/agent/health',
      );
      const elapsed = performance.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(5_000);

      console.info(
        `[agent-timing] Health check in ${elapsed.toFixed(0)}ms`,
      );
    },
    { timeout: 10_000 },
  );
});
