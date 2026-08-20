import path from "node:path";
import { DOR_COUNTY_NO, FL_DOR, RAW_DIR } from "../config.ts";
import type { RunContext, StepResult } from "../runner.ts";
import { exec, lit, query, scalar } from "../warehouse.ts";
import {
  commitArtifact,
  download,
  filesIn,
  probeArtifact,
  unzipTo,
} from "./artifact.ts";

/**
 * Florida Department of Revenue tax-roll ingestion.
 *
 * Under ch. 119 F.S. every county property appraiser files its assessment roll
 * with the state, which republishes it for free. That makes the DOR the highest
 * coverage-per-hour source available for Duval: the full ~404k-parcel roll with
 * owners, values, year built and sale history in one 29 MB download, with no
 * scraping, no auth, and no anti-bot posture.
 */

export const SOURCE_NAL = "fl_dor_nal";
export const SOURCE_SDF = "fl_dor_sdf";
export const SOURCE_PIN = "fl_dor_parcel_geometry";

/** Folios are TEXT with significant leading zeros. Trim whitespace only —
 *  never strip non-digits, which collapses distinct condo units onto one row. */
const FOLIO = `trim(PARCEL_ID)`;

export function nalUrl(year: string): string {
  return `${FL_DOR.base}/Tax%20Roll%20Data%20Files/NAL/${year}/Duval%20${DOR_COUNTY_NO}%20Preliminary%20NAL%20${year.slice(0, 4)}.zip`;
}
export function sdfUrl(year: string): string {
  return `${FL_DOR.base}/Tax%20Roll%20Data%20Files/SDF/${year}/Duval%20${DOR_COUNTY_NO}%20Preliminary%20SDF%20${year.slice(0, 4)}.zip`;
}
/**
 * Parcel-geometry archive URL.
 *
 * The directory carries the vintage suffix ("2026F PIN") but the file inside
 * does not — it is `duval_2026pin.zip`. Verified against the 2024F, 2025F and
 * 2026F listings; getting this wrong 404s.
 */
export function pinUrl(vintage: string): string {
  const year = vintage.slice(0, 4);
  return `${FL_DOR.base}/Map%20Data/${vintage}/${vintage}%20PIN/duval_${year}pin.zip`;
}

/**
 * Load the NAL roll.
 *
 * Change detection runs at two levels. The artifact level compares the upstream
 * ETag and length, so an unchanged roll costs one HEAD request. The record level
 * hashes each row and classifies it as insert / update / unchanged, writing one
 * delta row per change so the run history shows what actually moved.
 */
