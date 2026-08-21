/**
 * Backfill `geometries.source_artifact_uri` with a resolvable US Census geocoder query URL so the
 * water-view and walking-distance citations carry a clickable coordinate provenance link (they
 * already SELECT `g.source_artifact_uri`; it was just never populated).
 *
 * Honesty note: the original ingest (Task 6 / enrich/geocode-permit-parcels.ts) geocoded through the
 * Census *addressbatch* endpoint, whose per-parcel response was not retained, so there is no stored
 * page hash — `page_sha256` stays null for geo citations. What we backfill is the equivalent
 * *single-address* query URL (`/locations/onelineaddress`, same benchmark) that reproduces the exact
 * coordinate from the same authoritative geocoder. This is a reconstructed canonical URL, not the
 * literal batch artifact — documented in infra/run-records.
 *
 * Server-only DB access via DATABASE_URL (never logged). Idempotent: only rows with a null URI are
 * touched. Run: DATABASE_URL=... npx tsx enrich/backfill-geo-source-uri.ts
 */
import { withDb, getDatabaseUrl } from "./lib.ts";

const CENSUS_ONELINE = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";

/** Canonical single-address Census geocoder URL that resolves to this parcel's coordinate. */
export function geocoderUri(address: string): string {
  const q = new URLSearchParams({ address, benchmark: CENSUS_BENCHMARK, format: "json" });
  return `${CENSUS_ONELINE}?${q.toString()}`;
}

async function main(): Promise<void> {
  getDatabaseUrl(); // fail fast if the connection string is absent
  await withDb(async (client) => {
    const { rows } = await client.query<{ geometry_id: string; addr: string }>(
      `select g.geometry_id, a.unnormalized_address as addr
         from geometries g
         join properties p on p.property_id = g.property_id
         join addresses a on a.address_id = p.address_id
        where g.source_artifact_uri is null and a.unnormalized_address is not null`,
    );
    let updated = 0;
    for (const r of rows) {
      await client.query(`update geometries set source_artifact_uri = $1 where geometry_id = $2`, [
        geocoderUri(r.addr),
        r.geometry_id,
      ]);
      updated += 1;
    }
    console.log(
      `backfilled source_artifact_uri on ${updated} / ${rows.length} candidate geometries ` +
        `(US Census single-address geocoder URL; page_sha256 remains null — batch response not retained)`,
    );
  });
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
