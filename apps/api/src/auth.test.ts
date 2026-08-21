/**
 * Offline unit tests for the constant-time bearer-token comparison (no DB, no network, no secrets),
 * so this is safe as part of the CI green-gate. Run: node --import tsx --test apps/api/src/auth.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeTokenEqual } from "./auth.ts";

const TOKEN = "example-access-token-0123456789";

test("safeTokenEqual: exact match is accepted", () => {
  assert.equal(safeTokenEqual(TOKEN, TOKEN), true);
});

test("safeTokenEqual: any mismatch is rejected", () => {
  assert.equal(safeTokenEqual(TOKEN, TOKEN + "x"), false);
  assert.equal(safeTokenEqual(TOKEN.slice(0, -1) + "0", TOKEN), false);
  assert.equal(safeTokenEqual("totally-different", TOKEN), false);
});

test("safeTokenEqual: length differences do not throw and are rejected", () => {
  assert.equal(safeTokenEqual("short", TOKEN), false);
  assert.equal(safeTokenEqual(TOKEN, "much-much-much-longer-than-the-real-token-value"), false);
});

test("safeTokenEqual: null / undefined / empty are rejected (no missing-token bypass)", () => {
  assert.equal(safeTokenEqual(null, TOKEN), false);
  assert.equal(safeTokenEqual(undefined, TOKEN), false);
  assert.equal(safeTokenEqual("", TOKEN), false);
  assert.equal(safeTokenEqual("", ""), false);
});
