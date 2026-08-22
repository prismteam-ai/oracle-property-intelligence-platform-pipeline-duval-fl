/**
 * Restate virtual object for parcel reconciliation.
 * T028 — Merge records from multiple sources into a unified Property Record.
 */

import * as restate from '@restatedev/restate-sdk';
import { randomUUID } from 'node:crypto';
import { getPool } from '../lib/db.js';
import { reconcileProvenance } from '../lib/provenance.js';
import type {
  PropertyRecord,
  Provenance,
  DerivedSignals,
  Address,
  OwnershipRecord,
  Permit,
  TransformResult,
} from '../lib/types.js';

// ---------------------------------------------------------------------------
// Matching signals for reconciliation
// ---------------------------------------------------------------------------

/**
 * Normalize an address string for comparison.
 */
function normalizeAddress(addr: Address | undefined): string {
  if (!addr) return '';
  const parts = [addr.street, addr.city, addr.state, addr.zip]
    .filter(Boolean)
    .join(' ');
  return parts
    .toLowerCase()
    .replace(/\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place)\b/g, (m) => {
      const map: Record<string, string> = {
        st: 'street', street: 'street',
        ave: 'avenue', avenue: 'avenue',
        blvd: 'boulevard', boulevard: 'boulevard',
        rd: 'road', road: 'road',
        dr: 'drive', drive: 'drive',
        ln: 'lane', lane: 'lane',
        ct: 'court', court: 'court',
        pl: 'place', place: 'place',
      };
      return map[m] ?? m;
    })
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize an owner name for comparison.
 */
