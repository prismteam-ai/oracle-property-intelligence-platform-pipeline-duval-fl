/**
 * Permits data transform — normalize raw permit data into Property Record schema.
 * T022 — Extract permits and compute roof-related derived signals from permit dates.
 */

import type { RawRecord, TransformResult, Permit } from '../../lib/types.js';

const CURRENT_YEAR = new Date().getFullYear();

interface RawPermit {
  permit_number?: string;
  permit_type?: string;
  issue_date?: string;
  description?: string;
  status?: string;
  contractor?: string;
  estimated_cost?: number | string;
}

/**
 * Parse a date string into ISO format (YYYY-MM-DD).
 */
function parseDate(dateStr: unknown): string | undefined {
  if (!dateStr || typeof dateStr !== 'string') return undefined;
  const trimmed = dateStr.trim();
  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // MM/DD/YYYY
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return `${mdyMatch[3]}-${mdyMatch[1]!.padStart(2, '0')}-${mdyMatch[2]!.padStart(2, '0')}`;
  }
  return undefined;
}

/**
 * Check if a permit is a roofing permit.
 */
function isRoofPermit(permit: RawPermit): boolean {
  const type = (permit.permit_type ?? '').toLowerCase();
  const desc = (permit.description ?? '').toLowerCase();
  return type.includes('roof') || desc.includes('roof') || desc.includes('re-roof');
}

/**
 * Get the year from a date string.
 */
function getYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(year) ? null : year;
}

/**
 * Transform raw permit records into Property Record fields.
 */
export function transformPermitRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-permits')
    .map((record) => {
      const rawPermits = (record.raw_data.permits ?? []) as RawPermit[];

      const permits: Permit[] = rawPermits.map((rp) => ({
        permit_number: rp.permit_number ?? undefined,
        permit_type: rp.permit_type ?? undefined,
        issue_date: parseDate(rp.issue_date),
        description: rp.description ?? undefined,
        status: rp.status ?? undefined,
        contractor: rp.contractor ?? undefined,
        estimated_cost:
          typeof rp.estimated_cost === 'number'
            ? rp.estimated_cost
            : typeof rp.estimated_cost === 'string'
              ? parseFloat(rp.estimated_cost) || undefined
              : undefined,
      }));

      // Find most recent roofing permit for derived signal
      const roofPermits = rawPermits.filter(isRoofPermit);
      let roofAgeYears: number | undefined;

      if (roofPermits.length > 0) {
        const dates = roofPermits
          .map((rp) => getYear(parseDate(rp.issue_date)))
          .filter((y): y is number => y !== null);

        if (dates.length > 0) {
          const mostRecentRoofYear = Math.max(...dates);
          roofAgeYears = CURRENT_YEAR - mostRecentRoofYear;
        }
      }

      return {
        parcel_id: record.parcel_id,
        fields: {
          permits,
          derived_signals: roofAgeYears !== undefined
            ? { roof_age_years: roofAgeYears }
            : {},
        },
      };
    });
}

export default transformPermitRecords;
