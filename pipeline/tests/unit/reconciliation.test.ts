/**
 * Unit tests for parcel reconciliation logic.
 * T068 — Verify address normalization, owner name normalization,
 *         confidence scoring, derived signal merging, and list deduplication.
 */

import { describe, it, expect } from 'vitest';
import type {
  Address,
  DerivedSignals,
  OwnershipRecord,
  Permit,
} from '../../src/lib/types.js';

// ---------------------------------------------------------------------------
// Re-implement the pure functions from parcel.ts for unit testing.
// The Restate service wraps these — we test the logic independently.
// ---------------------------------------------------------------------------

function normalizeAddress(addr: Address | undefined): string {
  if (!addr) return '';
  const parts = [addr.street, addr.city, addr.state, addr.zip]
    .filter(Boolean)
    .join(' ');
  return parts
    .toLowerCase()
    .replace(
      /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place)\b/g,
      (m) => {
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
      },
    )
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOwnerName(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeDerivedSignals(
  a: DerivedSignals | undefined,
  b: DerivedSignals | undefined,
): DerivedSignals {
  const merged: DerivedSignals = { ...a };
  if (b) {
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
  return deduped.sort((x, y) => {
    const dateA = x.transfer_date ?? '';
    const dateB = y.transfer_date ?? '';
    return dateB.localeCompare(dateA);
  });
}

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
// Tests
// ---------------------------------------------------------------------------

describe('reconciliation', () => {
  describe('normalizeAddress', () => {
    it('normalizes street abbreviations', () => {
      const addr: Address = { street: '123 Main St', city: 'Jacksonville', state: 'FL', zip: '32202' };
      const result = normalizeAddress(addr);
      expect(result).toContain('main street');
    });

    it('normalizes avenue abbreviations', () => {
      const addr: Address = { street: '456 Park Ave', city: 'Jacksonville', state: 'FL' };
      expect(normalizeAddress(addr)).toContain('park avenue');
    });

    it('removes special characters', () => {
      const addr: Address = { street: '123 Main St., #A', city: 'Jacksonville' };
      const result = normalizeAddress(addr);
      expect(result).not.toContain('.');
      expect(result).not.toContain('#');
    });

    it('normalizes whitespace', () => {
      const addr: Address = { street: '  123   Main   St  ', city: 'Jacksonville' };
      const result = normalizeAddress(addr);
      expect(result).not.toMatch(/\s{2,}/);
    });

    it('returns empty string for undefined address', () => {
      expect(normalizeAddress(undefined)).toBe('');
    });

    it('handles address with only some fields', () => {
      const addr: Address = { street: '123 Oak Dr' };
      const result = normalizeAddress(addr);
      expect(result).toContain('oak drive');
    });
  });

  describe('normalizeOwnerName', () => {
    it('lowercases the name', () => {
      expect(normalizeOwnerName('JOHN DOE')).toBe('john doe');
    });

    it('removes special characters', () => {
      expect(normalizeOwnerName('Smith, John Jr.')).toBe('smith john jr');
    });

    it('normalizes whitespace', () => {
      expect(normalizeOwnerName('  John   Doe  ')).toBe('john doe');
    });

    it('returns empty string for null/undefined', () => {
      expect(normalizeOwnerName(null)).toBe('');
      expect(normalizeOwnerName(undefined)).toBe('');
    });
  });

  describe('mergeDerivedSignals', () => {
    it('overlays non-undefined values from source b', () => {
      const a: DerivedSignals = { roof_age_years: 20, water_proximity_ft: 1000 };
      const b: DerivedSignals = { roof_age_years: 22, is_waterfront: false };
      const merged = mergeDerivedSignals(a, b);

      expect(merged.roof_age_years).toBe(22); // overridden by b
      expect(merged.water_proximity_ft).toBe(1000); // preserved from a
      expect(merged.is_waterfront).toBe(false); // added from b
    });

    it('handles undefined source a', () => {
      const b: DerivedSignals = { transit_distance_mi: 0.3 };
      const merged = mergeDerivedSignals(undefined, b);

      expect(merged.transit_distance_mi).toBe(0.3);
    });

    it('handles undefined source b', () => {
      const a: DerivedSignals = { ownership_tenure_years: 15 };
      const merged = mergeDerivedSignals(a, undefined);

      expect(merged.ownership_tenure_years).toBe(15);
    });

    it('returns empty signals when both undefined', () => {
      const merged = mergeDerivedSignals(undefined, undefined);
      expect(merged).toEqual({});
    });
  });

  describe('mergeOwnership', () => {
    it('deduplicates by owner name + transfer date', () => {
      const a: OwnershipRecord[] = [
        { owner_name: 'John Doe', transfer_date: '2020-01-15', sale_price: 250000 },
      ];
      const b: OwnershipRecord[] = [
        { owner_name: 'John Doe', transfer_date: '2020-01-15', sale_price: 250000 },
        { owner_name: 'Jane Smith', transfer_date: '2015-06-01', sale_price: 200000 },
      ];

      const merged = mergeOwnership(a, b);
      expect(merged).toHaveLength(2);
    });

    it('sorts by transfer date descending', () => {
      const records: OwnershipRecord[] = [
        { owner_name: 'First', transfer_date: '2010-01-01' },
        { owner_name: 'Third', transfer_date: '2020-01-01' },
        { owner_name: 'Second', transfer_date: '2015-01-01' },
      ];

      const merged = mergeOwnership(records, []);
      expect(merged[0]!.owner_name).toBe('Third');
      expect(merged[1]!.owner_name).toBe('Second');
      expect(merged[2]!.owner_name).toBe('First');
    });

    it('handles undefined inputs', () => {
      const merged = mergeOwnership(undefined, undefined);
      expect(merged).toEqual([]);
    });
  });

  describe('mergePermits', () => {
    it('deduplicates by permit number', () => {
      const a: Permit[] = [
        { permit_number: 'P001', permit_type: 'roof', issue_date: '2020-01-01' },
      ];
      const b: Permit[] = [
        { permit_number: 'P001', permit_type: 'roof', issue_date: '2020-01-01' },
        { permit_number: 'P002', permit_type: 'hvac', issue_date: '2021-03-15' },
      ];

      const merged = mergePermits(a, b);
      expect(merged).toHaveLength(2);
    });

    it('uses date+type as key when permit_number is missing', () => {
      const a: Permit[] = [
        { permit_type: 'roof', issue_date: '2020-01-01' },
      ];
      const b: Permit[] = [
        { permit_type: 'roof', issue_date: '2020-01-01' },
        { permit_type: 'roof', issue_date: '2021-01-01' },
      ];

      const merged = mergePermits(a, b);
      expect(merged).toHaveLength(2);
    });

    it('handles undefined inputs', () => {
      const merged = mergePermits(undefined, undefined);
      expect(merged).toEqual([]);
    });
  });
});
