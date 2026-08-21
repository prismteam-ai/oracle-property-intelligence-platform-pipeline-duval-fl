/**
 * BBB contractor reputation data transform — enrich contractor records with BBB data.
 * T034 — Normalize BBB data and link to property permits/contractors.
 */

import type { RawRecord, TransformResult, Permit } from '../../lib/types.js';

interface RawBBBContractor {
  business_name?: string;
  bbb_rating?: string;
  category?: string;
  address?: string;
  phone?: string;
  review_count?: string;
  is_accredited?: string;
  complaints_last_3_years?: string;
}

export interface NormalizedBBBContractor {
  business_name: string;
  bbb_rating: string;
  category?: string;
  address?: string;
  review_count: number;
  is_accredited: boolean;
  complaints_last_3_years: number;
}

/**
 * Transform raw BBB records into Property Record fields.
 * BBB data enriches contractor/permit records with reputation information.
 */
export function transformBBBRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-bbb')
    .map((record) => {
      const rawContractors = (record.raw_data.contractors ?? []) as RawBBBContractor[];

      const contractors: NormalizedBBBContractor[] = rawContractors
        .filter((c) => c.business_name)
        .map((c) => ({
          business_name: c.business_name!,
          bbb_rating: c.bbb_rating ?? 'NR',
          category: c.category ?? undefined,
          address: c.address ?? undefined,
          review_count: parseInt(c.review_count ?? '0', 10) || 0,
          is_accredited: c.is_accredited === 'true',
          complaints_last_3_years: parseInt(c.complaints_last_3_years ?? '0', 10) || 0,
        }));

      // Build permit-like records from BBB contractor data
      // This cross-references contractors who have worked at properties
      const permits: Permit[] = contractors.map((c) => ({
        contractor: c.business_name,
        permit_type: c.category?.replace(' Contractors', '') ?? undefined,
        status: `BBB: ${c.bbb_rating}${c.is_accredited ? ' (Accredited)' : ''}`,
        description: `BBB Rating: ${c.bbb_rating}, Reviews: ${c.review_count}, Complaints: ${c.complaints_last_3_years}`,
      }));

      return {
        parcel_id: record.parcel_id,
        fields: {
          permits: permits.length > 0 ? permits : [],
          derived_signals: {},
        },
      };
    });
}

export default transformBBBRecords;
