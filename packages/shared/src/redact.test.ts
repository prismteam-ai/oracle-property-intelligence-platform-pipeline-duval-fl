/**
 * Offline unit tests for the PII redaction used by the API logger and any evidence that leaves the
 * server (design §8). No DB, no network — safe for the CI green-gate.
 * Run: node --import tsx --test packages/shared/src/redact.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { redactForLog, isPiiKey } from "./redact.ts";

test("isPiiKey: owner-identifying keys are PII, case-insensitive; public keys are not", () => {
  assert.equal(isPiiKey("owner_name"), true);
  assert.equal(isPiiKey("Owner_Mailing_Address"), true);
  assert.equal(isPiiKey("email"), true);
  assert.equal(isPiiKey("folio"), false);
  assert.equal(isPiiKey("situs_address"), false);
});

test("redactForLog: masks PII values but keeps their shape and all non-PII fields", () => {
  const out = redactForLog({
    folio: "0004781100",
    owner_name: "JANE Q PUBLIC",
    mailing_address: "123 Main St, Nashville, TN",
    property_usage_type: "Retail store",
  }) as { folio: string; owner_name: string; mailing_address: string; property_usage_type: string };

  assert.equal(out.folio, "0004781100");
  assert.equal(out.property_usage_type, "Retail store");
  // masked, and the raw value must not survive anywhere in the marker
  assert.match(out.owner_name, /^‹redacted:\d+c›$/);
  assert.ok(!out.owner_name.includes("PUBLIC"));
  assert.ok(!out.mailing_address.includes("Nashville"));
});

test("redactForLog: recurses into nested owner objects/arrays", () => {
  const out = redactForLog({
    ownerships: [{ folio: "1", owner_name: "SECRET OWNER" }],
  }) as { ownerships: Array<{ folio: string; owner_name: string }> };
  assert.equal(out.ownerships[0]!.folio, "1");
  assert.ok(!out.ownerships[0]!.owner_name.includes("SECRET"));
});
