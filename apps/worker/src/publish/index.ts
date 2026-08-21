import fs from "node:fs";
import path from "node:path";
import {
  ARTIFACT_DIR,
  COUNTY,
  FILEBASE,
  IPNS_LABELS,
  OBJECT_KEYS,
} from "../config.ts";
import type { RunContext, StepResult } from "../runner.ts";
import { exec, lit, query, scalar } from "../warehouse.ts";
import {
  cidUrl,
  gatewayUrl,
  headByCid,
  publishIpns,
  resolveIpns,
  uploadFile,
  verifyParquetByCid,
} from "./filebase.ts";

/**
 * Publish the warehouse to Elephant IPFS.
 *
 * This is the step that makes the "Oracle carries no ongoing infrastructure
 * cost" claim true rather than aspirational. After it runs, everything a
 * consumer needs is content-addressed on IPFS behind a stable IPNS label:
 * `elephant-mcp` opens the Parquet with DuckDB over HTTP range requests, so
 * there is no database and no API to keep running.
 *
 * The bucket is shared across datasets and namespaced by key prefix. That is
 * safe here specifically because IPNS points at CIDs, not at paths — one bucket
 * can back every label without collision.
 */

export const QUERY_TABLE_PARQUET = "query-table.parquet";

interface PublishedArtifact {
  dataset: string;
  key: string;
  cid: string;
  bytes: number;
  /** Immutable address of exactly these bytes. Always present. */
  cidUrl: string;
  /** Stable address that survives republishes. Only the query table gets one —
   *  see the IPNS budget note on publishArtifacts. */
  ipnsLabel?: string;
  ipnsName?: string;
  ipnsUrl?: string;
}

