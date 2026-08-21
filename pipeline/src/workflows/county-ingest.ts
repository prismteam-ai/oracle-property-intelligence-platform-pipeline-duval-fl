/**
 * County ingest workflow — Restate durable workflow for full county ingestion.
 * T029 — Creates pipeline_run, iterates sources, invokes ingest-chunk per source,
 * aggregates deltas, updates run status.
 */

import * as restate from '@restatedev/restate-sdk';
import { randomUUID } from 'node:crypto';
import { getPool } from '../lib/db.js';
import { getDuvalCatalog } from '../sources/duval-catalog.js';
import type { DeltaCounts, PipelineRunStatus, DataSource } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CountyIngestRequest {
  county: string;
  limit?: number;
  parcelIds?: string[];
}

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  delta: DeltaCounts;
  durationMs: number;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  limitations: string | null;
  error?: string;
}

export interface CountyIngestResult {
  runId: string;
  county: string;
  status: PipelineRunStatus;
  totalDelta: DeltaCounts;
  sourceResults: SourceResult[];
  recordCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a pipeline_run record in Postgres.
 */
async function createPipelineRun(runId: string, county: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO pipeline_runs (run_id, county, started_at, status, record_count, delta_new, delta_updated, delta_removed, source_limitations)
     VALUES ($1, $2, NOW(), 'running', 0, 0, 0, 0, '[]'::jsonb)`,
    [runId, county],
  );
}

/**
 * Update pipeline_run with final status and aggregated counts.
 */
async function updatePipelineRun(
  runId: string,
  status: PipelineRunStatus,
  delta: DeltaCounts,
  recordCount: number,
  limitations: string[],
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE pipeline_runs
     SET completed_at = NOW(),
         status = $2,
         record_count = $3,
         delta_new = $4,
         delta_updated = $5,
         delta_removed = $6,
         source_limitations = $7
     WHERE run_id = $1`,
    [runId, status, recordCount, delta.new_count, delta.updated_count, delta.removed_count, JSON.stringify(limitations)],
  );
}

/**
 * Record per-source run results in run_sources table.
 */
