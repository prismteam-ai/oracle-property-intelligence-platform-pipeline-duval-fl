/**
 * Integration test for appraiser source adapter + transform.
 * T021 — Validates diverse parcels through the transform pipeline,
 *         asserting field coverage per Lexicon schema.
 */

import { describe, it, expect } from 'vitest';
import { generateMockAppraiserRecord } from '../../src/sources/appraiser.js';
import { transformAppraiserRecords } from '../../src/transforms/duval/appraiser-transform.js';
import type { RawRecord } from '../../src/lib/types.js';

// Generate 20 diverse mock parcels
const PARCEL_IDS = Array.from({ length: 20 }, (_, i) =>
  `RE${String(i + 1).padStart(7, '0')}`,
);

describe('Appraiser Transform Integration', () => {
  const mockRecords: RawRecord[] = PARCEL_IDS.map((id) =>
    generateMockAppraiserRecord(id),
  );

  const results = transformAppraiserRecords(mockRecords);

  it('should produce a result for every input record', () => {
    expect(results.length).toBe(20);
  });

  it('should preserve parcel IDs', () => {
    const resultIds = results.map((r) => r.parcel_id);
    expect(resultIds).toEqual(PARCEL_IDS);
  });

  describe('field coverage', () => {
    for (const result of results) {
      describe(`parcel ${result.parcel_id}`, () => {
        const f = result.fields;

        it('should have assessed_value', () => {
          expect(f.assessed_value).toBeDefined();
          expect(typeof f.assessed_value).toBe('number');
          expect(f.assessed_value).toBeGreaterThan(0);
        });

        it('should have market_value', () => {
          expect(f.market_value).toBeDefined();
          expect(typeof f.market_value).toBe('number');
        });

        it('should have structure with year_built', () => {
          expect(f.structure).toBeDefined();
          expect(f.structure?.year_built).toBeDefined();
          expect(f.structure?.year_built).toBeGreaterThan(1800);
        });

        it('should have structure with sqft', () => {
          expect(f.structure?.sqft).toBeDefined();
          expect(f.structure?.sqft).toBeGreaterThan(0);
        });

        it('should have structure with roof_type', () => {
          expect(f.structure?.roof_type).toBeDefined();
          expect(['shingle', 'tile', 'metal', 'flat']).toContain(f.structure?.roof_type);
        });

        it('should have current_owner', () => {
          expect(f.current_owner).toBeDefined();
          expect(f.current_owner?.owner_name).toBeTruthy();
        });

        it('should have tax data', () => {
          expect(f.tax).toBeDefined();
          expect(f.tax?.assessed_value).toBeDefined();
        });

        it('should have derived_signals with roof_age_years', () => {
          expect(f.derived_signals).toBeDefined();
          expect(f.derived_signals?.roof_age_years).toBeDefined();
          expect(f.derived_signals?.roof_age_years).toBeGreaterThanOrEqual(0);
        });

        it('should have ownership history with sale info', () => {
          expect(f.ownership).toBeDefined();
          expect(f.ownership?.length).toBeGreaterThan(0);
          expect(f.ownership?.[0]?.owner_name).toBeTruthy();
          expect(f.ownership?.[0]?.transfer_date).toBeTruthy();
        });

        it('should have address', () => {
          expect(f.address).toBeDefined();
          expect(f.address?.full).toBeTruthy();
        });
      });
    }
  });

  it('should compute roof_age_years correctly', () => {
    const currentYear = new Date().getFullYear();
    for (const result of results) {
      const yearBuilt = result.fields.structure?.year_built;
      const roofAge = result.fields.derived_signals?.roof_age_years;
      if (yearBuilt !== undefined && roofAge !== undefined) {
        expect(roofAge).toBe(currentYear - yearBuilt);
      }
    }
  });

  it('should have 100% field coverage for core Lexicon fields', () => {
    const requiredFields = [
      'assessed_value',
      'structure',
      'current_owner',
      'tax',
      'derived_signals',
    ] as const;

    for (const result of results) {
      for (const field of requiredFields) {
        expect(
          result.fields[field],
          `Missing ${field} for parcel ${result.parcel_id}`,
        ).toBeDefined();
      }
    }
  });
});
