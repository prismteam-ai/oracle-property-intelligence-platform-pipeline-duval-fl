/**
 * Query table publish workflow — export properties to Parquet, upload to Filebase.
 * T041 — Single Parquet file with all searchable columns including derived signals.
 * Uploads to elephant-oracle-query-table-duval at query-tables/duval/query-table.parquet.
 */

import * as restate from '@restatedev/restate-sdk';
import { getPool } from '../lib/db.js';
import { uploadParquet, queryTableBucket, getCid } from '../lib/filebase.js';
import { upsertName, IPNS_LABELS } from '../lib/ipns.js';
import { flattenProperty, buildParquetBuffer } from '../lib/parquet-helpers.js';
import type { PropertyRecord } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryTablePublishRequest {
  runId: string;
  county: string;
}

export interface QueryTablePublishResult {
  artifactCid: string | null;
  ipnsPointer: string | null;
  rowCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all property records for a county.
 */
async function fetchAllProperties(county: string): Promise<PropertyRecord[]> {
  const pool = getPool();
  const result = await pool.query<PropertyRecord>(
    `SELECT uuid, parcel_id, address, county_jurisdiction,
            assessed_value, market_value, ownership, current_owner,
            permits, structure, lot, coordinates, tax,
            provenance, derived_signals
     FROM properties
     WHERE county_jurisdiction = $1
     ORDER BY parcel_id`,
    [county],
  );

  return result.rows.map((row) => ({
    ...row,
    address: typeof row.address === 'string' ? JSON.parse(row.address) : row.address,
    ownership: typeof row.ownership === 'string' ? JSON.parse(row.ownership) : row.ownership,
    current_owner: typeof row.current_owner === 'string' ? JSON.parse(row.current_owner) : row.current_owner,
    permits: typeof row.permits === 'string' ? JSON.parse(row.permits) : row.permits,
    structure: typeof row.structure === 'string' ? JSON.parse(row.structure) : row.structure,
    lot: typeof row.lot === 'string' ? JSON.parse(row.lot) : row.lot,
    coordinates: typeof row.coordinates === 'string' ? JSON.parse(row.coordinates) : row.coordinates,
    tax: typeof row.tax === 'string' ? JSON.parse(row.tax) : row.tax,
    provenance: typeof row.provenance === 'string' ? JSON.parse(row.provenance) : row.provenance,
    derived_signals: typeof row.derived_signals === 'string' ? JSON.parse(row.derived_signals) : row.derived_signals,
  }));
}

// ---------------------------------------------------------------------------
// Workflow: publish-query-table
// ---------------------------------------------------------------------------

export const publishQueryTableWorkflow = restate.workflow({
  name: 'publish-query-table',
  handlers: {
    /**
     * Export all property records to Parquet and upload to Filebase.
     */
    run: async (
      ctx: restate.WorkflowContext,
      request: QueryTablePublishRequest,
    ): Promise<QueryTablePublishResult> => {
      const { runId, county } = request;
      const startTime = Date.now();
      const bucket = queryTableBucket();

      console.info(`[publish-query-table] Starting for run=${runId}, county=${county}`);

      // Step 1: Fetch all property records
      const properties = await ctx.run('fetch-properties', () => fetchAllProperties(county));

      if (properties.length === 0) {
        console.warn('[publish-query-table] No properties to publish');
        return {
          artifactCid: null,
          ipnsPointer: null,
          rowCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 2: Flatten to tabular format
      const flatRows = await ctx.run('flatten-rows', () => properties.map(flattenProperty));

      console.info(`[publish-query-table] Flattened ${flatRows.length} rows`);

      // Step 3: Build Parquet buffer
      const parquetBuffer = await ctx.run('build-parquet', () => buildParquetBuffer(flatRows));

      console.info(`[publish-query-table] Parquet buffer: ${parquetBuffer.length} bytes`);

      // Step 4: Upload to Filebase
      const key = `query-tables/${county}/query-table.parquet`;
      await ctx.run('upload-parquet', () => uploadParquet(bucket, key, parquetBuffer));

      // Step 5: Get CID
      const artifactCid = await ctx.run('get-cid', () => getCid(bucket, key));

      // Step 6: Update IPNS pointer
      let ipnsPointer: string | null = null;
      if (artifactCid) {
        const ipnsResult = await ctx.run('update-ipns', () =>
          upsertName(IPNS_LABELS.queryTable, artifactCid),
        );
        ipnsPointer = ipnsResult.network_key;
      }

      const result: QueryTablePublishResult = {
        artifactCid,
        ipnsPointer,
        rowCount: properties.length,
        durationMs: Date.now() - startTime,
      };

      console.info(
        `[publish-query-table] Complete: cid=${artifactCid}, ipns=${ipnsPointer}, ` +
          `rows=${properties.length}, ${result.durationMs}ms`,
      );

      return result;
    },

    /**
     * Get the current status.
     */
    getStatus: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext): Promise<string> => {
        return `Query table publish workflow ${ctx.key} is active`;
      },
    ),
  },
});

export type PublishQueryTableApi = typeof publishQueryTableWorkflow;

// ---------------------------------------------------------------------------
// CLI entry point: run query table publish standalone
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const county = process.argv[2] ?? 'duval';

  console.info(`[query-table-cli] Starting standalone query table publish for county=${county}`);

  const properties = await fetchAllProperties(county);

  if (properties.length === 0) {
    console.warn('[query-table-cli] No properties found');
    process.exit(1);
  }

  const flatRows = properties.map(flattenProperty);
  const parquetBuffer = await buildParquetBuffer(flatRows);

  const bucket = queryTableBucket();
  const key = `query-tables/${county}/query-table.parquet`;
  await uploadParquet(bucket, key, parquetBuffer);

  const artifactCid = await getCid(bucket, key);
  if (artifactCid) {
    const ipnsResult = await upsertName(IPNS_LABELS.queryTable, artifactCid);
    console.info(`[query-table-cli] IPNS updated: label=${IPNS_LABELS.queryTable}, key=${ipnsResult.network_key}`);
  }

  console.info(`[query-table-cli] Done: ${properties.length} rows, cid=${artifactCid}`);
  process.exit(0);
}

const isDirectRun =
  process.argv[1]?.includes('publish-query-table.ts') ||
  process.argv[1]?.includes('publish-query-table.js');
if (isDirectRun) {
  main().catch((err) => {
    console.error('[query-table-cli] Fatal error:', err);
    process.exit(1);
  });
}
