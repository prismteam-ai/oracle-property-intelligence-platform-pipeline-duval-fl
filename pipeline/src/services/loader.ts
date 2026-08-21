/**
 * Restate virtual object for loading transformed records into Postgres.
 * T027 — Content-aware watermarks for incremental detection, delta counts.
 */

import * as restate from '@restatedev/restate-sdk';
import { createHash } from 'node:crypto';
import { getPool } from '../lib/db.js';
import { mergeProvenance, createProvenance } from '../lib/provenance.js';
import type {
  PropertyRecord,
  TransformResult,
  DeltaCounts,
  Provenance,
  DerivedSignals,
} from '../lib/types.js';

// ---------------------------------------------------------------------------
// Content hashing for watermark-based change detection
// ---------------------------------------------------------------------------

/**
 * Compute a content hash of the incoming record fields for change detection.
 */
function computeContentHash(fields: Partial<PropertyRecord>): string {
  const normalized = JSON.stringify(fields, Object.keys(fields).sort());
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Loader handlers
// ---------------------------------------------------------------------------

export const loaderObject = restate.object({
  name: 'loader',
  handlers: {
    /**
     * Load a batch of transformed records into the database.
     * Compares content hashes to detect changes (watermark).
     * Returns delta counts (new, updated, removed).
     */
    loadBatch: async (
      ctx: restate.ObjectContext,
      request: {
        runId: string;
        sourceId: string;
        records: TransformResult[];
      },
    ): Promise<DeltaCounts> => {
      const { runId, sourceId, records } = request;
      const pool = getPool();

      let newCount = 0;
      let updatedCount = 0;

      for (const record of records) {
        const contentHash = computeContentHash(record.fields);
        const parcelId = record.parcel_id;

        // Check existing record
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
          // New record — insert
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
          // Existing record — compare content hash for watermark
          const row = existing.rows[0]!;

          if (row.content_hash === contentHash) {
            // No change — skip (watermark match)
            continue;
          }

          // Record has changed — update
          const existingProvenance =
            typeof row.provenance === 'string'
              ? (JSON.parse(row.provenance) as Provenance)
              : (row.provenance as Provenance);

          const newProvenance = mergeProvenance(existingProvenance, sourceId, runId);

          // Merge derived signals (keep existing, overlay new)
          const existingSignals =
            typeof row.derived_signals === 'string'
              ? (JSON.parse(row.derived_signals) as DerivedSignals)
              : (row.derived_signals as DerivedSignals);

          const mergedSignals = {
            ...existingSignals,
            ...record.fields.derived_signals,
          };

          // Build SET clause dynamically for non-null fields
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

      console.info(
        `[loader] Batch for ${sourceId}: ${newCount} new, ${updatedCount} updated (${records.length} total)`,
      );

      return {
        new_count: newCount,
        updated_count: updatedCount,
        removed_count: 0,
      };
    },

    /**
     * Get the current record count in the database.
     */
    getRecordCount: async (
      _ctx: restate.ObjectContext,
    ): Promise<number> => {
      const pool = getPool();
      const result = await pool.query<{ count: string }>(
        "SELECT COUNT(*) as count FROM properties WHERE county_jurisdiction = 'duval'",
      );
      return parseInt(result.rows[0]?.count ?? '0', 10);
    },
  },
});

export type LoaderApi = typeof loaderObject;
