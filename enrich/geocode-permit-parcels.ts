/**
 * Geocode the permit-bearing parcels that carry a situs address but no coordinate yet, so the
 * downstream coordinate-based enrichment (walking-distance, water-view) can run on them too.
 *
 * Motivation (Task 13b): the original geocoded set (169 parcels, Task 6) and the JaxEPICS
 * roofing-permit set are DISJOINT — every roof-age parcel is permit-bearing, and none of them
 * were geocoded — so no single parcel carried roof + water + walking together. This is a demo
 * gap, not a data gap: the permit parcels' situs addresses are already in Neon (the appraiser
 * transform loaded them into `addresses.source_payload.unnormalized_address`). We geocode those
 * already-loaded addresses — NO re-scrape of any portal — via the public US Census batch
 * geocoder (the exact source Task 6 used for the first 169), keyed on the appraiser RE#, and
 * load the matches into `geometries` (`source_system = 'duval_geo_census'`) in the same shape as
 * the existing rows. Re-running walking-distance.ts + water-view.ts then covers these parcels.
 *
 * Public, US, no auth: `https://geocoding.geo.census.gov/geocoder/locations/addressbatch`.
 * Server-only DB access via DATABASE_URL (never logged). Idempotent: only ungeocoded parcels are
 * fetched, and each coordinate is upserted on the geometry source-record key.
 *
 * Run: DATABASE_URL=... npx tsx enrich/geocode-permit-parcels.ts
 */
import type { Client } from "pg";
import { isDirectRun, parseCsvLine, withDb } from "./lib.ts";

const CENSUS_BATCH_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const CENSUS_BENCHMARK = "Public_AR_Current";
const BATCH_SIZE = 1000; // Census caps a batch at 10 000 rows; keep chunks small for reliability.

interface Candidate {
  propertyId: string;
  folio: string;
  address: string;
}

interface StreetParts {
  street: string;
  city: string;
  state: string;
  zip: string;
}

const STREET_SUFFIXES = new Set([
  "RD", "AVE", "ST", "BLVD", "PKWY", "PKY", "LN", "DR", "CT", "WAY", "PL", "TER",
  "CIR", "HWY", "TRL", "LOOP", "RUN", "PT", "SQ", "PATH", "XING", "COVE", "CV",
]);

/**
 * Split "STREET, CITY, FL ZIP" (the appraiser `unnormalized_address` form) into components and
 * drop a trailing unit token from the street so the geocoder matches on the base street address.
 * A trailing token is treated as a unit only when a street-type suffix precedes it (so highway
 * names like "W US 90" keep their number).
 */
export function parseUnnormalized(addr: string): StreetParts | null {
  const parts = addr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length < 3) return null;
  const last = parts[parts.length - 1]!; // "FL 32257"
  const city = parts[parts.length - 2]!;
  const street = parts.slice(0, parts.length - 2).join(" ").trim();
  const m = last.match(/^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/i);
  if (!m) return null;
  const state = m[1]!.toUpperCase();
  const zip = m[2]!;
  return { street: stripUnit(street), city, state, zip };
}

/** Drop a trailing unit token (bare number or single letter) when a street suffix precedes it. */
export function stripUnit(street: string): string {
  const toks = street.split(/\s+/);
  if (toks.length < 3) return street;
  const last = toks[toks.length - 1]!;
  const prev = toks[toks.length - 2]!.toUpperCase().replace(/\./g, "");
  const isUnit = /^\d+[A-Z]?$/i.test(last) || /^[A-Z]$/i.test(last);
  if (isUnit && STREET_SUFFIXES.has(prev)) return toks.slice(0, -1).join(" ");
  return street;
}

/** Build the Census batch CSV (no header): id,street,city,state,zip — each field quoted. */
function toCsv(rows: { id: string; p: StreetParts }[]): string {
  const q = (s: string): string => `"${s.replace(/"/g, "")}"`;
  return rows
    .map(({ id, p }) => [q(id), q(p.street), q(p.city), q(p.state), q(p.zip)].join(","))
    .join("\n");
}