function outDir(): string {
  const dir = path.join(ARTIFACT_DIR, COUNTY);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Export the derived query table to Parquet and enforce the Elephant contract
 * before anything leaves the machine.
 *
 * The gate is deliberately upstream of the upload: publishing a table that
 * violates one-row-per-folio would poison every consumer resolving the IPNS
 * label, and IPFS content is immutable once pinned.
 */
export async function exportQueryTable(): Promise<{
  filePath: string;
  rows: number;
  bytes: number;
}> {
  const filePath = path.join(outDir(), QUERY_TABLE_PARQUET);
  await exec(`
    COPY (SELECT * FROM property_query_table ORDER BY request_identifier)
    TO ${lit(filePath)} (FORMAT PARQUET, COMPRESSION ZSTD)
  `);

  const [check] = await query<{
    rows: number;
    folios: number;
    empties: number;
  }>(
    `SELECT count(*)                                   AS rows,
            count(DISTINCT request_identifier)         AS folios,
            count(*) FILTER (WHERE request_identifier IS NULL
                               OR trim(request_identifier) = '') AS empties
       FROM read_parquet(${lit(filePath)})`,
  );
  const rows = Number(check!.rows);
  const folios = Number(check!.folios);
  if (rows !== folios) {
    throw new Error(
      `Query-table Parquet has ${rows} rows but ${folios} distinct folios — the one-row-per-property contract is violated; refusing to publish.`,
    );
  }
  if (Number(check!.empties) > 0) {
    throw new Error(
      `Query-table Parquet contains ${check!.empties} null/empty folios; refusing to publish.`,
    );
  }

  return { filePath, rows, bytes: fs.statSync(filePath).size };
}

async function exportTable(
  fileName: string,
  sql: string,
): Promise<{ filePath: string; rows: number; bytes: number }> {
  const filePath = path.join(outDir(), fileName);
  await exec(
    `COPY (${sql}) TO ${lit(filePath)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
  );
  const rows = Number(
    await scalar(`SELECT count(*) FROM read_parquet(${lit(filePath)})`),
  );
  return { filePath, rows, bytes: fs.statSync(filePath).size };
}

/**
 * DuckDB returns BIGINT columns as JS BigInt, which JSON.stringify refuses to
 * serialize. Record counts comfortably fit in a double, so they are narrowed to
 * numbers for the published JSON rather than emitted as strings, which would
 * force every consumer to parse them back.
 */
function writeJson(fileName: string, value: unknown): string {
  const filePath = path.join(outDir(), fileName);
  const json = JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? Number(v) : v),
    2,
  );
  fs.writeFileSync(filePath, json);
  return filePath;
}

/** Run history, published so the UI and the CRM can read it without a backend. */
export async function exportRunHistory(): Promise<string> {
  // Timestamps are cast to ISO strings here rather than left as DuckDB
  // TIMESTAMPTZ values: the JSON writer would otherwise emit them as
  // {"micros": …} objects, which every consumer would have to special-case and
  // which `new Date()` turns into an Invalid Date.
  const runs = await query(`
    SELECT run_id, county, mode, trigger,
           strftime(started_at,  '%Y-%m-%dT%H:%M:%SZ') AS started_at,
           strftime(finished_at, '%Y-%m-%dT%H:%M:%SZ') AS finished_at,
           status,
           sources_attempted, sources_succeeded, sources_skipped_unchanged,
           records_in, inserts, updates, deletes, unchanged, duration_ms,
           limitations, artifacts
      FROM pipeline_runs ORDER BY started_at DESC
  `);
  const steps = await query(`
    SELECT run_id, step_key, seq, status,
           strftime(started_at,  '%Y-%m-%dT%H:%M:%SZ') AS started_at,
           strftime(finished_at, '%Y-%m-%dT%H:%M:%SZ') AS finished_at,
           detail, error
      FROM pipeline_run_steps ORDER BY run_id DESC, seq ASC
  `);
  return writeJson("pipeline-runs.json", {
    county: COUNTY,
    generatedAt: new Date().toISOString(),
    runs,
    steps,
  });
}

/** Per-source coverage, in the shape the Elephant MCP reports completeness from. */
export async function exportCoverage(): Promise<string> {
  const coverage = await query(`
    SELECT 'fl_dor_nal' AS source, count(*) AS ingested_count FROM parcels
    UNION ALL SELECT 'fl_dor_sdf', count(*) FROM sales
    UNION ALL SELECT 'fl_dor_parcel_geometry', count(*) FROM parcel_points
    UNION ALL SELECT 'overture_places', count(*) FROM places
  `);
  const [derived] = await query<Record<string, number>>(`
    SELECT count(*)                                            AS properties,
           count(*) FILTER (WHERE latitude IS NOT NULL)         AS with_coordinates,
           count(*) FILTER (WHERE roof_age_years IS NOT NULL)   AS with_roof_age,
           count(*) FILTER (WHERE last_sale_date IS NOT NULL)   AS with_recorded_sale
      FROM property_query_table
  `);
  return writeJson("dataset-coverage.json", {
    county: COUNTY,
    generatedAt: new Date().toISOString(),
    sources: coverage,
    derived: Object.fromEntries(
      Object.entries(derived!).map(([k, v]) => [k, Number(v)]),
    ),
    notes:
      "Counts are ingested records, not an estimate of what exists upstream. Columns the Duval sources do not provide are published as NULL rather than defaulted.",
  });
}

/**
 * Export, upload, verify, then repoint IPNS.
 *
 * Ordering matters more than it looks. The query table is verified readable at
 * its immutable CID *before* the mutable IPNS pointer is moved, so a corrupt or
 * truncated upload can never leave the published pointer live and broken — the
 * run fails with the old pointer still serving good data.
 *
 * Only the query table gets an IPNS name: the Filebase plan in use allows
 * exactly one (`ERR_TOO_MANY_NAMES` beyond that). It is the right place to spend
 * it, because it is the address wired into elephant-mcp's
 * PROPERTY_QUERY_TABLE_MAP and a stable pointer means the MCP needs no redeploy
 * when data is republished. The other artifacts are immutable per-run snapshots
 * whose CIDs are recorded on the run that produced them, which is stronger
 * provenance than a moving pointer would be.
 *
 * Each artifact is recorded on the run as soon as it lands, not batched at the
 * end, so a failure partway still leaves an accurate record of what is already
 * pinned and publicly visible.
 */
export async function publishArtifacts(ctx: RunContext): Promise<StepResult> {
  if (!FILEBASE.accessKeyId || !FILEBASE.secretAccessKey) {
    ctx.limitation(
      "Filebase credentials are not configured, so this run produced local artifacts but published nothing to IPFS.",
    );
    return { skippedUnchanged: true, reason: "no Filebase credentials" };
  }

  const published: PublishedArtifact[] = [];
  const record = (artifact: PublishedArtifact) => {
    published.push(artifact);
    ctx.artifact(artifact.dataset, artifact);
  };

  // ---- query table: the one artifact with a stable pointer ----
  const queryTable = await exportQueryTable();
  const qtUpload = await uploadFile({
    filePath: queryTable.filePath,
    key: OBJECT_KEYS.queryTable,
    contentType: "application/vnd.apache.parquet",
  });
  const verified = await verifyParquetByCid(qtUpload.cid);
  if (!qtUpload.cidMatchesLocalDerivation) {
    ctx.limitation(
      "The query table's locally derived CID did not match the CID Filebase pinned; the published pointer uses Filebase's value, which is authoritative.",
    );
  }

  // Only now, with the bytes proven readable, is it safe to move the pointer.
  const qtName = await publishIpns(IPNS_LABELS.queryTable, qtUpload.cid);
  const ipnsState = await resolveIpns(qtName.networkKey);
  if (!ipnsState.resolved) {
    ctx.limitation(
      `IPNS ${qtName.label} (${qtName.networkKey}) had not propagated to the gateway when this run finished (last status ${ipnsState.status}). The content is pinned and verified at its CID; the pointer resolves once propagation completes.`,
    );
  }
  record({
    dataset: "query-table",
    ...qtUpload,
    ipnsLabel: qtName.label,
    ipnsName: qtName.networkKey,
    ipnsUrl: gatewayUrl(qtName.networkKey),
    cidUrl: verified.url,
  });

  // ---- supporting artifacts: content-addressed, retrievability confirmed ----
  const places = await exportTable(
    "places.parquet",
    `SELECT place_id, name_primary, brand_name, category_primary,
            latitude, longitude, confidence, source_system, source_artifact_uri
       FROM places ORDER BY place_id`,
  );
  const plUpload = await uploadFile({
    filePath: places.filePath,
    key: OBJECT_KEYS.placeTable,
    contentType: "application/vnd.apache.parquet",
  });
  const plHead = await headByCid(plUpload.cid);
  record({ dataset: "place-table", ...plUpload, cidUrl: plHead.url });

  const coveragePath = await exportCoverage();
  const cUpload = await uploadFile({
    filePath: coveragePath,
    key: OBJECT_KEYS.coverage,
    contentType: "application/json",
  });
  const cHead = await headByCid(cUpload.cid);
  record({ dataset: "dataset-coverage", ...cUpload, cidUrl: cHead.url });

  return {
    // recordsIn is deliberately omitted: finishRun sums it across steps, and the
    // derive step already counted these same properties.
    queryTableRows: queryTable.rows,
    queryTableBytes: queryTable.bytes,
    parquetVerified: verified.magic === "PAR1",
    rangeRequestsSupported: verified.rangeSupported,
    ipnsResolved: ipnsState.resolved,
    placeTableRetrievable: plHead.ok,
    coverageRetrievable: cHead.ok,
    // Exactly the value elephant-mcp expects in PROPERTY_QUERY_TABLE_MAP.
    propertyQueryTableMap: JSON.stringify({
      [COUNTY]: gatewayUrl(qtName.networkKey),
    }),
    propertyQueryTableMapByCid: JSON.stringify({
      [COUNTY]: cidUrl(qtUpload.cid),
    }),
    published,
  };
}

/**
 * Publish the run history *after* the run has been finalised.
 *
 * Exporting it from inside the run that produces it would pin a history whose
 * newest entry is permanently `status: running`, with no duration, no totals and
 * none of the CIDs that run just produced — the exact facts the history exists
 * to show. Running it after `finishRun` costs one extra upload and makes the
 * published history complete; the resulting CID is written back onto the run so
 * the record closes over itself.
 */
export async function publishRunHistory(
  runId: string,
): Promise<{ cid: string; cidUrl: string } | undefined> {
  if (!FILEBASE.accessKeyId || !FILEBASE.secretAccessKey) return undefined;

  const historyPath = await exportRunHistory();
  const upload = await uploadFile({
    filePath: historyPath,
    key: OBJECT_KEYS.runHistory,
    contentType: "application/json",
  });
  const url = cidUrl(upload.cid);

  await exec(`
    UPDATE pipeline_runs
       SET artifacts = json_merge_patch(
             COALESCE(artifacts, '{}'),
             ${lit(JSON.stringify({ "run-history": { dataset: "run-history", cid: upload.cid, cidUrl: url, bytes: upload.bytes } }))}
           )
     WHERE run_id = ${lit(runId)}
  `);
  return { cid: upload.cid, cidUrl: url };
}
