/**
 * Offline unit tests for the pure (no DB, no network) helpers used across the enrichment stage.
 * Runs on the built-in Node test runner via tsx — no live Neon, no AWS, no secrets — so it is
 * safe as the CI green-gate (design §9). Run: node --import tsx --test enrich/pure.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxOf, haversineMeters, parseCsvLine, parseGtfsStops, round } from "./lib.ts";
import { parseUnnormalized, stripUnit } from "./geocode-permit-parcels.ts";
import { mailingFromPayload } from "./backfill-owner-mailing.ts";
import { bandLocality } from "./regional-owner.ts";
import { parseMailingLocality } from "./reload-owner-mailing.ts";

test("haversineMeters: zero distance for identical points", () => {
  assert.equal(haversineMeters(30.3, -81.6, 30.3, -81.6), 0);
});

test("haversineMeters: ~1.11 km per 0.01 deg of latitude", () => {
  const d = haversineMeters(30.0, -81.6, 30.01, -81.6);
  assert.ok(d > 1100 && d < 1120, `expected ~1111 m, got ${d}`);
});

test("round: rounds to given decimal places", () => {
  assert.equal(round(84.5678, 1), 84.6);
  assert.equal(round(84.5678, 0), 85);
});

test("parseCsvLine: honours quoted fields with commas and escaped quotes", () => {
  assert.deepEqual(parseCsvLine(`"1","9310 OLD KINGS RD, JACKSONVILLE, FL","Match"`), [
    "1",
    "9310 OLD KINGS RD, JACKSONVILLE, FL",
    "Match",
  ]);
  assert.deepEqual(parseCsvLine(`a,"b""c",d`), ["a", 'b"c', "d"]);
});

test("parseGtfsStops: keeps boarding stops, skips stations/entrances", () => {
  const csv = [
    "stop_id,stop_name,stop_lat,stop_lon,location_type",
    "S1,Main St,30.32,-81.65,0",
    "S2,Union Station,30.33,-81.66,1", // station -> skipped
    "S3,No Coords,,,0", // missing coords -> skipped
    "S4,Beach Blvd,30.30,-81.40,", // blank type -> kept
  ].join("\n");
  const stops = parseGtfsStops(csv);
  assert.equal(stops.length, 2);
  assert.deepEqual(
    stops.map((s) => s.stopId),
    ["S1", "S4"],
  );
});

test("bboxOf: bounds a point set and pads by the given degrees", () => {
  const b = bboxOf(
    [
      { lat: 30.1, lon: -81.7 },
      { lat: 30.4, lon: -81.5 },
    ],
    0.1,
  );
  assert.equal(round(b.south, 2), 30.0);
  assert.equal(round(b.north, 2), 30.5);
  assert.equal(round(b.west, 2), -81.8);
  assert.equal(round(b.east, 2), -81.4);
});

test("stripUnit: drops a trailing unit after a street suffix", () => {
  assert.equal(stripUnit("9310 S OLD KINGS RD 1101"), "9310 S OLD KINGS RD");
  assert.equal(stripUnit("537 PARK ST A"), "537 PARK ST");
  assert.equal(stripUnit("11555 CENTRAL PKWY 701"), "11555 CENTRAL PKWY");
});

test("stripUnit: keeps numbers that are part of the street name", () => {
  assert.equal(stripUnit("170 ARLINGTON RD"), "170 ARLINGTON RD"); // no trailing unit
  assert.equal(stripUnit("W US 90"), "W US 90"); // '90' not preceded by a suffix
});

test("parseUnnormalized: splits 'STREET, CITY, ST ZIP' and strips the unit", () => {
  assert.deepEqual(parseUnnormalized("9310 S OLD KINGS RD 1101, JACKSONVILLE, FL 32257"), {
    street: "9310 S OLD KINGS RD",
    city: "JACKSONVILLE",
    state: "FL",
    zip: "32257",
  });
});

test("parseUnnormalized: returns null when the state/zip tail is missing", () => {
  assert.equal(parseUnnormalized("JUST A STREET NAME"), null);
});

test("mailingFromPayload: pulls a mailing locality from generic keys", () => {
  assert.deepEqual(mailingFromPayload({ mailing_state: "GA", mailing_zip: "30301" }, "test"), {
    state: "GA",
    zip: "30301",
    city: null,
    county: null,
    source: "test",
  });
});

test("mailingFromPayload: names-only payload yields no locality (the current-load reality)", () => {
  // Synthetic payload shaped like the current owner rows (names only, no mailing locality).
  assert.equal(
    mailingFromPayload({ first_name: "Firstname", last_name: "Lastname", middle_name: "M" }, "people"),
    null,
  );
});

test("parseMailingLocality: splits an owner mailing line into city/state/zip", () => {
  // Synthetic street; the city/state/ZIP are public geographic values, not owner PII.
  assert.deepEqual(parseMailingLocality("100 SAMPLE RD, BRYCEVILLE, FL 32009"), {
    city: "BRYCEVILLE",
    state: "FL",
    zip: "32009",
  });
  assert.deepEqual(parseMailingLocality("1 MAIN ST, PHOENIX, AZ 85001"), {
    city: "PHOENIX",
    state: "AZ",
    zip: "85001",
  });
});

test("bandLocality: Duval municipalities band in_county (consolidated Jacksonville)", () => {
  assert.equal(bandLocality({ city: "Jacksonville", state: "FL", zip: "32202", source: "t" }), "in_county");
  assert.equal(bandLocality({ city: "Baldwin", state: "FL", zip: "32234", source: "t" }), "in_county");
  assert.equal(bandLocality({ city: null, state: "FL", zip: "32250", source: "t" }), "in_county");
});

test("bandLocality: a 320xx neighbouring-county ZIP is in_state, NOT in_county", () => {
  // Bryceville 32009 is Nassau County — the coarse '320' prefix must not band it as Duval.
  assert.equal(bandLocality({ city: "Bryceville", state: "FL", zip: "32009", source: "t" }), "in_state");
  assert.equal(bandLocality({ city: "Orange Park", state: "FL", zip: "32073", source: "t" }), "in_state");
});

test("bandLocality: a non-FL state bands out_of_state", () => {
  assert.equal(bandLocality({ city: "Phoenix", state: "AZ", zip: "85001", source: "t" }), "out_of_state");
  assert.equal(bandLocality({ city: null, state: null, zip: "27601", source: "t" }), "out_of_state");
});
