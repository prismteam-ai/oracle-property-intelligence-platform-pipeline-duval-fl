import { describe, expect, it } from "vitest";

import { clientKey, rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit and refuses the next call", () => {
    const key = "test:allow";
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit(key, { limit: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
    const over = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("starts a fresh window once the old one expires", async () => {
    const key = "test:expiry";
    expect(rateLimit(key, { limit: 1, windowMs: 10 }).allowed).toBe(true);
    expect(rateLimit(key, { limit: 1, windowMs: 10 }).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(rateLimit(key, { limit: 1, windowMs: 10 }).allowed).toBe(true);
  });

  it("keeps separate budgets per key and per scope", () => {
    expect(rateLimit("a:1", { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
    expect(rateLimit("b:1", { limit: 1, windowMs: 60_000 }).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientKey(h, "agent")).toBe("agent:203.0.113.7");
  });

  it("falls back to x-real-ip, then to a shared bucket", () => {
    expect(clientKey(new Headers({ "x-real-ip": "198.51.100.4" }), "mcp")).toBe(
      "mcp:198.51.100.4",
    );
    expect(clientKey(new Headers(), "mcp")).toBe("mcp:unknown");
  });
});
