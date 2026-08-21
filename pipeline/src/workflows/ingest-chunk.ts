/**
 * Ingest chunk workflow — Restate durable workflow for single-source ingestion.
 * T030 — Call source adapter -> transform -> loader, return per-source delta and timing.
 */

import * as restate from '@restatedev/restate-sdk';
import type { DeltaCounts, RawRecord, TransformResult, SourceAdapter, TransformFn } from '../lib/types.js';
import type { SourceResult } from './county-ingest.js';

// Source adapters
import { appraiserAdapter, generateMockAppraiserRecord } from '../sources/appraiser.js';
import { permitsAdapter, generateMockPermitRecord } from '../sources/permits.js';
import { ownershipAdapter, generateMockOwnershipRecord } from '../sources/ownership.js';
import { geoAdapter, generateMockGeoRecord } from '../sources/geo.js';
import { businessAdapter, generateMockBusinessRecord } from '../sources/business.js';
import { contractorAdapter, generateMockContractorRecord } from '../sources/contractor.js';
import { sunbizAdapter, generateMockSunbizRecord } from '../sources/sunbiz.js';
import { bbbAdapter, generateMockBBBRecord } from '../sources/bbb.js';

// Transforms
import { transformAppraiserRecords } from '../transforms/duval/appraiser-transform.js';
import { transformPermitRecords } from '../transforms/duval/permits-transform.js';
import { transformOwnershipRecords } from '../transforms/duval/ownership-transform.js';
import { transformGeoRecords } from '../transforms/duval/geo-transform.js';
import { transformBusinessRecords } from '../transforms/duval/business-transform.js';
import { transformContractorRecords } from '../transforms/duval/contractor-transform.js';
import { transformSunbizRecords } from '../transforms/duval/sunbiz-transform.js';
import { transformBBBRecords } from '../transforms/duval/bbb-transform.js';

// Loader
import type { loaderObject } from '../services/loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestChunkRequest {
  runId: string;
  sourceId: string;
  sourceName: string;
  parcelIds: string[];
  limit?: number;
}

// ---------------------------------------------------------------------------
// Source registry — maps source_id to adapter + transform + mock generator
// ---------------------------------------------------------------------------

interface SourceEntry {
  adapter: SourceAdapter;
  transform: TransformFn;
  mockGenerator: (parcelId: string) => RawRecord;
}

