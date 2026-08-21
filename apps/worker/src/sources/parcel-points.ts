import path from "node:path";
import { RAW_DIR } from "../config.ts";
import type { RunContext, StepResult } from "../runner.ts";
import { exec, lit, query, scalar } from "../warehouse.ts";
import {
  commitArtifact,
  download,
  filesIn,
  probeArtifact,
  unzipTo,
} from "./artifact.ts";
import { SOURCE_PIN, pinUrl } from "./fldor.ts";

/**
 * Parcel geometry from the Florida DOR statewide parcel layer.
 *
 * Despite the "PIN" (parcel identification) naming these are full polygons, not
 * points, which is strictly better: the centroid gives coordinates for the
 * proximity questions, and the boundary gives true adjacency for the waterfront
 * derivation rather than a centre-point approximation.
 *
 * The layer ships in NAD83(HARN) / Florida East (US feet), EPSG:2881. It is
 * reprojected to WGS84 on ingest; the resulting bounding box is asserted against
 * Duval's real extent so a wrong CRS fails loudly instead of silently placing
 * every parcel in the Gulf of Mexico.
 */

const SOURCE_CRS = "EPSG:2881";

/** Duval's true extent, used as a correctness assertion on the reprojection. */
const EXPECTED = { minLat: 30.0, maxLat: 30.7, minLng: -82.2, maxLng: -81.2 };

