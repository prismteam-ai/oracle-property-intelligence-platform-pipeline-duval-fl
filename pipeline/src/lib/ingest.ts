/**
 * Core ingestion function — extracted from pilot-ingest.ts for reuse.
 * Called by the CLI script and the POST /api/runs/trigger route.
 */

import { createHash } from 'node:crypto';
import { getPool, runMigrations } from './db.js';

// Source adapters (mock generators)
import { generateMockAppraiserRecord } from '../sources/appraiser.js';
import { generateMockPermitRecord } from '../sources/permits.js';
import { generateMockOwnershipRecord } from '../sources/ownership.js';
import { generateMockGeoRecord } from '../sources/geo.js';
import { generateMockBusinessRecord } from '../sources/business.js';
import { generateMockContractorRecord } from '../sources/contractor.js';
import { generateMockSunbizRecord } from '../sources/sunbiz.js';
import { generateMockBBBRecord } from '../sources/bbb.js';

// Transforms
import { transformAppraiserRecords } from '../transforms/duval/appraiser-transform.js';
import { transformPermitRecords } from '../transforms/duval/permits-transform.js';
import { transformOwnershipRecords } from '../transforms/duval/ownership-transform.js';
import { transformGeoRecords } from '../transforms/duval/geo-transform.js';
import { transformBusinessRecords } from '../transforms/duval/business-transform.js';
import { transformContractorRecords } from '../transforms/duval/contractor-transform.js';
import { transformSunbizRecords } from '../transforms/duval/sunbiz-transform.js';
import { transformBBBRecords } from '../transforms/duval/bbb-transform.js';

// Provenance
import { createProvenance, mergeProvenance } from './provenance.js';

// Feeder
import { feed } from './feeder.js';

import type {
  RawRecord,
  TransformResult,
  DeltaCounts,
  Provenance,
  DerivedSignals,
} from './types.js';

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

