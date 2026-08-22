/**
 * Publish workflow — Restate durable workflow for publishing property records to IPFS.
 * T040 — Export records to per-property JSON, generate index/manifest/delta,
 * upload to Filebase, update IPNS pointer.
 */

import * as restate from '@restatedev/restate-sdk';
import { randomUUID } from 'node:crypto';
import { getPool } from '../lib/db.js';
import {
  uploadJson,
  openDataBucket,
  getCid,
} from '../lib/filebase.js';
import { upsertName, resolveIpns, IPNS_LABELS, getName } from '../lib/ipns.js';
import type { PropertyRecord, DeltaCounts } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishRequest {
  runId: string;
  county: string;
  delta: DeltaCounts;
  /** Parcel IDs that were newly added in this run. */
  newParcelIds?: string[];
  /** Parcel IDs that were updated in this run. */
  updatedParcelIds?: string[];
  /** Parcel IDs that were removed in this run. */
  removedParcelIds?: string[];
}

export interface PublishResult {
  artifactCid: string | null;
  ipnsPointer: string | null;
  propertyCount: number;
  shardCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SHARD_SIZE = 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch all property records for a county from Postgres.
 */
async function fetchAllProperties(county: string): Promise<PropertyRecord[]> {
  const pool = getPool();
  const result = await pool.query<PropertyRecord>(
    `SELECT uuid, parcel_id, address, county_jurisdiction,
            assessed_value, market_value, ownership, current_owner,
            permits, structure, lot, coordinates, tax,
            provenance, derived_signals, content_hash,
            created_at, updated_at
     FROM properties
     WHERE county_jurisdiction = $1
     ORDER BY parcel_id`,
    [county],
  );

  // Parse JSON columns that come back as strings
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
 * Get the previous run's manifest for delta comparison.
 */
async function getPreviousRunInfo(
  county: string,
  currentRunId: string,
): Promise<{ runId: string; cid: string } | null> {
  const pool = getPool();
  const result = await pool.query<{ run_id: string; published_artifact_cid: string }>(
    `SELECT run_id, published_artifact_cid
     FROM pipeline_runs
     WHERE county = $1
       AND status IN ('success', 'partial')
       AND published_artifact_cid IS NOT NULL
       AND run_id != $2
     ORDER BY completed_at DESC
     LIMIT 1`,
    [county, currentRunId],
  );
  const row = result.rows[0];
  if (!row || !row.published_artifact_cid) return null;
  return { runId: row.run_id, cid: row.published_artifact_cid };
}

// ---------------------------------------------------------------------------
// Workflow: publish
// ---------------------------------------------------------------------------

export const publishWorkflow = restate.workflow({
  name: 'publish',
  handlers: {
    /**
     * Main publish workflow: export all property records to IPFS.
     */
    run: async (
      ctx: restate.WorkflowContext,
      request: PublishRequest,
    ): Promise<PublishResult> => {
      const { runId, county, delta, newParcelIds, updatedParcelIds, removedParcelIds } = request;
      const startTime = Date.now();
      const bucket = openDataBucket();

      console.info(`[publish] Starting publish for run=${runId}, county=${county}`);

      // Step 1: Fetch all property records
      const properties = await ctx.run('fetch-properties', () => fetchAllProperties(county));
      const propertyCount = properties.length;

      if (propertyCount === 0) {
        console.warn('[publish] No properties to publish');
        return {
          artifactCid: null,
          ipnsPointer: null,
          propertyCount: 0,
          shardCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      console.info(`[publish] Publishing ${propertyCount} properties`);

      // Step 2: Upload per-property JSON files
      for (let i = 0; i < properties.length; i++) {
        const prop = properties[i]!;
        const key = `properties/${prop.uuid}.json`;
        await ctx.run(`upload-property-${i}`, () =>
          uploadJson(bucket, key, {
            uuid: prop.uuid,
            parcel_id: prop.parcel_id,
            address: prop.address,
            county_jurisdiction: prop.county_jurisdiction,
            assessed_value: prop.assessed_value,
            market_value: prop.market_value,
            ownership: prop.ownership,
            current_owner: prop.current_owner,
            permits: prop.permits,
            structure: prop.structure,
            lot: prop.lot,
            coordinates: prop.coordinates,
            tax: prop.tax,
            provenance: prop.provenance,
            derived_signals: prop.derived_signals,
          }),
        );
      }

      // Step 3: Generate and upload shards
      const shardCount = Math.ceil(propertyCount / SHARD_SIZE);
      const shardEntries: Array<{ file: string; count: number }> = [];

      for (let s = 0; s < shardCount; s++) {
        const start = s * SHARD_SIZE;
        const end = Math.min(start + SHARD_SIZE, propertyCount);
        const shardProperties = properties.slice(start, end).map((p) => ({
          uuid: p.uuid,
          parcel_id: p.parcel_id,
          address: p.address,
        }));

        const shardKey = `shards/shard-${String(s).padStart(4, '0')}.json`;
        await ctx.run(`upload-shard-${s}`, () => uploadJson(bucket, shardKey, shardProperties));

        shardEntries.push({ file: shardKey, count: end - start });
      }

      // Step 4: Generate and upload index.json
      const indexData = {
        county,
        property_count: propertyCount,
        shard_count: shardCount,
        published_at: new Date().toISOString(),
        run_id: runId,
        shards: shardEntries,
      };
      await ctx.run('upload-index', () => uploadJson(bucket, 'index.json', indexData));

      // Step 5: Generate and upload manifest.json
      const manifestData = {
        county,
        property_count: propertyCount,
        properties: properties.map((p) => ({
          uuid: p.uuid,
          parcel_id: p.parcel_id,
          file: `properties/${p.uuid}.json`,
        })),
        published_at: new Date().toISOString(),
        run_id: runId,
      };
      await ctx.run('upload-manifest', () => uploadJson(bucket, 'manifest.json', manifestData));

      // Step 6: Generate and upload delta.json
      const previousRun = await ctx.run('get-previous-run', () =>
        getPreviousRunInfo(county, runId),
      );

      const deltaData = {
        run_id: runId,
        previous_run_id: previousRun?.runId ?? null,
        previous_cid: previousRun?.cid ?? null,
        new_count: delta.new_count,
        updated_count: delta.updated_count,
        removed_count: delta.removed_count,
        new_parcel_ids: newParcelIds ?? [],
        updated_parcel_ids: updatedParcelIds ?? [],
        removed_parcel_ids: removedParcelIds ?? [],
      };
      await ctx.run('upload-delta', () => uploadJson(bucket, 'delta.json', deltaData));

      // Step 7: Retrieve the CID for the index (represents the artifact)
      const artifactCid = await ctx.run('get-cid', () => getCid(bucket, 'index.json'));

      // Step 8: Update IPNS pointer
      let ipnsPointer: string | null = null;
      if (artifactCid) {
        const ipnsResult = await ctx.run('update-ipns', () =>
          upsertName(IPNS_LABELS.openData, artifactCid),
        );
        ipnsPointer = ipnsResult.network_key;
      }

      // Step 9: Update pipeline_run record with publish info
      await ctx.run('update-run', async () => {
        const pool = getPool();
        await pool.query(
          `UPDATE pipeline_runs
           SET published_artifact_cid = $2,
               ipns_pointer = $3
           WHERE run_id = $1`,
          [runId, artifactCid, ipnsPointer],
        );
      });

      const result: PublishResult = {
        artifactCid,
        ipnsPointer,
        propertyCount,
        shardCount,
        durationMs: Date.now() - startTime,
      };

      console.info(
        `[publish] Complete: cid=${artifactCid}, ipns=${ipnsPointer}, ` +
          `properties=${propertyCount}, shards=${shardCount}, ${result.durationMs}ms`,
      );

      return result;
    },

    /**
     * Get the current status of the publish workflow.
     */
    getStatus: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext): Promise<string> => {
        return `Publish workflow ${ctx.key} is active`;
      },
    ),
  },
});

export type PublishApi = typeof publishWorkflow;

// ---------------------------------------------------------------------------
// CLI entry point: run publish workflow standalone
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const county = process.argv[2] ?? 'duval';
  const runId = randomUUID();

  console.info(`[publish-cli] Starting standalone publish for county=${county}, runId=${runId}`);

  const properties = await fetchAllProperties(county);
  const bucket = openDataBucket();

  if (properties.length === 0) {
    console.warn('[publish-cli] No properties found to publish');
    process.exit(1);
  }

  console.info(`[publish-cli] Found ${properties.length} properties`);

  // Upload per-property JSON files
  for (const prop of properties) {
    const key = `properties/${prop.uuid}.json`;
    await uploadJson(bucket, key, {
      uuid: prop.uuid,
      parcel_id: prop.parcel_id,
      address: prop.address,
      county_jurisdiction: prop.county_jurisdiction,
      assessed_value: prop.assessed_value,
      market_value: prop.market_value,
      ownership: prop.ownership,
      current_owner: prop.current_owner,
      permits: prop.permits,
      structure: prop.structure,
      lot: prop.lot,
      coordinates: prop.coordinates,
      tax: prop.tax,
      provenance: prop.provenance,
      derived_signals: prop.derived_signals,
    });
  }

  // Generate shards
  const shardCount = Math.ceil(properties.length / SHARD_SIZE);
  const shardEntries: Array<{ file: string; count: number }> = [];

  for (let s = 0; s < shardCount; s++) {
    const start = s * SHARD_SIZE;
    const end = Math.min(start + SHARD_SIZE, properties.length);
    const shardProperties = properties.slice(start, end).map((p) => ({
      uuid: p.uuid,
      parcel_id: p.parcel_id,
      address: p.address,
    }));

    const shardKey = `shards/shard-${String(s).padStart(4, '0')}.json`;
    await uploadJson(bucket, shardKey, shardProperties);
    shardEntries.push({ file: shardKey, count: end - start });
  }

  // Upload index.json
  const indexData = {
    county,
    property_count: properties.length,
    shard_count: shardCount,
    published_at: new Date().toISOString(),
    run_id: runId,
    shards: shardEntries,
  };
  await uploadJson(bucket, 'index.json', indexData);

  // Upload manifest.json
  const manifestData = {
    county,
    property_count: properties.length,
    properties: properties.map((p) => ({
      uuid: p.uuid,
      parcel_id: p.parcel_id,
      file: `properties/${p.uuid}.json`,
    })),
    published_at: new Date().toISOString(),
    run_id: runId,
  };
  await uploadJson(bucket, 'manifest.json', manifestData);

  // Upload delta.json
  const previousRun = await getPreviousRunInfo(county, runId);
  const deltaData = {
    run_id: runId,
    previous_run_id: previousRun?.runId ?? null,
    previous_cid: previousRun?.cid ?? null,
    new_count: properties.length,
    updated_count: 0,
    removed_count: 0,
    new_parcel_ids: properties.map((p) => p.parcel_id),
    updated_parcel_ids: [],
    removed_parcel_ids: [],
  };
  await uploadJson(bucket, 'delta.json', deltaData);

  // Get CID and update IPNS
  const artifactCid = await getCid(bucket, 'index.json');
  if (artifactCid) {
    const ipnsResult = await upsertName(IPNS_LABELS.openData, artifactCid);
    console.info(`[publish-cli] IPNS updated: label=${IPNS_LABELS.openData}, key=${ipnsResult.network_key}`);
  }

  console.info(`[publish-cli] Done: ${properties.length} properties, ${shardCount} shards, cid=${artifactCid}`);
  process.exit(0);
}

// Run CLI when executed directly
const isDirectRun = process.argv[1]?.includes('publish.ts') || process.argv[1]?.includes('publish.js');
if (isDirectRun) {
  main().catch((err) => {
    console.error('[publish-cli] Fatal error:', err);
    process.exit(1);
  });
}