export async function ingestParcelPoints(
  ctx: RunContext,
  opts: { vintage: string },
): Promise<StepResult> {
  const probe = await probeArtifact(pinUrl(opts.vintage), SOURCE_PIN);
  if (!probe.changed && ctx.mode !== "backfill") {
    return {
      skippedUnchanged: true,
      artifactUri: probe.uri,
      reason: "etag and content-length unchanged since last committed load",
    };
  }

  const zip = path.join(RAW_DIR, `duval-pin-${opts.vintage}.zip`);
  const sha = await download(probe.uri, zip, { force: probe.changed });
  const dir = path.join(RAW_DIR, `pin-${opts.vintage}`);
  await unzipTo(zip, dir, { force: probe.changed });
  const shp = filesIn(dir, ".shp")[0];
  if (!shp) throw new Error(`No .shp inside ${zip}`);

  await exec(`DROP TABLE IF EXISTS stg_points`);
  await exec(`
    CREATE TABLE stg_points AS
    SELECT
      request_identifier, latitude, longitude, vintage_year
    FROM (
      SELECT
        trim(PARCELNO) AS request_identifier,
        ST_Y(c)        AS latitude,
        ST_X(c)        AS longitude,
        ${Number(opts.vintage.slice(0, 4))} AS vintage_year,
        area_sqm,
        row_number() OVER (
          PARTITION BY trim(PARCELNO)
          -- Deterministic tiebreak: the largest polygon wins, then coordinates.
          -- Ordering by a constant would leave duplicate folios resolved
          -- differently between runs and produce phantom deltas.
          ORDER BY area_sqm DESC NULLS LAST, ST_Y(c), ST_X(c)
        ) AS rn
      FROM (
        SELECT PARCELNO,
               ST_Centroid(ST_Transform(geom, ${lit(SOURCE_CRS)}, 'EPSG:4326', always_xy := true)) AS c,
               ST_Area(geom) AS area_sqm
        FROM ST_Read(${lit(shp)})
      )
      WHERE PARCELNO IS NOT NULL AND trim(PARCELNO) <> ''
    )
    WHERE rn = 1
  `);

  const [box] = await query<{
    n: number;
    min_lat: number;
    max_lat: number;
    min_lng: number;
    max_lng: number;
  }>(`
    SELECT count(*) AS n, min(latitude) AS min_lat, max(latitude) AS max_lat,
           min(longitude) AS min_lng, max(longitude) AS max_lng FROM stg_points
  `);

  // An empty extract and a bad reprojection produce the same NULL bounds, so
  // they are reported as the distinct problems they are.
  if (Number(box!.n) === 0) {
    throw new Error(`No parcel geometries were extracted from ${shp}.`);
  }
  if (
    Number(box!.min_lat) < EXPECTED.minLat ||
    Number(box!.max_lat) > EXPECTED.maxLat ||
    Number(box!.min_lng) < EXPECTED.minLng ||
    Number(box!.max_lng) > EXPECTED.maxLng
  ) {
    throw new Error(
      `Reprojected parcel centroids fall outside Duval County: ` +
        `lat ${box!.min_lat}..${box!.max_lat}, lng ${box!.min_lng}..${box!.max_lng}. ` +
        `Check the source CRS (${SOURCE_CRS}).`,
    );
  }

  await exec(`
    ALTER TABLE stg_points ADD COLUMN source_record_hash TEXT;
    UPDATE stg_points SET source_record_hash =
      md5(concat_ws('|', request_identifier, round(latitude, 6), round(longitude, 6)))
  `);

  const recordsIn = Number(await scalar(`SELECT count(*) FROM stg_points`));
  const [counts] = await query<{
    inserts: number;
    updates: number;
    unchanged: number;
  }>(`
    SELECT
      count(*) FILTER (WHERE t.request_identifier IS NULL)                              AS inserts,
      count(*) FILTER (WHERE t.request_identifier IS NOT NULL
                        AND t.source_record_hash IS DISTINCT FROM s.source_record_hash) AS updates,
      count(*) FILTER (WHERE t.source_record_hash = s.source_record_hash)               AS unchanged
    FROM stg_points s LEFT JOIN parcel_points t USING (request_identifier)
  `);

  await exec(`
    INSERT INTO pipeline_run_deltas (run_id, table_name, source_system, record_key, delta_type, before_hash, after_hash)
    SELECT ${lit(ctx.runId)}, 'parcel_points', ${lit(SOURCE_PIN)}, s.request_identifier,
           CASE WHEN t.request_identifier IS NULL THEN 'insert' ELSE 'update' END,
           t.source_record_hash, s.source_record_hash
    FROM stg_points s LEFT JOIN parcel_points t USING (request_identifier)
    WHERE t.request_identifier IS NULL
       OR t.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await exec(`
    INSERT OR REPLACE INTO parcel_points
    SELECT s.* EXCLUDE (source_record_hash),
           ${lit(SOURCE_PIN)}, s.request_identifier, s.source_record_hash, ${lit(probe.uri)}, now(),
           COALESCE(t.first_seen_run_id, ${lit(ctx.runId)})
    FROM stg_points s LEFT JOIN parcel_points t USING (request_identifier)
    WHERE t.request_identifier IS NULL
       OR t.source_record_hash IS DISTINCT FROM s.source_record_hash
  `);

  await exec(`
    INSERT INTO pipeline_watermarks (source_system, watermark_value, updated_at)
    VALUES (${lit(SOURCE_PIN)}, ${lit(opts.vintage)}, now())
    ON CONFLICT (source_system) DO UPDATE SET watermark_value = EXCLUDED.watermark_value, updated_at = now()
  `);

  await commitArtifact(probe, { sha256: sha, runId: ctx.runId });

  // Coverage against the roll is a headline honesty number for the UI.
  const matched = Number(
    await scalar(
      `SELECT count(*) FROM parcels p JOIN parcel_points g USING (request_identifier)`,
    ),
  );
  const totalParcels = Number(await scalar(`SELECT count(*) FROM parcels`));
  const pct = totalParcels ? (matched / totalParcels) * 100 : 0;
  if (pct < 99) {
    ctx.limitation(
      `Parcel geometry matched ${pct.toFixed(2)}% of roll parcels (${matched}/${totalParcels}); ` +
        `coordinates are unavailable for the remainder and coordinate-based answers exclude them.`,
    );
  }

  return {
    recordsIn,
    inserts: Number(counts!.inserts),
    updates: Number(counts!.updates),
    unchanged: Number(counts!.unchanged),
    artifactUri: probe.uri,
    vintage: opts.vintage,
    geometryCoveragePct: Number(pct.toFixed(2)),
    matchedParcels: matched,
  };
}