function computeContentHash(fields: Partial<Record<string, unknown>>): string {
  const normalized = JSON.stringify(fields, Object.keys(fields).sort());
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Source registry
// ---------------------------------------------------------------------------

interface SourceEntry {
  sourceId: string;
  name: string;
  category: 'property' | 'permit' | 'ownership' | 'business' | 'contractor' | 'location';
  url: string;
  collectionMethod: 'browser-flow' | 'api' | 'bulk-download' | 'scrape';
  mockGenerator: (parcelId: string) => RawRecord;
  transform: (records: RawRecord[]) => TransformResult[];
}

const SOURCE_ENTRIES: SourceEntry[] = [
  { sourceId: 'duval-appraiser', name: 'Duval County Property Appraiser', category: 'property', url: 'https://apps.coj.net/PAO_PropertySearch/', collectionMethod: 'browser-flow', mockGenerator: generateMockAppraiserRecord, transform: transformAppraiserRecords },
  { sourceId: 'duval-permits', name: 'Duval County Permits', category: 'permit', url: 'https://buildinginspections.coj.net/', collectionMethod: 'browser-flow', mockGenerator: generateMockPermitRecord, transform: transformPermitRecords },
  { sourceId: 'duval-ownership', name: 'Duval County Ownership Records', category: 'ownership', url: 'https://apps.coj.net/PAO_PropertySearch/', collectionMethod: 'browser-flow', mockGenerator: generateMockOwnershipRecord, transform: transformOwnershipRecords },
  { sourceId: 'duval-geo', name: 'Duval County GIS', category: 'location', url: 'https://maps.coj.net/duval/', collectionMethod: 'api', mockGenerator: generateMockGeoRecord, transform: transformGeoRecords },
  { sourceId: 'duval-business', name: 'Duval County Business Tax Receipts', category: 'business', url: 'https://apps.coj.net/PAO_PropertySearch/', collectionMethod: 'browser-flow', mockGenerator: generateMockBusinessRecord, transform: transformBusinessRecords },
  { sourceId: 'duval-contractor', name: 'FL DBPR Contractor Licenses', category: 'contractor', url: 'https://www.myfloridalicense.com/wl11.asp', collectionMethod: 'scrape', mockGenerator: generateMockContractorRecord, transform: transformContractorRecords },
  { sourceId: 'duval-sunbiz', name: 'FL Sunbiz Corporate Registry', category: 'business', url: 'https://search.sunbiz.org/', collectionMethod: 'scrape', mockGenerator: generateMockSunbizRecord, transform: transformSunbizRecords },
  { sourceId: 'duval-bbb', name: 'BBB Business Profiles', category: 'business', url: 'https://www.bbb.org/', collectionMethod: 'scrape', mockGenerator: generateMockBBBRecord, transform: transformBBBRecords },
];

// ---------------------------------------------------------------------------
// Standalone loader (bypasses Restate for direct DB access)
// ---------------------------------------------------------------------------

async function loadRecordsDirect(
  runId: string,
  sourceId: string,
  records: TransformResult[],
): Promise<DeltaCounts> {
  const pool = getPool();
  let newCount = 0;
  let updatedCount = 0;

  for (const record of records) {
    const contentHash = computeContentHash(record.fields as Record<string, unknown>);
    const parcelId = record.parcel_id;

    // Check existing record (parcel_id is natural key — idempotency guard)
    const existing = await pool.query<{
      uuid: string;
      content_hash: string | null;
      provenance: Provenance;
      derived_signals: DerivedSignals;
    }>(
      'SELECT uuid, content_hash, provenance, derived_signals FROM properties WHERE parcel_id = $1',
      [parcelId],
    );

    if (existing.rows.length === 0) {
      const provenance = createProvenance(sourceId, runId);

      await pool.query(
        `INSERT INTO properties (
          parcel_id, address, county_jurisdiction,
          assessed_value, market_value, ownership, current_owner,
          permits, structure, lot, coordinates, tax,
          provenance, derived_signals, content_hash
        ) VALUES (
          $1, $2, 'duval',
          $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14
        )
        ON CONFLICT (parcel_id) DO NOTHING`,
        [
          parcelId,
          JSON.stringify(record.fields.address ?? {}),
          record.fields.assessed_value ?? null,
          record.fields.market_value ?? null,
          JSON.stringify(record.fields.ownership ?? []),
          JSON.stringify(record.fields.current_owner ?? null),
          JSON.stringify(record.fields.permits ?? []),
          JSON.stringify(record.fields.structure ?? {}),
          JSON.stringify(record.fields.lot ?? {}),
          JSON.stringify(record.fields.coordinates ?? null),
          JSON.stringify(record.fields.tax ?? {}),
          JSON.stringify(provenance),
          JSON.stringify(record.fields.derived_signals ?? {}),
          contentHash,
        ],
      );
      newCount++;
    } else {
      const row = existing.rows[0]!;

      // Content hash comparison — idempotency guard
      if (row.content_hash === contentHash) {
        continue; // No change, skip
      }

      const existingProvenance =
        typeof row.provenance === 'string'
          ? (JSON.parse(row.provenance) as Provenance)
          : (row.provenance as Provenance);

      const newProvenance = mergeProvenance(existingProvenance, sourceId, runId);

      const existingSignals =
        typeof row.derived_signals === 'string'
          ? (JSON.parse(row.derived_signals) as DerivedSignals)
          : (row.derived_signals as DerivedSignals);

      const mergedSignals = { ...existingSignals, ...record.fields.derived_signals };

      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      const setField = (col: string, val: unknown) => {
        if (val !== undefined) {
          updates.push(`${col} = $${paramIdx}`);
          values.push(typeof val === 'object' ? JSON.stringify(val) : val);
          paramIdx++;
        }
      };

      if (record.fields.address) setField('address', record.fields.address);
      if (record.fields.assessed_value !== undefined) setField('assessed_value', record.fields.assessed_value);
      if (record.fields.market_value !== undefined) setField('market_value', record.fields.market_value);
      if (record.fields.ownership) setField('ownership', record.fields.ownership);
      if (record.fields.current_owner !== undefined) setField('current_owner', record.fields.current_owner);
      if (record.fields.permits) setField('permits', record.fields.permits);
      if (record.fields.structure) setField('structure', record.fields.structure);
      if (record.fields.lot) setField('lot', record.fields.lot);
      if (record.fields.coordinates !== undefined) setField('coordinates', record.fields.coordinates);
      if (record.fields.tax) setField('tax', record.fields.tax);

      setField('provenance', newProvenance);
      setField('derived_signals', mergedSignals);
      setField('content_hash', contentHash);
      setField('updated_at', new Date().toISOString());

      if (updates.length > 0) {
        values.push(parcelId);
        await pool.query(
          `UPDATE properties SET ${updates.join(', ')} WHERE parcel_id = $${paramIdx}`,
          values,
        );
        updatedCount++;
      }
    }
  }

  return { new_count: newCount, updated_count: updatedCount, removed_count: 0 };
}

// ---------------------------------------------------------------------------
// Main ingestion function
// ---------------------------------------------------------------------------

export interface IngestionOptions {
  county: string;
  limit?: number;
  runId: string;
}

/**
 * Run the full ingestion pipeline for a county.
 * Creates/uses parcel IDs, iterates all 8 source adapters, transforms,
 * loads into DB, and updates the pipeline_run record with results.
 *
 * The caller is responsible for creating the pipeline_run record beforehand
 * (with status 'running'). This function updates it on completion.
 */
export async function runIngestion(options: IngestionOptions): Promise<void> {
  const { county, limit, runId } = options;
  const startTime = Date.now();

  console.info('='.repeat(60));
  console.info(`Oracle Pipeline — County Ingestion`);
  console.info(`  County: ${county}`);
  console.info(`  Limit:  ${limit ?? 'full'}`);
  console.info(`  Run ID: ${runId}`);
  console.info(`  Mode:   ${limit ? 'pilot' : 'full county'}`);
  console.info('='.repeat(60));

  // Step 1: Run migrations
  console.info('\n[1/4] Running database migrations...');
  await runMigrations();

  const pool = getPool();

  // Step 2: Ensure data_sources rows exist (FK requirement for run_sources)
  console.info('\n[2/5] Ensuring data_sources catalog...');
  for (const entry of SOURCE_ENTRIES) {
    await pool.query(
      `INSERT INTO data_sources (source_id, name, category, url, collection_method)
       VALUES ($1, $2, $3::source_category, $4, $5::collection_method)
       ON CONFLICT (source_id) DO NOTHING`,
      [entry.sourceId, entry.name, entry.category, entry.url, entry.collectionMethod],
    );
  }

  // Step 3: Get parcel IDs from seed data
  console.info('\n[3/5] Loading parcel IDs...');
  let parcelIds: string[];

  const result = await pool.query<{ parcel_id: string }>(
    `SELECT parcel_id FROM properties WHERE county_jurisdiction = $1 ORDER BY parcel_id${limit ? ` LIMIT ${limit}` : ''}`,
    [county],
  );
  parcelIds = result.rows.map((r) => r.parcel_id);

  // If no seed data, generate test parcels
  if (parcelIds.length === 0) {
    const count = limit ?? 25;
    console.info(`  No seed data found, generating ${count} test parcels...`);
    parcelIds = Array.from({ length: count }, (_, i) =>
      `RE${String(i + 1).padStart(7, '0')}`,
    );
  }

  console.info(`  Found ${parcelIds.length} parcels to process`);

  // Step 3: Ingest each source
  console.info('\n[4/5] Ingesting sources...');
  const totalDelta: DeltaCounts = { new_count: 0, updated_count: 0, removed_count: 0 };
  const limitations: string[] = [];
  let hasFailure = false;

  for (const entry of SOURCE_ENTRIES) {
    const sourceStart = Date.now();
    console.info(`\n  --- Source: ${entry.sourceId} ---`);

    try {
      // Generate mock data
      const rawRecords = parcelIds.map((id) => entry.mockGenerator(id));
      console.info(`    Fetched ${rawRecords.length} raw records`);

      // Transform
      const transformed = entry.transform(rawRecords);
      console.info(`    Transformed ${transformed.length} records`);

      // Load into DB using feeder for backpressure
      const feederResult = await feed(
        transformed,
        async (batch) => {
          const delta = await loadRecordsDirect(runId, entry.sourceId, batch);
          return [delta];
        },
        { batchSize: 50, concurrency: 1, delayBetweenBatchesMs: 10 },
      );

      // Aggregate deltas
      const sourceDelta: DeltaCounts = { new_count: 0, updated_count: 0, removed_count: 0 };
      for (const d of feederResult.results) {
        sourceDelta.new_count += d.new_count;
        sourceDelta.updated_count += d.updated_count;
        sourceDelta.removed_count += d.removed_count;
      }

      totalDelta.new_count += sourceDelta.new_count;
      totalDelta.updated_count += sourceDelta.updated_count;
      totalDelta.removed_count += sourceDelta.removed_count;

      const sourceDuration = Date.now() - sourceStart;
      console.info(
        `    Result: +${sourceDelta.new_count} new, ~${sourceDelta.updated_count} updated (${sourceDuration}ms)`,
      );

      // Record run_sources
      await pool.query(
        `INSERT INTO run_sources (run_id, source_id, records_ingested, duration_ms, status, limitations)
         VALUES ($1, $2, $3, $4, 'success', $5)
         ON CONFLICT (run_id, source_id) DO UPDATE SET
           records_ingested = EXCLUDED.records_ingested,
           duration_ms = EXCLUDED.duration_ms,
           status = EXCLUDED.status`,
        [runId, entry.sourceId, sourceDelta.new_count + sourceDelta.updated_count, sourceDuration, null],
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`    FAILED: ${error}`);
      hasFailure = true;
      limitations.push(`${entry.sourceId}: ${error}`);

      await pool.query(
        `INSERT INTO run_sources (run_id, source_id, records_ingested, duration_ms, status, limitations)
         VALUES ($1, $2, 0, 0, 'failed', $3)
         ON CONFLICT (run_id, source_id) DO UPDATE SET status = 'failed', limitations = EXCLUDED.limitations`,
        [runId, entry.sourceId, error],
      );
    }
  }

  // Step 4: Update pipeline_run
  console.info('\n[5/5] Finalizing pipeline run...');
  const recordCount = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM properties WHERE county_jurisdiction = $1',
    [county],
  );
  const totalRecords = parseInt(recordCount.rows[0]?.count ?? '0', 10);
  const status = hasFailure ? 'partial' : 'success';

  await pool.query(
    `UPDATE pipeline_runs
     SET completed_at = NOW(), status = $2, record_count = $3,
         delta_new = $4, delta_updated = $5, delta_removed = $6,
         source_limitations = $7
     WHERE run_id = $1`,
    [runId, status, totalRecords, totalDelta.new_count, totalDelta.updated_count, totalDelta.removed_count, JSON.stringify(limitations)],
  );

  const totalDuration = Date.now() - startTime;

  console.info('\n' + '='.repeat(60));
  console.info('INGESTION COMPLETE');
  console.info('='.repeat(60));
  console.info(`  Status:        ${status}`);
  console.info(`  Run ID:        ${runId}`);
  console.info(`  Total Records: ${totalRecords}`);
  console.info(`  New:           ${totalDelta.new_count}`);
  console.info(`  Updated:       ${totalDelta.updated_count}`);
  console.info(`  Removed:       ${totalDelta.removed_count}`);
  console.info(`  Duration:      ${totalDuration}ms`);
  if (limitations.length > 0) {
    console.info(`  Limitations:   ${limitations.length}`);
    for (const lim of limitations) {
      console.info(`    - ${lim}`);
    }
  }
  console.info('='.repeat(60));
}