const SOURCE_REGISTRY: Record<string, SourceEntry> = {
  'duval-appraiser': {
    adapter: appraiserAdapter,
    transform: transformAppraiserRecords,
    mockGenerator: generateMockAppraiserRecord,
  },
  'duval-permits': {
    adapter: permitsAdapter,
    transform: transformPermitRecords,
    mockGenerator: generateMockPermitRecord,
  },
  'duval-ownership': {
    adapter: ownershipAdapter,
    transform: transformOwnershipRecords,
    mockGenerator: generateMockOwnershipRecord,
  },
  'duval-geo': {
    adapter: geoAdapter,
    transform: transformGeoRecords,
    mockGenerator: generateMockGeoRecord,
  },
  'duval-business': {
    adapter: businessAdapter,
    transform: transformBusinessRecords,
    mockGenerator: generateMockBusinessRecord,
  },
  'duval-contractor': {
    adapter: contractorAdapter,
    transform: transformContractorRecords,
    mockGenerator: generateMockContractorRecord,
  },
  'duval-sunbiz': {
    adapter: sunbizAdapter,
    transform: transformSunbizRecords,
    mockGenerator: generateMockSunbizRecord,
  },
  'duval-bbb': {
    adapter: bbbAdapter,
    transform: transformBBBRecords,
    mockGenerator: generateMockBBBRecord,
  },
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Use mock data instead of real adapters (for dev/testing). */
const USE_MOCK = process.env.PIPELINE_USE_MOCK !== 'false';

/** Batch size for loader calls. */
const LOADER_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Workflow: ingest-chunk
// ---------------------------------------------------------------------------

export const ingestChunkWorkflow = restate.workflow({
  name: 'ingest-chunk',
  handlers: {
    /**
     * Ingest a single source for a set of parcels.
     */
    run: async (
      ctx: restate.WorkflowContext,
      request: IngestChunkRequest,
    ): Promise<SourceResult> => {
      const { runId, sourceId, sourceName, parcelIds, limit } = request;
      const startTime = Date.now();

      console.info(`[ingest-chunk] Source=${sourceId}, parcels=${parcelIds.length}, limit=${limit ?? 'all'}`);

      const entry = SOURCE_REGISTRY[sourceId];
      if (!entry) {
        console.warn(`[ingest-chunk] Unknown source: ${sourceId}, skipping`);
        return {
          sourceId,
          sourceName,
          delta: { new_count: 0, updated_count: 0, removed_count: 0 },
          durationMs: Date.now() - startTime,
          status: 'skipped',
          limitations: `Unknown source: ${sourceId}`,
        };
      }

      try {
        // Step 1: Fetch raw records from source adapter (or use mocks)
        let rawRecords: RawRecord[];

        if (USE_MOCK) {
          const idsToProcess = limit ? parcelIds.slice(0, limit) : parcelIds;
          rawRecords = await ctx.run(`fetch-mock-${sourceId}`, () =>
            idsToProcess.map((id) => entry.mockGenerator(id)),
          );
        } else {
          rawRecords = await ctx.run(`fetch-${sourceId}`, () =>
            entry.adapter.fetch(parcelIds, { limit }),
          );
        }

        if (rawRecords.length === 0) {
          console.info(`[ingest-chunk] No records from ${sourceId}`);
          return {
            sourceId,
            sourceName,
            delta: { new_count: 0, updated_count: 0, removed_count: 0 },
            durationMs: Date.now() - startTime,
            status: 'success',
            limitations: null,
          };
        }

        // Step 2: Transform raw records
        const transformed: TransformResult[] = await ctx.run(`transform-${sourceId}`, () =>
          entry.transform(rawRecords),
        );

        console.info(`[ingest-chunk] Transformed ${transformed.length} records from ${sourceId}`);

        // Step 3: Load records into DB via loader service in batches
        const totalDelta: DeltaCounts = { new_count: 0, updated_count: 0, removed_count: 0 };

        for (let i = 0; i < transformed.length; i += LOADER_BATCH_SIZE) {
          const batch = transformed.slice(i, i + LOADER_BATCH_SIZE);
          const batchNum = Math.floor(i / LOADER_BATCH_SIZE);

          const delta = await ctx
            .objectClient<typeof loaderObject>({ name: 'loader' }, 'default')
            .loadBatch({
              runId,
              sourceId,
              records: batch,
            });

          totalDelta.new_count += delta.new_count;
          totalDelta.updated_count += delta.updated_count;
          totalDelta.removed_count += delta.removed_count;

          console.info(
            `[ingest-chunk] ${sourceId} batch ${batchNum}: +${delta.new_count} new, ~${delta.updated_count} updated`,
          );
        }

        const durationMs = Date.now() - startTime;
        console.info(
          `[ingest-chunk] ${sourceId} complete: new=${totalDelta.new_count}, updated=${totalDelta.updated_count}, ${durationMs}ms`,
        );

        return {
          sourceId,
          sourceName,
          delta: totalDelta,
          durationMs,
          status: 'success',
          limitations: null,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error(`[ingest-chunk] ${sourceId} failed:`, error);

        return {
          sourceId,
          sourceName,
          delta: { new_count: 0, updated_count: 0, removed_count: 0 },
          durationMs: Date.now() - startTime,
          status: 'failed',
          limitations: error,
          error,
        };
      }
    },

    /**
     * Get the current status of this chunk workflow.
     */
    getStatus: restate.handlers.workflow.shared(
      async (ctx: restate.WorkflowSharedContext): Promise<string> => {
        return `Chunk workflow ${ctx.key} is active`;
      },
    ),
  },
});

export type IngestChunkApi = typeof ingestChunkWorkflow;
