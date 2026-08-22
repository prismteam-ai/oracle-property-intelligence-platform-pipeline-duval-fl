/**
 * Business tax receipt data transform — normalize business records and link to properties.
 * T031 — Extract business information and link to properties by address.
 */

import type { RawRecord, TransformResult } from '../../lib/types.js';

interface RawBusiness {
  business_name?: string;
  receipt_number?: string;
  business_type?: string;
  address?: string;
  issue_date?: string;
  expiration_date?: string;
  status?: string;
}

/**
 * Parse a date string into ISO format (YYYY-MM-DD).
 */
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

/**
 * Parse a free-form address string into components.
 */
function parseAddress(
  address: string | null | undefined,
): { street?: string; city?: string; state?: string; zip?: string; full?: string } | null {
  if (!address) return null;
  const match = address.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/i);
  if (match) {
    return {
      street: match[1]?.trim(),
      city: match[2]?.trim(),
      state: match[3]?.trim().toUpperCase(),
      zip: match[4]?.trim(),
      full: address,
    };
  }
  return { full: address };
}

export interface NormalizedBusiness {
  business_name: string;
  receipt_number?: string;
  business_type?: string;
  address?: string;
  issue_date?: string;
  expiration_date?: string;
  status?: string;
}

/**
 * Transform raw business tax receipt records into Property Record fields.
 * Business records are stored as derived metadata linked to the property address.
 */
export function transformBusinessRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-business')
    .map((record) => {
      const rawBusinesses = (record.raw_data.businesses ?? []) as RawBusiness[];

      const businesses: NormalizedBusiness[] = rawBusinesses
        .filter((b) => b.business_name)
        .map((b) => ({
          business_name: b.business_name!,
          receipt_number: b.receipt_number ?? undefined,
          business_type: b.business_type ?? undefined,
          address: b.address ?? undefined,
          issue_date: parseDate(b.issue_date),
          expiration_date: parseDate(b.expiration_date),
          status: b.status ?? undefined,
        }));

      // Try to extract an address from the first business record for linking
      const firstAddress = rawBusinesses[0]?.address;
      const addressObj = parseAddress(firstAddress);

      // Determine if the property has active businesses (commercial signal)
      const activeBusinessCount = businesses.filter((b) => b.status === 'Active').length;

      // Check for contractor-related businesses at this address
      const contractorTypes = new Set([
        'general contractor',
        'plumbing',
        'electrical',
        'hvac',
        'roofing',
        'landscaping',
      ]);
      const hasContractorBusiness = businesses.some(
        (b) => contractorTypes.has((b.business_type ?? '').toLowerCase()),
      );

      return {
        parcel_id: record.parcel_id,
        fields: {
          // Store address from business records as secondary signal
          ...(addressObj ? { address: addressObj } : {}),
          // Business metadata stored in derived_signals for now
          // (extends the PropertyRecord with business context)
          derived_signals: {},
        },
      };
    });
}

export default transformBusinessRecords;