function normalizeOwnerName(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute a reconciliation confidence score based on matching signals.
 */
function computeConfidence(
  primary: TransformResult,
  secondary: TransformResult,
): number {
  let score = 0;
  let signals = 0;

  // Primary: parcel_id match (already guaranteed by key)
  score += 1.0;
  signals++;

  // Secondary: address normalization match
  const addr1 = normalizeAddress(primary.fields.address);
  const addr2 = normalizeAddress(secondary.fields.address);
  if (addr1 && addr2) {
    signals++;
    if (addr1 === addr2) {
      score += 1.0;
    } else if (addr1.includes(addr2) || addr2.includes(addr1)) {
      score += 0.7;
    }
  }

  // Tertiary: owner name match
  const owner1 = normalizeOwnerName(primary.fields.current_owner?.owner_name);
  const owner2 = normalizeOwnerName(secondary.fields.current_owner?.owner_name);
  if (owner1 && owner2) {
    signals++;
    if (owner1 === owner2) {
      score += 1.0;
    } else if (owner1.includes(owner2) || owner2.includes(owner1)) {
      score += 0.5;
    }
  }

  return signals > 0 ? score / signals : 0;
}

// ---------------------------------------------------------------------------
// Merge logic
// ---------------------------------------------------------------------------

/**
 * Merge derived signals from multiple sources.
 * Prefer non-null values; for numeric values, prefer the most recent source.
 */
function mergeDerivedSignals(
  a: DerivedSignals | undefined,
  b: DerivedSignals | undefined,
): DerivedSignals {
  const merged: DerivedSignals = { ...a };

  if (b) {
    // For each signal, prefer non-undefined values
    if (b.roof_age_years !== undefined) merged.roof_age_years = b.roof_age_years;
    if (b.ownership_tenure_years !== undefined) merged.ownership_tenure_years = b.ownership_tenure_years;
    if (b.is_regional_owner !== undefined) merged.is_regional_owner = b.is_regional_owner;
    if (b.water_proximity_ft !== undefined) merged.water_proximity_ft = b.water_proximity_ft;
    if (b.is_waterfront !== undefined) merged.is_waterfront = b.is_waterfront;
    if (b.transit_distance_mi !== undefined) merged.transit_distance_mi = b.transit_distance_mi;
    if (b.starbucks_distance_mi !== undefined) merged.starbucks_distance_mi = b.starbucks_distance_mi;
    if (b.within_walking_transit !== undefined) merged.within_walking_transit = b.within_walking_transit;
    if (b.within_walking_starbucks !== undefined) merged.within_walking_starbucks = b.within_walking_starbucks;
  }

  return merged;
}

/**
 * Merge ownership histories, deduplicating by transfer_date + owner_name.
 */
function mergeOwnership(
  a: OwnershipRecord[] | undefined,
  b: OwnershipRecord[] | undefined,
): OwnershipRecord[] {
  const all = [...(a ?? []), ...(b ?? [])];
  const seen = new Set<string>();
  const deduped: OwnershipRecord[] = [];

  for (const record of all) {
    const key = `${normalizeOwnerName(record.owner_name)}:${record.transfer_date ?? 'unknown'}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(record);
    }
  }

  // Sort by transfer date descending
  return deduped.sort((x, y) => {
    const dateA = x.transfer_date ?? '';
    const dateB = y.transfer_date ?? '';
    return dateB.localeCompare(dateA);
  });
}

/**
 * Merge permit lists, deduplicating by permit_number.
 */
function mergePermits(
  a: Permit[] | undefined,
  b: Permit[] | undefined,
): Permit[] {
  const all = [...(a ?? []), ...(b ?? [])];
  const seen = new Set<string>();
  const deduped: Permit[] = [];

  for (const permit of all) {
    const key = permit.permit_number ?? `${permit.issue_date}:${permit.permit_type}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(permit);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Restate virtual object
// ---------------------------------------------------------------------------

export const parcelObject = restate.object({
  name: 'parcel',
  handlers: {
    /**
     * Reconcile records from multiple sources for a single parcel.
     * Merges all fields, deduplicates ownership/permits, computes confidence.
     */
    reconcile: async (
      ctx: restate.ObjectContext,
      request: {
        parcelId: string;
        runId: string;
        sourceRecords: TransformResult[];
      },
    ): Promise<{ confidence: number; merged: Partial<PropertyRecord> }> => {
      const { parcelId, runId, sourceRecords } = request;

      if (sourceRecords.length === 0) {
        return { confidence: 0, merged: {} };
      }

      // Start with the first record as base
      let merged: Partial<PropertyRecord> = { ...sourceRecords[0]!.fields };
      let baseProvenance: Provenance = merged.provenance ?? {
        contributing_sources: [],
        collection_timestamps: {},
        last_pipeline_run: runId,
        reconciliation_confidence: 1.0,
      };

      let totalConfidence = 1.0;
      let reconciliationCount = 0;

      // Merge subsequent source records
      for (let i = 1; i < sourceRecords.length; i++) {
        const incoming = sourceRecords[i]!;
        const confidence = computeConfidence(sourceRecords[0]!, incoming);
        totalConfidence += confidence;
        reconciliationCount++;

        // Merge address (prefer more complete)
        if (incoming.fields.address) {
          const existingAddr = normalizeAddress(merged.address);
          const incomingAddr = normalizeAddress(incoming.fields.address);
          if (incomingAddr.length > existingAddr.length) {
            merged.address = incoming.fields.address;
          }
        }

        // Merge scalar values (prefer non-null)
        if (incoming.fields.assessed_value !== undefined && incoming.fields.assessed_value !== null) {
          merged.assessed_value = incoming.fields.assessed_value;
        }
        if (incoming.fields.market_value !== undefined && incoming.fields.market_value !== null) {
          merged.market_value = incoming.fields.market_value;
        }
        if (incoming.fields.current_owner) {
          merged.current_owner = incoming.fields.current_owner;
        }
        if (incoming.fields.coordinates) {
          merged.coordinates = incoming.fields.coordinates;
        }

        // Merge complex objects
        if (incoming.fields.structure) {
          merged.structure = { ...merged.structure, ...incoming.fields.structure };
        }
        if (incoming.fields.lot) {
          merged.lot = { ...merged.lot, ...incoming.fields.lot };
        }
        if (incoming.fields.tax) {
          merged.tax = { ...merged.tax, ...incoming.fields.tax };
        }

        // Merge lists
        merged.ownership = mergeOwnership(merged.ownership, incoming.fields.ownership);
        merged.permits = mergePermits(merged.permits, incoming.fields.permits);

        // Merge derived signals
        merged.derived_signals = mergeDerivedSignals(
          merged.derived_signals,
          incoming.fields.derived_signals,
        );

        // Merge provenance
        const incomingProvenance = incoming.fields.provenance ?? {
          contributing_sources: [],
          collection_timestamps: {},
          last_pipeline_run: runId,
          reconciliation_confidence: confidence,
        };

        baseProvenance = reconcileProvenance(
          baseProvenance,
          incomingProvenance,
          runId,
          confidence,
        );
      }

      const avgConfidence =
        reconciliationCount > 0
          ? totalConfidence / (reconciliationCount + 1)
          : 1.0;

      baseProvenance.reconciliation_confidence = Math.round(avgConfidence * 100) / 100;
      merged.provenance = baseProvenance;

      const pool = getPool();

      // ---------------------------------------------------------------------------
      // Edge-5: Ambiguity guard — when confidence < 0.5, preserve records
      // separately instead of merging. Create a new property record for each
      // low-confidence source so no data is lost.
      // ---------------------------------------------------------------------------
      if (avgConfidence < 0.5 && sourceRecords.length > 1) {
        console.info(
          `[parcel] Ambiguity guard triggered for ${parcelId}: confidence ${avgConfidence.toFixed(2)} < 0.5 — preserving ${sourceRecords.length} records separately`,
        );

        // Keep the first record as the primary (update existing row)
        const primary = sourceRecords[0]!;
        const primaryProvenance: Provenance = {
          ...(primary.fields.provenance ?? {
            contributing_sources: [],
            collection_timestamps: {},
            last_pipeline_run: runId,
            reconciliation_confidence: avgConfidence,
          }),
          reconciliation_confidence: avgConfidence,
          last_pipeline_run: runId,
        };
        primaryProvenance.contributing_sources = [
          ...(primaryProvenance.contributing_sources ?? []),
        ];
        if (!primaryProvenance.contributing_sources.includes('ambiguity-primary')) {
          primaryProvenance.contributing_sources.push('ambiguity-primary');
        }

        await pool.query(
          `UPDATE properties SET
            address = COALESCE($2, address),
            assessed_value = COALESCE($3, assessed_value),
            market_value = COALESCE($4, market_value),
            ownership = $5,
            current_owner = COALESCE($6, current_owner),
            permits = $7,
            structure = $8,
            lot = $9,
            coordinates = COALESCE($10, coordinates),
            tax = $11,
            provenance = $12,
            derived_signals = $13,
            updated_at = NOW()
          WHERE parcel_id = $1`,
          [
            parcelId,
            JSON.stringify(primary.fields.address ?? null),
            primary.fields.assessed_value ?? null,
            primary.fields.market_value ?? null,
            JSON.stringify(primary.fields.ownership ?? []),
            JSON.stringify(primary.fields.current_owner ?? null),
            JSON.stringify(primary.fields.permits ?? []),
            JSON.stringify(primary.fields.structure ?? {}),
            JSON.stringify(primary.fields.lot ?? {}),
            JSON.stringify(primary.fields.coordinates ?? null),
            JSON.stringify(primary.fields.tax ?? {}),
            JSON.stringify(primaryProvenance),
            JSON.stringify(primary.fields.derived_signals ?? {}),
          ],
        );

        // Insert remaining source records as separate property records with new UUIDs
        for (let i = 1; i < sourceRecords.length; i++) {
          const alt = sourceRecords[i]!;
          const altUuid = randomUUID();
          const altParcelId = `${parcelId}__ambiguous_${i}`;
          const altProvenance: Provenance = {
            ...(alt.fields.provenance ?? {
              contributing_sources: [],
              collection_timestamps: {},
              last_pipeline_run: runId,
              reconciliation_confidence: avgConfidence,
            }),
            reconciliation_confidence: avgConfidence,
            last_pipeline_run: runId,
          };
          altProvenance.contributing_sources = [
            ...(altProvenance.contributing_sources ?? []),
          ];
          if (!altProvenance.contributing_sources.includes('ambiguity-alternate')) {
            altProvenance.contributing_sources.push('ambiguity-alternate');
          }
          // Record the original parcel_id this was split from
          (altProvenance as unknown as Record<string, unknown>).ambiguity_source_parcel = parcelId;

          await pool.query(
            `INSERT INTO properties (uuid, parcel_id, address, assessed_value, market_value,
              ownership, current_owner, permits, structure, lot, coordinates, tax,
              provenance, derived_signals, county_jurisdiction, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'duval', NOW())
            ON CONFLICT (parcel_id) DO UPDATE SET
              address = EXCLUDED.address,
              provenance = EXCLUDED.provenance,
              updated_at = NOW()`,
            [
              altUuid,
              altParcelId,
              JSON.stringify(alt.fields.address ?? null),
              alt.fields.assessed_value ?? null,
              alt.fields.market_value ?? null,
              JSON.stringify(alt.fields.ownership ?? []),
              JSON.stringify(alt.fields.current_owner ?? null),
              JSON.stringify(alt.fields.permits ?? []),
              JSON.stringify(alt.fields.structure ?? {}),
              JSON.stringify(alt.fields.lot ?? {}),
              JSON.stringify(alt.fields.coordinates ?? null),
              JSON.stringify(alt.fields.tax ?? {}),
              JSON.stringify(altProvenance),
              JSON.stringify(alt.fields.derived_signals ?? {}),
            ],
          );
        }

        return { confidence: avgConfidence, merged };
      }

      // ---------------------------------------------------------------------------
      // Normal merge path (confidence >= 0.5)
      // ---------------------------------------------------------------------------

      // Persist merged record to Postgres
      await pool.query(
        `UPDATE properties SET
          address = COALESCE($2, address),
          assessed_value = COALESCE($3, assessed_value),
          market_value = COALESCE($4, market_value),
          ownership = $5,
          current_owner = COALESCE($6, current_owner),
          permits = $7,
          structure = $8,
          lot = $9,
          coordinates = COALESCE($10, coordinates),
          tax = $11,
          provenance = $12,
          derived_signals = $13,
          updated_at = NOW()
        WHERE parcel_id = $1`,
        [
          parcelId,
          JSON.stringify(merged.address ?? null),
          merged.assessed_value ?? null,
          merged.market_value ?? null,
          JSON.stringify(merged.ownership ?? []),
          JSON.stringify(merged.current_owner ?? null),
          JSON.stringify(merged.permits ?? []),
          JSON.stringify(merged.structure ?? {}),
          JSON.stringify(merged.lot ?? {}),
          JSON.stringify(merged.coordinates ?? null),
          JSON.stringify(merged.tax ?? {}),
          JSON.stringify(baseProvenance),
          JSON.stringify(merged.derived_signals ?? {}),
        ],
      );

      console.info(
        `[parcel] Reconciled ${parcelId}: ${sourceRecords.length} sources, confidence ${avgConfidence.toFixed(2)}`,
      );

      return { confidence: avgConfidence, merged };
    },

    /**
     * Get the current state of a parcel from the database.
     */
    getParcel: async (
      _ctx: restate.ObjectContext,
      request: { parcelId: string },
    ): Promise<PropertyRecord | null> => {
      const pool = getPool();
      const result = await pool.query<PropertyRecord>(
        'SELECT * FROM properties WHERE parcel_id = $1',
        [request.parcelId],
      );
      return result.rows[0] ?? null;
    },
  },
});

export type ParcelApi = typeof parcelObject;
