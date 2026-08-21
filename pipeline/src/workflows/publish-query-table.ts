/**
 * Query table publish workflow — export properties to Parquet, upload to Filebase.
 * T041 — Single Parquet file with all searchable columns including derived signals.
 * Uploads to elephant-oracle-query-table-duval at query-tables/duval/query-table.parquet.
 */

import * as restate from '@restatedev/restate-sdk';
import { getPool } from '../lib/db.js';
import { uploadParquet, queryTableBucket, getCid } from '../lib/filebase.js';
import { upsertName, IPNS_LABELS } from '../lib/ipns.js';
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
 * Flatten property records into a tabular format suitable for Parquet.
 */
function flattenProperty(prop: PropertyRecord): Record<string, unknown> {
  return {
    uuid: prop.uuid,
    parcel_id: prop.parcel_id,
    street: prop.address?.street ?? null,
    city: prop.address?.city ?? null,
    state: prop.address?.state ?? null,
    zip: prop.address?.zip ?? null,
    full_address: prop.address?.full ?? null,
    county_jurisdiction: prop.county_jurisdiction,
    assessed_value: prop.assessed_value,
    market_value: prop.market_value,
    current_owner_name: prop.current_owner?.owner_name ?? null,
    current_owner_type: prop.current_owner?.owner_type ?? null,
    year_built: prop.structure?.year_built ?? null,
    sqft: prop.structure?.sqft ?? null,
    stories: prop.structure?.stories ?? null,
    bedrooms: prop.structure?.bedrooms ?? null,
    bathrooms: prop.structure?.bathrooms ?? null,
    roof_type: prop.structure?.roof_type ?? null,
    construction_type: prop.structure?.construction_type ?? null,
    use_code: prop.structure?.use_code ?? null,
    use_description: prop.structure?.use_description ?? null,
    lot_area_sqft: prop.lot?.area_sqft ?? null,
    lot_area_acres: prop.lot?.area_acres ?? null,
    zoning: prop.lot?.zoning ?? null,
    lat: prop.coordinates?.lat ?? null,
    lng: prop.coordinates?.lng ?? null,
    taxable_value: prop.tax?.taxable_value ?? null,
    tax_year: prop.tax?.tax_year ?? null,
    annual_tax: prop.tax?.annual_tax ?? null,
    // Derived signals
    roof_age_years: prop.derived_signals?.roof_age_years ?? null,
    ownership_tenure_years: prop.derived_signals?.ownership_tenure_years ?? null,
    is_regional_owner: prop.derived_signals?.is_regional_owner ?? null,
    water_proximity_ft: prop.derived_signals?.water_proximity_ft ?? null,
    is_waterfront: prop.derived_signals?.is_waterfront ?? null,
    transit_distance_mi: prop.derived_signals?.transit_distance_mi ?? null,
    starbucks_distance_mi: prop.derived_signals?.starbucks_distance_mi ?? null,
    within_walking_transit: prop.derived_signals?.within_walking_transit ?? null,
    within_walking_starbucks: prop.derived_signals?.within_walking_starbucks ?? null,
    // Provenance summary
    source_count: prop.provenance?.contributing_sources?.length ?? 0,
    reconciliation_confidence: prop.provenance?.reconciliation_confidence ?? null,
    last_pipeline_run: prop.provenance?.last_pipeline_run ?? null,
  };
}

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

/**
 * Build a Parquet buffer from flat row data using parquetjs-lite.
 */
async function buildParquetBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  // Dynamic import for ESM compat
  const parquet = await import('parquetjs-lite');

  const schema = new parquet.ParquetSchema({
    uuid: { type: 'UTF8' },
    parcel_id: { type: 'UTF8' },
    street: { type: 'UTF8', optional: true },
    city: { type: 'UTF8', optional: true },
    state: { type: 'UTF8', optional: true },
    zip: { type: 'UTF8', optional: true },
    full_address: { type: 'UTF8', optional: true },
    county_jurisdiction: { type: 'UTF8' },
    assessed_value: { type: 'DOUBLE', optional: true },
    market_value: { type: 'DOUBLE', optional: true },
    current_owner_name: { type: 'UTF8', optional: true },
    current_owner_type: { type: 'UTF8', optional: true },
    year_built: { type: 'INT32', optional: true },
    sqft: { type: 'INT32', optional: true },
    stories: { type: 'INT32', optional: true },
    bedrooms: { type: 'INT32', optional: true },
    bathrooms: { type: 'INT32', optional: true },
    roof_type: { type: 'UTF8', optional: true },
    construction_type: { type: 'UTF8', optional: true },
    use_code: { type: 'UTF8', optional: true },
    use_description: { type: 'UTF8', optional: true },
    lot_area_sqft: { type: 'DOUBLE', optional: true },
    lot_area_acres: { type: 'DOUBLE', optional: true },
    zoning: { type: 'UTF8', optional: true },
    lat: { type: 'DOUBLE', optional: true },
    lng: { type: 'DOUBLE', optional: true },
    taxable_value: { type: 'DOUBLE', optional: true },
    tax_year: { type: 'INT32', optional: true },
    annual_tax: { type: 'DOUBLE', optional: true },
    roof_age_years: { type: 'INT32', optional: true },
    ownership_tenure_years: { type: 'INT32', optional: true },
    is_regional_owner: { type: 'BOOLEAN', optional: true },
    water_proximity_ft: { type: 'DOUBLE', optional: true },
    is_waterfront: { type: 'BOOLEAN', optional: true },
    transit_distance_mi: { type: 'DOUBLE', optional: true },
    starbucks_distance_mi: { type: 'DOUBLE', optional: true },
    within_walking_transit: { type: 'BOOLEAN', optional: true },
    within_walking_starbucks: { type: 'BOOLEAN', optional: true },
    source_count: { type: 'INT32', optional: true },
    reconciliation_confidence: { type: 'DOUBLE', optional: true },
    last_pipeline_run: { type: 'UTF8', optional: true },
  });

  // Write to a buffer via a temp approach using ParquetTransformer or writer
  // parquetjs-lite supports writing to a buffer via ParquetEnvelopeWriter
  const writer = await parquet.ParquetWriter.openBuffer(schema);

  for (const row of rows) {
    // Filter out null/undefined values — parquetjs-lite handles optional via absence
    const cleanRow: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val !== null && val !== undefined) {
        cleanRow[key] = val;
      }
    }
    await writer.appendRow(cleanRow);
  }

  await writer.close();

  // ParquetWriter.openBuffer returns a writer whose toBuffer() gives the result
  return (writer as unknown as { toBuffer: () => Buffer }).toBuffer();
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
