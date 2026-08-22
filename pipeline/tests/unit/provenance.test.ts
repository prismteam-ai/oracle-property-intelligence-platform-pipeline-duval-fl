/**
 * Unit tests for provenance helpers.
 * T068 — Verify create, merge, reconcile, and serialization logic.
 */

import { describe, it, expect } from 'vitest';
import {
  createProvenance,
  mergeProvenance,
  reconcileProvenance,
  provenanceToJson,
  provenanceFromJson,
} from '../../src/lib/provenance.js';

describe('provenance', () => {
  describe('createProvenance', () => {
    it('creates a provenance with a single source', () => {
      const p = createProvenance('appraiser', 'run-001');
      expect(p.contributing_sources).toEqual(['appraiser']);
      expect(p.collection_timestamps).toHaveProperty('appraiser');
      expect(p.last_pipeline_run).toBe('run-001');
      expect(p.reconciliation_confidence).toBe(1.0);
    });

    it('accepts a custom confidence', () => {
      const p = createProvenance('permits', 'run-002', 0.85);
      expect(p.reconciliation_confidence).toBe(0.85);
    });
  });

  describe('mergeProvenance', () => {
    it('adds a new source to existing provenance', () => {
      const existing = createProvenance('appraiser', 'run-001');
      const merged = mergeProvenance(existing, 'permits', 'run-002');

      expect(merged.contributing_sources).toContain('appraiser');
      expect(merged.contributing_sources).toContain('permits');
      expect(merged.contributing_sources).toHaveLength(2);
      expect(merged.last_pipeline_run).toBe('run-002');
      expect(merged.collection_timestamps).toHaveProperty('permits');
    });

    it('deduplicates sources', () => {
      const existing = createProvenance('appraiser', 'run-001');
      const merged = mergeProvenance(existing, 'appraiser', 'run-002');

      expect(merged.contributing_sources).toEqual(['appraiser']);
    });

    it('sorts contributing sources alphabetically', () => {
      const existing = createProvenance('permits', 'run-001');
      const merged = mergeProvenance(existing, 'appraiser', 'run-002');

      expect(merged.contributing_sources).toEqual(['appraiser', 'permits']);
    });

    it('takes the minimum reconciliation confidence', () => {
      const existing = createProvenance('appraiser', 'run-001', 0.9);
      const merged = mergeProvenance(existing, 'permits', 'run-002', 0.7);

      expect(merged.reconciliation_confidence).toBe(0.7);
    });

    it('preserves source_artifact_uri from existing provenance', () => {
      const existing = createProvenance('appraiser', 'run-001');
      (existing as Record<string, unknown>).source_artifact_uri = 'ipfs://abc123';
      const merged = mergeProvenance(existing, 'permits', 'run-002');

      expect(merged.source_artifact_uri).toBe('ipfs://abc123');
    });
  });

  describe('reconcileProvenance', () => {
    it('merges two independent provenance objects', () => {
      const a = createProvenance('appraiser', 'run-001');
      const b = createProvenance('permits', 'run-001');

      const reconciled = reconcileProvenance(a, b, 'run-002', 0.95);

      expect(reconciled.contributing_sources).toEqual(['appraiser', 'permits']);
      expect(reconciled.collection_timestamps).toHaveProperty('appraiser');
      expect(reconciled.collection_timestamps).toHaveProperty('permits');
      expect(reconciled.last_pipeline_run).toBe('run-002');
      expect(reconciled.reconciliation_confidence).toBe(0.95);
    });

    it('deduplicates overlapping sources', () => {
      const a = createProvenance('appraiser', 'run-001');
      const b = mergeProvenance(createProvenance('appraiser', 'run-001'), 'geo', 'run-001');

      const reconciled = reconcileProvenance(a, b, 'run-002', 0.8);

      expect(reconciled.contributing_sources).toEqual(['appraiser', 'geo']);
    });
  });

  describe('serialization', () => {
    it('round-trips through JSON', () => {
      const original = createProvenance('appraiser', 'run-001', 0.9);
      const json = provenanceToJson(original);
      const parsed = provenanceFromJson(json);

      expect(parsed.contributing_sources).toEqual(original.contributing_sources);
      expect(parsed.last_pipeline_run).toBe(original.last_pipeline_run);
      expect(parsed.reconciliation_confidence).toBe(original.reconciliation_confidence);
    });

    it('handles object input (already parsed)', () => {
      const original = createProvenance('appraiser', 'run-001');
      const parsed = provenanceFromJson(original);

      expect(parsed).toEqual(original);
    });

    it('returns empty provenance for null/undefined input', () => {
      const parsed = provenanceFromJson(null);

      expect(parsed.contributing_sources).toEqual([]);
      expect(parsed.reconciliation_confidence).toBe(0);
    });
  });
});
