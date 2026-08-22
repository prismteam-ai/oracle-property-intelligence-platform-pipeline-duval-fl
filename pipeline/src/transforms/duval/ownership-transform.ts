/**
 * Ownership data transform — compute tenure and regional owner signals.
 * T023 — Normalize ownership records and derive ownership_tenure_years, is_regional_owner.
 */

import type { RawRecord, TransformResult, OwnershipRecord, Owner } from '../../lib/types.js';

const CURRENT_YEAR = new Date().getFullYear();

// Duval County and surrounding Jacksonville metro area cities
const LOCAL_CITIES = new Set([
  'jacksonville',
  'jacksonville beach',
  'neptune beach',
  'atlantic beach',
  'ponte vedra',
  'ponte vedra beach',
  'orange park',
  'fleming island',
  'green cove springs',
  'fernandina beach',
  'yulee',
  'callahan',
  'baldwin',
  'middleburg',
]);

interface RawTransfer {
  owner_name?: string;
  transfer_date?: string;
  sale_price?: string | number;
  deed_type?: string;
  instrument_number?: string;
}

function parseDate(dateStr: unknown): string | undefined {
  if (!dateStr || typeof dateStr !== 'string') return undefined;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return `${mdyMatch[3]}-${mdyMatch[1]!.padStart(2, '0')}-${mdyMatch[2]!.padStart(2, '0')}`;
  }
  return undefined;
}

function getYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(year) ? null : year;
}

/**
 * Determine if an owner is regional (non-local) based on their mailing address.
 */
function isRegionalOwner(mailingAddress: string | null | undefined): boolean {
  if (!mailingAddress) return false;

  const lower = mailingAddress.toLowerCase();

  // Check if any local city is in the mailing address
  for (const city of LOCAL_CITIES) {
    if (lower.includes(city)) return false;
  }

  // If the address contains a city/state, it's likely regional
  // Simple heuristic: if it has a comma and a state abbreviation, treat as parseable
  return lower.includes(',');
}

/**
 * Extract owner location string for display (e.g., "Miami, FL").
 */
function extractOwnerLocation(mailingAddress: string | null | undefined): string | undefined {
  if (!mailingAddress) return undefined;
  const match = mailingAddress.match(/,\s*([^,]+),\s*([A-Z]{2})/i);
  if (match) {
    return `${match[1]?.trim()}, ${match[2]?.trim().toUpperCase()}`;
  }
  return undefined;
}

/**
 * Transform raw ownership records into Property Record fields.
 */
export function transformOwnershipRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-ownership')
    .map((record) => {
      const rawTransfers = (record.raw_data.transfers ?? []) as RawTransfer[];
      const currentOwnerName = record.raw_data.current_owner as string | undefined;
      const mailingAddress = record.raw_data.owner_mailing_address as string | undefined;

      // Build ownership history
      const ownership: OwnershipRecord[] = rawTransfers.map((rt) => ({
        owner_name: rt.owner_name ?? 'Unknown',
        transfer_date: parseDate(rt.transfer_date),
        sale_price:
          typeof rt.sale_price === 'number'
            ? rt.sale_price
            : typeof rt.sale_price === 'string'
              ? parseFloat(rt.sale_price.replace(/[$,]/g, '')) || undefined
              : undefined,
        deed_type: rt.deed_type ?? undefined,
        instrument_number: rt.instrument_number ?? undefined,
      }));

      // Compute ownership tenure — years since most recent transfer
      let ownershipTenureYears: number | undefined;
      const transferYears = rawTransfers
        .map((rt) => getYear(parseDate(rt.transfer_date)))
        .filter((y): y is number => y !== null);

      if (transferYears.length > 0) {
        const mostRecentYear = Math.max(...transferYears);
        ownershipTenureYears = CURRENT_YEAR - mostRecentYear;
      }

      // Build current owner
      const currentOwner: Owner | null = currentOwnerName
        ? {
            owner_name: currentOwnerName,
            mailing_address: mailingAddress
              ? { full: mailingAddress }
              : undefined,
          }
        : null;

      const regional = isRegionalOwner(mailingAddress);

      return {
        parcel_id: record.parcel_id,
        fields: {
          ownership,
          current_owner: currentOwner,
          derived_signals: {
            ownership_tenure_years: ownershipTenureYears,
            is_regional_owner: regional,
          },
        },
      };
    });
}

export default transformOwnershipRecords;