interface GeoResult {
  id: string;
  indicator: string; // Match | No_Match | Tie
  matchType: string;
  matchedAddress: string;
  lat: number | null;
  lon: number | null;
}

/** POST one CSV batch to the Census geocoder and parse the CSV response. */
async function geocodeBatch(csv: string): Promise<GeoResult[]> {
  const form = new FormData();
  form.append("benchmark", CENSUS_BENCHMARK);
  form.append("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
  const res = await fetch(CENSUS_BATCH_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  const text = await res.text();
  const out: GeoResult[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const c = parseCsvLine(line);
    const id = c[0] ?? "";
    const indicator = c[2] ?? "No_Match";
    let lat: number | null = null;
    let lon: number | null = null;
    if (indicator === "Match") {
      const lonLat = (c[5] ?? "").split(",");
      lon = Number(lonLat[0]);
      lat = Number(lonLat[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        lat = null;
        lon = null;
      }
    }
    out.push({ id, indicator, matchType: c[3] ?? "", matchedAddress: c[4] ?? "", lat, lon });
  }
  return out;
}

async function loadCandidates(client: Client): Promise<Candidate[]> {
  const { rows } = await client.query(`
    select distinct on (pi.property_id)
           pi.property_id,
           p.request_identifier                          as folio,
           a.source_payload->>'unnormalized_address'     as address
      from (select distinct property_id from property_improvements
             where source_system = 'duval_jaxepics' and property_id is not null) pi
      join properties p on p.property_id = pi.property_id
      join addresses  a on a.request_identifier = p.request_identifier
     where a.source_payload->>'unnormalized_address' is not null
       and not exists (
         select 1 from geometries g
          where g.property_id = pi.property_id and g.latitude is not null)
     order by pi.property_id, p.request_identifier`);
  return rows.map((r) => ({ propertyId: r.property_id, folio: r.folio, address: r.address }));
}

async function main(): Promise<void> {
  await withDb(async (client: Client) => {
    const candidates = await loadCandidates(client);
    // eslint-disable-next-line no-console
    console.log(`geocode-permit-parcels: ${candidates.length} permit-bearing parcels to geocode.`);
    if (candidates.length === 0) return;

    // Build parseable requests keyed by folio (RE#).
    const parsed: { id: string; p: StreetParts; cand: Candidate }[] = [];
    let unparsed = 0;
    for (const cand of candidates) {
      const p = parseUnnormalized(cand.address);
      if (!p) {
        unparsed++;
        continue;
      }
      parsed.push({ id: cand.folio, p, cand });
    }
    if (unparsed > 0) console.log(`  (${unparsed} addresses not parseable, skipped)`);

    const byFolio = new Map(parsed.map((x) => [x.id, x.cand]));
    let match = 0;
    let tie = 0;
    let noMatch = 0;
    let inserted = 0;

    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const chunk = parsed.slice(i, i + BATCH_SIZE);
      const results = await geocodeBatch(toCsv(chunk.map(({ id, p }) => ({ id, p }))));
      for (const r of results) {
        if (r.indicator === "Match" && r.lat !== null && r.lon !== null) {
          match++;
          const cand = byFolio.get(r.id);
          if (!cand) continue;
          await client.query(
            `insert into geometries
               (property_id, request_identifier, latitude, longitude,
                source_payload, source_system, source_record_key, loaded_at, created_at, updated_at)
             values ($1, $2, $3, $4, '{}'::jsonb, 'duval_geo_census', $5, now(), now(), now())
             on conflict (source_system, source_record_key) do update
               set latitude = excluded.latitude, longitude = excluded.longitude, updated_at = now()`,
            [cand.propertyId, cand.folio, r.lat, r.lon, `duval_geo_census:${cand.folio}:geometry:point`],
          );
          inserted++;
        } else if (r.indicator === "Tie") tie++;
        else noMatch++;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `geocode-permit-parcels: Match=${match} Tie=${tie} No_Match=${noMatch} | ` +
        `${inserted} coordinates loaded into geometries (duval_geo_census).`,
    );
  });
}

// Run only when invoked directly (so the pure parsers above can be unit-tested by importing this
// module without opening a DB connection).
if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
