import { describe, expect, it } from "vitest";
import { newRunId, recordHash } from "./runner.ts";

describe("newRunId", () => {
  it("encodes the UTC timestamp to the second and stops before the millisecond separator", () => {
    const id = newRunId(new Date("2026-08-20T19:57:28.123Z"));
    expect(id).toBe(id.slice(0, 22) + id.slice(22));
    expect(id.startsWith("run-20260820195728-")).toBe(true);
  });

  it("contains no characters that need URL escaping", () => {
    const id = newRunId(new Date("2026-01-02T03:04:05.678Z"));
    expect(id).toMatch(/^run-\d{14}-[0-9a-f]{6}$/);
    expect(encodeURIComponent(id)).toBe(id);
  });

  it("does not collide within the same second", () => {
    const at = new Date("2026-08-20T19:57:28.000Z");
    const ids = new Set(Array.from({ length: 200 }, () => newRunId(at)));
    expect(ids.size).toBe(200);
  });
});

describe("recordHash", () => {
  it("is stable across key ordering", () => {
    expect(recordHash({ a: 1, b: "x" })).toBe(recordHash({ b: "x", a: 1 }));
  });

  it("treats undefined and null as the same absent value", () => {
    expect(recordHash({ a: 1, b: undefined })).toBe(
      recordHash({ a: 1, b: null }),
    );
  });

  it("changes when any value changes", () => {
    expect(recordHash({ a: 1 })).not.toBe(recordHash({ a: 2 }));
  });

  it("distinguishes the number 1 from the string '1'", () => {
    expect(recordHash({ a: 1 })).not.toBe(recordHash({ a: "1" }));
  });

  it("returns a 64-character hex digest", () => {
    expect(recordHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