async function recordRunSource(
  runId: string,
  result: SourceResult,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO run_sources (run_id, source_id, records_ingested, duration_ms, status, limitations)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (run_id, source_id) DO UPDATE SET
       records_ingested = EXCLUDED.records_ingested,
       duration_ms = EXCLUDED.duration_ms,
       status = EXCLUDED.status,
       limitations = EXCLUDED.limitations`,
    [
      runId,
      result.sourceId,
      result.delta.new_count + result.delta.updated_count,
      result.durationMs,
      result.status,
      result.limitations,
    ],
  );
}

/**
 * Get total property count for a county.
 */
async function getRecordCount(county: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM properties WHERE county_jurisdiction = $1',
    [county],
  );
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get parcel IDs from the database for a county.
 */
async function getParcelIds(county: string, limit?: number): Promise<string[]> {
  const pool = getPool();
  let sql = 'SELECT parcel_id FROM properties WHERE county_jurisdiction = $1 ORDER BY parcel_id';
  const params: unknown[] = [county];
  if (limit) {
    sql += ' LIMIT $2';
    params.push(limit);
  }
  const result = await pool.query<{ parcel_id: string }>(sql, params);
  return result.rows.map((r) => r.parcel_id);
}

// ---------------------------------------------------------------------------
// Source catalog to adapter/transform mapping
// ---------------------------------------------------------------------------

/**
 * Get the list of sources to ingest based on the catalog.
 */
function getIngestSources(county: string): DataSource[] {
  if (county === 'duval') {
    return getDuvalCatalog();
  }
  return [];
}

// ---------------------------------------------------------------------------
// Workflow: county-ingest
// ---------------------------------------------------------------------------

export const countyIngestWorkflow = restate.workflow({
  name: 'county-ingest',
  handlers: {
    /**
     * Main workflow: ingest all sources for a county.
     */
    run: async (
      ctx: restate.WorkflowContext,
      request: CountyIngestRequest,
    ): Promise<CountyIngestResult> => {
      const runId = ctx.key;
      const { county, limit } = request;
      const startTime = Date.now();

      console.info(`[county-ingest] Starting run ${runId} for county=${county}, limit=${limit ?? 'all'}`);

      // Step 1: Create pipeline_run record
      await ctx.run('create-run', () => createPipelineRun(runId, county));

      // Step 2: Get parcel IDs to process
      const parcelIds = request.parcelIds ??
        await ctx.run('get-parcels', () => getParcelIds(county, limit));

      if (parcelIds.length === 0) {
        console.warn(`[county-ingest] No parcels found for county=${county}`);
        const emptyDelta: DeltaCounts = { new_count: 0, updated_count: 0, removed_count: 0 };
        await ctx.run('update-run-empty', () => updatePipelineRun(runId, 'success', emptyDelta, 0, []));
        return {
          runId,
          county,
          status: 'success',
          totalDelta: emptyDelta,
          sourceResults: [],
          recordCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      console.info(`[county-ingest] Processing ${parcelIds.length} parcels across sources`);

      // Step 3: Get sources from catalog
      const sources = getIngestSources(county);

      // Step 4: Invoke ingest-chunk for each source
      const sourceResults: SourceResult[] = [];
      const totalDelta: DeltaCounts = { new_count: 0, updated_count: 0, removed_count: 0 };
      const allLimitations: string[] = [];
      let hasFailure = false;
      let hasSuccess = false;

      for (const source of sources) {
        try {
          console.info(`[county-ingest] Ingesting source: ${source.source_id}`);

          const chunkResult = await ctx
            .workflowClient<typeof ingestChunkWorkflow>({ name: 'ingest-chunk' }, `${runId}-${source.source_id}`)
            .run({
              runId,
              sourceId: source.source_id,
              sourceName: source.name,
              parcelIds,
              limit,
            });

          sourceResults.push(chunkResult);
          totalDelta.new_count += chunkResult.delta.new_count;
          totalDelta.updated_count += chunkResult.delta.updated_count;
          totalDelta.removed_count += chunkResult.delta.removed_count;

          if (chunkResult.limitations) {
            allLimitations.push(`${source.source_id}: ${chunkResult.limitations}`);
          }

          if (chunkResult.status === 'success' || chunkResult.status === 'partial') {
            hasSuccess = true;
          }
          if (chunkResult.status === 'failed') {
            hasFailure = true;
          }

          // Record per-source result
          await ctx.run(`record-source-${source.source_id}`, () => recordRunSource(runId, chunkResult));
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`[county-ingest] Source ${source.source_id} failed:`, error);

          const failedResult: SourceResult = {
            sourceId: source.source_id,
            sourceName: source.name,
            delta: { new_count: 0, updated_count: 0, removed_count: 0 },
            durationMs: 0,
            status: 'failed',
            limitations: source.limitations,
            error,
          };
          sourceResults.push(failedResult);
          hasFailure = true;

          await ctx.run(`record-source-failed-${source.source_id}`, () => recordRunSource(runId, failedResult));
        }
      }

      // Step 5: Determine overall status
      let status: PipelineRunStatus = 'success';
      if (hasFailure && hasSuccess) {
        status = 'partial';
      } else if (hasFailure && !hasSuccess) {
        status = 'failed';
      }

      // Step 6: Get final record count and update pipeline_run
      const recordCount = await ctx.run('get-count', () => getRecordCount(county));
      await ctx.run('update-run', () => updatePipelineRun(runId, status, totalDelta, recordCount, allLimitations));

      const result: CountyIngestResult = {
        runId,
        county,
        status,
        totalDelta,
        sourceResults,
        recordCount,
        durationMs: Date.now() - startTime,
      };

      console.info(
        `[county-ingest] Run ${runId} complete: status=${status}, ` +
          `new=${totalDelta.new_count}, updated=${totalDelta.updated_count}, ` +
          `removed=${totalDelta.removed_count}, total=${recordCount}, ` +
          `duration=${result.durationMs}ms`,
      );

      return result;
    },

    /**
     * Get the current status of a running workflow.
     */
    getStatus: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext): Promise<string> => {
        return `Workflow ${ctx.key} is active`;
      },
    ),
  },
});

// Forward-declare ingest-chunk type for the workflow client call
import type { ingestChunkWorkflow } from './ingest-chunk.js';

export type CountyIngestApi = typeof countyIngestWorkflow;
