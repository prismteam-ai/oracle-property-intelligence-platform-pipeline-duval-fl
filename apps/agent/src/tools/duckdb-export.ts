/**
 * Export the flat, one-row-per-property query-table from Neon to Parquet for the DuckDB layer.
 * This mirrors the kit's `export:query-table` shape but keeps ONLY non-PII columns (folio, public
 * situs, reconciled counts, derived enrichment facts) — no owner names or mailing addresses — so
 * the artifact is safe to ship with the deploy and to range-read from IPFS.
 *
 * Run: pnpm --filter @oracle-duval/agent duckdb:export
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { query } from "../db.ts";

const ROWS_SQL = `
  with roof as (select property_id, count(*)::int c from property_improvements
                 where lower(coalesce(improvement_type,'')) like '%roof%' group by property_id),
       perm as (select property_id, count(*)::int c from property_improvements group by property_id),
       lastsale as (select property_id, max(ownership_transfer_date) d from sales_histories
                     where ownership_transfer_date >= date '1950-01-01' group by property_id)
  select p.request_identifier as folio,
         p.property_usage_type,
         (p.property_usage_type is not null and p.property_usage_type <> 'Residential') as is_commercial,
         p.property_structure_built_year as built_year,
         a.postal_code as situs_zip,
         a.unnormalized_address as situs_address,
         coalesce(perm.c, 0) as permit_count,
         coalesce(roof.c, 0) as roofing_permit_count,
         e.roof_age_years::double precision as roof_age_years,
         e.water_view,
         e.nearest_water_distance_m::double precision as nearest_water_distance_m,
         e.near_transit,
         e.nearest_transit_stop_name,
         e.nearest_transit_distance_m::double precision as nearest_transit_distance_m,
         e.near_starbucks,
         e.dist_band,
         e.regional_owner,
         lastsale.d::text as last_recorded_transfer,
         g.latitude::double precision as latitude,
         g.longitude::double precision as longitude
    from properties p
    left join addresses a on a.address_id = p.address_id
    left join property_enrichment e on e.property_id = p.property_id
    left join roof on roof.property_id = p.property_id
    left join perm on perm.property_id = p.property_id
    left join lastsale on lastsale.property_id = p.property_id
    left join geometries g on g.property_id = p.property_id
   order by p.request_identifier`;

async function main() {
  const rows = await query<Record<string, unknown>>(ROWS_SQL);
  const HERE = dirname(fileURLToPath(import.meta.url));
  const outDir = join(HERE, "..", "..", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "duval-query-table.parquet");

  const mod = await import("@duckdb/node-api");
  const instance = await mod.DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  // Load the rows via a JSON document, then COPY to Parquet — no owner PII in any column.
  const jsonPath = join(outDir, "duval-query-table.json");
  const { writeFileSync } = await import("node:fs");
  const json = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  writeFileSync(jsonPath, json);
  await conn.run(`create table properties as select * from read_json_auto('${jsonPath.replace(/'/g, "''")}')`);
  await conn.run(`copy properties to '${outPath.replace(/'/g, "''")}' (format parquet)`);
  const count = await conn.runAndReadAll(`select count(*) n from properties`);
  console.log(JSON.stringify({ exported: outPath, rows: rows.length, duckdb_count: Number(count.getRowObjects()[0]?.n) }));
  process.exit(0);
}

main().catch((e) => {
  console.error("export failed:", e);
  process.exit(1);
});
