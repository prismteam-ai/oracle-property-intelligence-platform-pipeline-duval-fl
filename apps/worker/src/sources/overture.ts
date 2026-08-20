import { DUVAL_BBOX, OVERTURE_RELEASE } from "../config.ts";
import type { RunContext, StepResult } from "../runner.ts";
import { exec, lit, query, scalar } from "../warehouse.ts";

/**
 * Overture Maps places and water, clipped to Duval County.
 *
 * Overture publishes open map data as Parquet on a public S3 bucket, so DuckDB
 * reads it directly over HTTP with range requests — no credentials, no bulk
 * download, and no local copy of a planet-scale dataset. Pruning on the Parquet
 * `bbox` column pushes the clip down to the file reader, which is what makes a
 * county-sized extract take minutes rather than hours.
 *
 * The clip is a bounding rectangle around Duval, not the Census county polygon,
 * so the extract bleeds slightly into neighbouring counties at the corners. That
 * is recorded as a run limitation rather than described as a county clip.
 *
 * This supplies three of the six required answers: distance to public transit,
 * distance to a named brand (Starbucks), and the water-proximity corroboration
 * for the waterfront signal.
 */

export const SOURCE_PLACES = "overture_places";
export const SOURCE_WATER = "overture_water";

const PLACES_URI = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/type=place/*.parquet`;
const WATER_URI = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=base/type=water/*.parquet`;

/** True when this Overture release has already been loaded for this source. */
async function releaseAlreadyLoaded(sourceSystem: string): Promise<boolean> {
  const prior = await query<{ watermark_value: string }>(
    `SELECT watermark_value FROM pipeline_watermarks WHERE source_system = ${lit(sourceSystem)}`,
  );
  return prior[0]?.watermark_value === OVERTURE_RELEASE;
}

async function recordRelease(sourceSystem: string): Promise<void> {
  await exec(`
    INSERT INTO pipeline_watermarks (source_system, watermark_value, updated_at)
    VALUES (${lit(sourceSystem)}, ${lit(OVERTURE_RELEASE)}, now())
    ON CONFLICT (source_system) DO UPDATE SET watermark_value = EXCLUDED.watermark_value, updated_at = now()
  `);
}

/** Anonymous access to the public Overture bucket. */
async function configureS3(): Promise<void> {
  await exec(
    `SET s3_region='us-west-2'; SET s3_access_key_id=''; SET s3_secret_access_key='';`,
  );
}

const BBOX_FILTER = `
  bbox.xmin BETWEEN ${DUVAL_BBOX.minLng} AND ${DUVAL_BBOX.maxLng}
  AND bbox.ymin BETWEEN ${DUVAL_BBOX.minLat} AND ${DUVAL_BBOX.maxLat}
`;

