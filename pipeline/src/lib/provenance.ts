/**
 * Provenance metadata helpers.
 * T013 — Create and merge provenance objects for property records.
 */

import type { Provenance } from './types.js';

/**
 * Create a fresh provenance object for a newly discovered record.
 */
export function createProvenance(
  sourceId: string,
  runId: string,
  confidence?: number,
): Provenance {
  return {
    contributing_sources: [sourceId],
    collection_timestamps: {
      [sourceId]: new Date().toISOString(),
    },
    last_pipeline_run: runId,
    reconciliation_confidence: confidence ?? 1.0,
  };
}

/**
 * Merge new source provenance into an existing provenance object.
 * - Adds the source to contributing_sources (deduped)
 * - Updates collection_timestamps for this source
 * - Updates last_pipeline_run
 * - Takes the minimum reconciliation_confidence
 */
export function mergeProvenance(
  existing: Provenance,
  sourceId: string,
  runId: string,
  confidence?: number,
): Provenance {
  const sources = new Set(existing.contributing_sources);
  sources.add(sourceId);

  const timestamps = { ...existing.collection_timestamps };
  timestamps[sourceId] = new Date().toISOString();

  const newConfidence = confidence ?? existing.reconciliation_confidence;

  return {
    contributing_sources: Array.from(sources).sort(),
    collection_timestamps: timestamps,
    last_pipeline_run: runId,
    source_artifact_uri: existing.source_artifact_uri,
    reconciliation_confidence: Math.min(existing.reconciliation_confidence, newConfidence),
  };
}

/**
 * Merge two provenance objects from different reconciled records.
 * Used when combining data from multiple sources for the same parcel.
 */
export function reconcileProvenance(
  a: Provenance,
  b: Provenance,
  runId: string,
  confidence: number,
): Provenance {
  const sources = new Set([...a.contributing_sources, ...b.contributing_sources]);
  const timestamps = { ...a.collection_timestamps, ...b.collection_timestamps };

  return {
    contributing_sources: Array.from(sources).sort(),
    collection_timestamps: timestamps,
    last_pipeline_run: runId,
    reconciliation_confidence: confidence,
  };
}

/**
 * Attach provenance to a record, returning the provenance field for DB storage.
 */
export function provenanceToJson(provenance: Provenance): string {
  return JSON.stringify(provenance);
}

/**
 * Parse provenance from DB JSONB field.
 */
export function provenanceFromJson(json: unknown): Provenance {
  if (typeof json === 'string') {
    return JSON.parse(json) as Provenance;
  }
  if (json && typeof json === 'object') {
    return json as Provenance;
  }
  return {
    contributing_sources: [],
    collection_timestamps: {},
    last_pipeline_run: '',
    reconciliation_confidence: 0,
  };
}