export async function ingestNal(
  ctx: RunContext,
  opts: { year: string },
): Promise<StepResult> {
  const probe = await probeArtifact(nalUrl(opts.year), SOURCE_NAL);
  if (!probe.changed && ctx.mode !== "backfill") {
    return {
      skippedUnchanged: true,
      artifactUri: probe.uri,
      reason: "etag and content-length unchanged since last committed load",
    };
  }

  const zip = path.join(RAW_DIR, `duval-nal-${opts.year}.zip`);
  const sha = await download(probe.uri, zip, { force: probe.changed });
  const dir = path.join(RAW_DIR, `nal-${opts.year}`);
  await unzipTo(zip, dir, { force: probe.changed });
  const csv = filesIn(dir, ".csv")[0];
  if (!csv) throw new Error(`No CSV inside ${zip}`);

  // Stage the raw roll. all_varchar keeps leading zeros intact; casting happens
  // explicitly per column below.
  await exec(`DROP TABLE IF EXISTS stg_nal`);
  await exec(`
    CREATE TABLE stg_nal AS
    SELECT * FROM read_csv(${lit(csv)}, all_varchar = true, header = true,
                           ignore_errors = true, sample_size = -1)
  `);

  await exec(`DROP TABLE IF EXISTS stg_parcels`);
  await exec(`
    CREATE TABLE stg_parcels AS
    SELECT
      ${FOLIO}                                    AS request_identifier,
      ${FOLIO}                                    AS parcel_identifier,
      trim(CO_NO)                                 AS county_no,
      TRY_CAST(ASMNT_YR AS INTEGER)               AS assessment_year,
      trim(DOR_UC)                                AS dor_use_code,
      trim(PA_UC)                                 AS pa_use_code,
      TRY_CAST(JV AS BIGINT)                      AS just_value,
      TRY_CAST(AV_NSD AS BIGINT)                  AS assessed_value,
      TRY_CAST(TV_NSD AS BIGINT)                  AS taxable_value,
      TRY_CAST(LND_VAL AS BIGINT)                 AS land_value,
      TRY_CAST(JV_WRKNG_WTRFNT AS BIGINT)         AS working_waterfront_value,
      TRY_CAST(AV_HMSTD AS BIGINT)                AS homestead_assessed_value,
      TRY_CAST(NCONST_VAL AS BIGINT)              AS new_construction_value,
      TRY_CAST(SPEC_FEAT_VAL AS BIGINT)           AS special_feature_value,
      TRY_CAST(LND_SQFOOT AS BIGINT)              AS land_sqft,
      TRY_CAST(ACT_YR_BLT AS INTEGER)             AS actual_year_built,
      TRY_CAST(EFF_YR_BLT AS INTEGER)             AS effective_year_built,
      TRY_CAST(TOT_LVG_AREA AS BIGINT)            AS total_living_area,
      TRY_CAST(NO_BULDNG AS INTEGER)              AS building_count,
      TRY_CAST(NO_RES_UNTS AS INTEGER)            AS residential_units,
      trim(OWN_NAME)                              AS owner_name,
      trim(OWN_ADDR1)                             AS owner_addr1,
      trim(OWN_ADDR2)                             AS owner_addr2,
      trim(OWN_CITY)                              AS owner_city,
      trim(OWN_STATE)                             AS owner_state,
      trim(OWN_ZIPCD)                             AS owner_zip,
      trim(FIDU_NAME)                             AS fiduciary_name,
      trim(PHY_ADDR1)                             AS situs_addr1,
      trim(PHY_ADDR2)                             AS situs_addr2,
      trim(PHY_CITY)                              AS situs_city,
      trim(PHY_ZIPCD)                             AS situs_zip,
      trim(NBRHD_CD)                              AS neighborhood_code,
      trim(MKT_AR)                                AS market_area,
      trim(CENSUS_BK)                             AS census_block,
      trim(S_LEGAL)                               AS legal_description,
      TRY_CAST(SALE_PRC1 AS BIGINT)               AS sale1_price,
      TRY_CAST(SALE_YR1 AS INTEGER)               AS sale1_year,
      TRY_CAST(SALE_MO1 AS INTEGER)               AS sale1_month,
      trim(QUAL_CD1)                              AS sale1_qual_code,
      TRY_CAST(SALE_PRC2 AS BIGINT)               AS sale2_price,
      TRY_CAST(SALE_YR2 AS INTEGER)               AS sale2_year,
      TRY_CAST(SALE_MO2 AS INTEGER)               AS sale2_month,
      trim(QUAL_CD2)                              AS sale2_qual_code
    FROM stg_nal
    WHERE ${FOLIO} IS NOT NULL AND ${FOLIO} <> ''
  `);

  // Record-level hash over the business columns only, so provenance timestamps
  // never make an unchanged row look changed.
  await exec(`
    ALTER TABLE stg_parcels ADD COLUMN source_record_hash TEXT;
    UPDATE stg_parcels SET source_record_hash = md5(concat_ws('|',
      parcel_identifier, assessment_year, dor_use_code, pa_use_code, just_value,
      assessed_value, taxable_value, land_value, working_waterfront_value,
      homestead_assessed_value, new_construction_value, special_feature_value,
      land_sqft, actual_year_built, effective_year_built, total_living_area,
      building_count, residential_units, owner_name, owner_addr1, owner_addr2,
      owner_city, owner_state, owner_zip, fiduciary_name, situs_addr1, situs_addr2,
      situs_city, situs_zip, neighborhood_code, market_area, census_block,
      legal_description, sale1_price, sale1_year, sale1_month, sale1_qual_code,
      sale2_price, sale2_year, sale2_month, sale2_qual_code))
  `);

  const recordsIn = Number(await scalar(`SELECT count(*) FROM stg_parcels`));

  const dupes = Number(
    await scalar(
      `SELECT count(*) FROM (SELECT request_identifier FROM stg_parcels GROUP BY 1 HAVING count(*) > 1)`,
    ),
  );
  if (dupes > 0) {
    ctx.limitation(
      `NAL ${opts.year}: ${dupes} folios appeared more than once in the source roll; the highest just-value row was kept for each.`,
    );
    await exec(`
      CREATE OR REPLACE TABLE stg_parcels AS
      SELECT * EXCLUDE (rn) FROM (
        SELECT *, row_number() OVER (PARTITION BY request_identifier
                                     ORDER BY just_value DESC NULLS LAST,
                                              source_record_hash) AS rn
        FROM stg_parcels
      ) WHERE rn = 1
    `);
  }

  // Classify before applying, so the delta counts describe this run's effect.
  const [counts] = await query<{
    inserts: number;
    updates: number;
    unchanged: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE p.request_identifier IS NULL)                                AS inserts,
      count(*) FILTER (WHERE p.request_identifier IS NOT NULL
                         AND p.source_record_hash IS DISTINCT FROM s.source_record_hash)  AS updates,
      count(*) FILTER (WHERE p.source_record_hash = s.source_record_hash)                 AS unchanged
    FROM stg_parcels s
    LEFT JOIN parcels p USING (request_identifier)
  `);

  await exec(`
    INSERT INTO pipeline_run_deltas (run_id, table_name, source_system, record_key, delta_type, before_hash, after_hash)
    SELECT ${lit(ctx.runId)}, 'parcels', ${lit(SOURCE_NAL)}, s.request_identifier,
           CASE WHEN p.request_identifier IS NULL THEN 'insert' ELSE 'update' END,
           p.source_record_hash, s.source_record_hash
    FROM stg_parcels s
    LEFT JOIN parcels p USING (request_identifier)
    WHERE p.request_identifier IS NULL
       OR p.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  // The NAL is a full-file source, so a folio present in the warehouse but
  // absent from the roll has genuinely left the roll (parcel split, combination
  // or retirement). Soft-delete it rather than leaving a stale row that would
  // keep answering queries.
  const [removed] = await query<{ deletes: number }>(`
    SELECT count(*) AS deletes
    FROM parcels p
    LEFT JOIN stg_parcels s USING (request_identifier)
    WHERE p.source_system = ${lit(SOURCE_NAL)} AND s.request_identifier IS NULL
  `);
  if (Number(removed!.deletes) > 0) {
    await exec(`
      INSERT INTO pipeline_run_deltas (run_id, table_name, source_system, record_key, delta_type, before_hash, after_hash)
      SELECT ${lit(ctx.runId)}, 'parcels', ${lit(SOURCE_NAL)}, p.request_identifier,
             'delete', p.source_record_hash, NULL
      FROM parcels p
      LEFT JOIN stg_parcels s USING (request_identifier)
      WHERE p.source_system = ${lit(SOURCE_NAL)} AND s.request_identifier IS NULL
    `);
    await exec(`
      DELETE FROM parcels
      WHERE source_system = ${lit(SOURCE_NAL)}
        AND request_identifier NOT IN (SELECT request_identifier FROM stg_parcels)
    `);
  }

  // Idempotent apply: unchanged rows are not rewritten, so a repeated run is a
  // genuine no-op rather than a churn of identical writes. EXCLUDE the staged
  // hash so the trailing provenance columns line up with the target's order.
  await exec(`
    INSERT OR REPLACE INTO parcels
    SELECT s.* EXCLUDE (source_record_hash),
           ${lit(SOURCE_NAL)}, s.request_identifier, s.source_record_hash,
           ${lit(probe.uri)}, now(),
           COALESCE(p.first_seen_run_id, ${lit(ctx.runId)}),
           ${lit(ctx.runId)}
    FROM stg_parcels s
    LEFT JOIN parcels p USING (request_identifier)
    WHERE p.request_identifier IS NULL
       OR p.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await exec(`
    INSERT INTO pipeline_watermarks (source_system, watermark_value, updated_at)
    VALUES (${lit(SOURCE_NAL)}, ${lit(opts.year)}, now())
    ON CONFLICT (source_system) DO UPDATE SET watermark_value = EXCLUDED.watermark_value, updated_at = now()
  `);

  // Only now is the fingerprint safe to record: the data is in.
  await commitArtifact(probe, { sha256: sha, runId: ctx.runId });

  return {
    recordsIn,
    inserts: Number(counts!.inserts),
    updates: Number(counts!.updates),
    deletes: Number(removed!.deletes),
    unchanged: Number(counts!.unchanged),
    artifactUri: probe.uri,
    rollYear: opts.year,
  };
}

/** Load the Sale Data File — the recorded-sale history behind ownership tenure. */
export async function ingestSdf(
  ctx: RunContext,
  opts: { year: string },
): Promise<StepResult> {
  const probe = await probeArtifact(sdfUrl(opts.year), SOURCE_SDF);
  if (!probe.changed && ctx.mode !== "backfill") {
    return {
      skippedUnchanged: true,
      artifactUri: probe.uri,
      reason: "etag and content-length unchanged since last committed load",
    };
  }

  const zip = path.join(RAW_DIR, `duval-sdf-${opts.year}.zip`);
  const sha = await download(probe.uri, zip, { force: probe.changed });
  const dir = path.join(RAW_DIR, `sdf-${opts.year}`);
  await unzipTo(zip, dir, { force: probe.changed });
  const csv = filesIn(dir, ".csv")[0];
  if (!csv) throw new Error(`No CSV inside ${zip}`);

  await exec(`DROP TABLE IF EXISTS stg_sales`);
  await exec(`
    CREATE TABLE stg_sales AS
    SELECT
      concat_ws('|', ${FOLIO}, trim(OR_BOOK), trim(OR_PAGE), trim(CLERK_NO)) AS sale_key,
      ${FOLIO}                          AS request_identifier,
      TRY_CAST(SALE_YR AS INTEGER)      AS sale_year,
      TRY_CAST(SALE_MO AS INTEGER)      AS sale_month,
      TRY_CAST(SALE_PRC AS BIGINT)      AS sale_price,
      trim(QUAL_CD)                     AS qual_code,
      trim(VI_CD)                       AS vacant_improved,
      trim(OR_BOOK)                     AS or_book,
      trim(OR_PAGE)                     AS or_page,
      trim(CLERK_NO)                    AS clerk_no,
      trim(MULTI_PAR_SAL)               AS multi_parcel_sale
    FROM read_csv(${lit(csv)}, all_varchar = true, header = true,
                  ignore_errors = true, sample_size = -1)
    WHERE ${FOLIO} IS NOT NULL AND ${FOLIO} <> ''
    QUALIFY row_number() OVER (PARTITION BY sale_key
                               ORDER BY sale_price DESC NULLS LAST, sale_year DESC, sale_month DESC) = 1
  `);
  await exec(`
    ALTER TABLE stg_sales ADD COLUMN source_record_hash TEXT;
    UPDATE stg_sales SET source_record_hash = md5(concat_ws('|',
      request_identifier, sale_year, sale_month, sale_price, qual_code,
      vacant_improved, or_book, or_page, clerk_no, multi_parcel_sale))
  `);

  const recordsIn = Number(await scalar(`SELECT count(*) FROM stg_sales`));
  const [counts] = await query<{
    inserts: number;
    updates: number;
    unchanged: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE t.sale_key IS NULL)                                        AS inserts,
      count(*) FILTER (WHERE t.sale_key IS NOT NULL
                         AND t.source_record_hash IS DISTINCT FROM s.source_record_hash) AS updates,
      count(*) FILTER (WHERE t.source_record_hash = s.source_record_hash)                AS unchanged
    FROM stg_sales s LEFT JOIN sales t USING (sale_key)
  `);

  await exec(`
    INSERT INTO pipeline_run_deltas (run_id, table_name, source_system, record_key, delta_type, before_hash, after_hash)
    SELECT ${lit(ctx.runId)}, 'sales', ${lit(SOURCE_SDF)}, s.sale_key,
           CASE WHEN t.sale_key IS NULL THEN 'insert' ELSE 'update' END,
           t.source_record_hash, s.source_record_hash
    FROM stg_sales s LEFT JOIN sales t USING (sale_key)
    WHERE t.sale_key IS NULL OR t.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await exec(`
    INSERT OR REPLACE INTO sales
    SELECT s.* EXCLUDE (source_record_hash),
           ${lit(SOURCE_SDF)}, s.sale_key, s.source_record_hash, ${lit(probe.uri)}, now(),
           COALESCE(t.first_seen_run_id, ${lit(ctx.runId)})
    FROM stg_sales s LEFT JOIN sales t USING (sale_key)
    WHERE t.sale_key IS NULL OR t.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await commitArtifact(probe, { sha256: sha, runId: ctx.runId });

  return {
    recordsIn,
    inserts: Number(counts!.inserts),
    updates: Number(counts!.updates),
    unchanged: Number(counts!.unchanged),
    artifactUri: probe.uri,
    rollYear: opts.year,
  };
}