export async function ingestPlaces(ctx: RunContext): Promise<StepResult> {
  await configureS3();

  if ((await releaseAlreadyLoaded(SOURCE_PLACES)) && ctx.mode !== "backfill") {
    return {
      skippedUnchanged: true,
      artifactUri: PLACES_URI,
      reason: `Overture release ${OVERTURE_RELEASE} already ingested`,
    };
  }

  await exec(`DROP TABLE IF EXISTS stg_places`);
  await exec(`
    CREATE TABLE stg_places AS
    SELECT
      id                                   AS place_id,
      names.primary                        AS name_primary,
      brand.names.primary                  AS brand_name,
      categories.primary                   AS category_primary,
      CAST(categories.alternate AS VARCHAR) AS categories,
      ST_Y(ST_Centroid(geometry))          AS latitude,
      ST_X(ST_Centroid(geometry))          AS longitude,
      confidence
    FROM read_parquet(${lit(PLACES_URI)}, filename = false, hive_partitioning = 1)
    WHERE ${BBOX_FILTER}
  `);

  await exec(`
    ALTER TABLE stg_places ADD COLUMN source_record_hash TEXT;
    UPDATE stg_places SET source_record_hash = md5(concat_ws('|',
      place_id, name_primary, brand_name, category_primary,
      round(latitude, 6), round(longitude, 6)))
  `);

  const recordsIn = Number(await scalar(`SELECT count(*) FROM stg_places`));
  const [counts] = await query<{
    inserts: number;
    updates: number;
    unchanged: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE t.place_id IS NULL)                                        AS inserts,
      count(*) FILTER (WHERE t.place_id IS NOT NULL
                        AND t.source_record_hash IS DISTINCT FROM s.source_record_hash) AS updates,
      count(*) FILTER (WHERE t.source_record_hash = s.source_record_hash)               AS unchanged
    FROM stg_places s LEFT JOIN places t USING (place_id)
  `);

  await exec(`
    INSERT INTO pipeline_run_deltas (run_id, table_name, source_system, record_key, delta_type, before_hash, after_hash)
    SELECT ${lit(ctx.runId)}, 'places', ${lit(SOURCE_PLACES)}, s.place_id,
           CASE WHEN t.place_id IS NULL THEN 'insert' ELSE 'update' END,
           t.source_record_hash, s.source_record_hash
    FROM stg_places s LEFT JOIN places t USING (place_id)
    WHERE t.place_id IS NULL OR t.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await exec(`
    INSERT OR REPLACE INTO places
    SELECT s.* EXCLUDE (source_record_hash),
           ${lit(SOURCE_PLACES)}, s.place_id, s.source_record_hash, ${lit(PLACES_URI)}, now(),
           COALESCE(t.first_seen_run_id, ${lit(ctx.runId)})
    FROM stg_places s LEFT JOIN places t USING (place_id)
    WHERE t.place_id IS NULL OR t.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await recordRelease(SOURCE_PLACES);

  const starbucks = Number(
    await scalar(
      `SELECT count(*) FROM places WHERE lower(coalesce(brand_name, name_primary)) LIKE '%starbucks%'`,
    ),
  );
  const transit = Number(
    await scalar(
      `SELECT count(*) FROM places WHERE category_primary IN
       ('bus_stop','transit_stop','train_station','bus_station','subway_station','light_rail_station','ferry_terminal','transportation')`,
    ),
  );

  return {
    recordsIn,
    inserts: Number(counts!.inserts),
    updates: Number(counts!.updates),
    unchanged: Number(counts!.unchanged),
    artifactUri: PLACES_URI,
    overtureRelease: OVERTURE_RELEASE,
    starbucksLocations: starbucks,
    transitStops: transit,
  };
}

/**
 * Water bodies, kept as a projected table of geometries rather than joined here.
 * Waterfront is derived in derive.sql, where it is combined with the county's own
 * assessed working-waterfront value.
 */
export async function ingestWater(ctx: RunContext): Promise<StepResult> {
  if ((await releaseAlreadyLoaded(SOURCE_WATER)) && ctx.mode !== "backfill") {
    return {
      skippedUnchanged: true,
      artifactUri: WATER_URI,
      reason: `Overture release ${OVERTURE_RELEASE} already ingested`,
    };
  }
  await configureS3();

  await exec(`DROP TABLE IF EXISTS water_bodies`);
  await exec(`
    CREATE TABLE water_bodies AS
    SELECT
      id                              AS water_id,
      names.primary                   AS water_name,
      class                           AS water_class,
      geometry                        AS geom
    FROM read_parquet(${lit(WATER_URI)}, filename = false, hive_partitioning = 1)
    WHERE ${BBOX_FILTER}
  `);

  const recordsIn = Number(await scalar(`SELECT count(*) FROM water_bodies`));
  await recordRelease(SOURCE_WATER);
  ctx.limitation(
    "Overture places and water are pruned to a bounding rectangle around Duval, not the Census county polygon, so the extract includes a small margin of neighbouring counties.",
  );
  if (recordsIn === 0) {
    ctx.limitation(
      "No Overture water features intersected the Duval bounding box; the waterfront derivation falls back to the county's assessed working-waterfront value alone.",
    );
  }
  return {
    recordsIn,
    inserts: recordsIn,
    artifactUri: WATER_URI,
    overtureRelease: OVERTURE_RELEASE,
  };
}
