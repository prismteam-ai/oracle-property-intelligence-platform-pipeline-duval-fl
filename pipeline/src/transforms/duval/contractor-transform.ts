/**
 * Contractor licensing data transform — normalize contractor records.
 * T032 — Extract contractor information and link to properties.
 */

import type { RawRecord, TransformResult } from '../../lib/types.js';

interface RawContractor {
  contractor_name?: string;
  license_number?: string;
  license_type?: string;
  status?: string;
  issue_date?: string;
  expiration_date?: string;
  specialty?: string;
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

export interface NormalizedContractor {
  contractor_name: string;
  license_number?: string;
  license_type?: string;
  status?: string;
  issue_date?: string;
  expiration_date?: string;
  specialty?: string;
}

/**
 * Transform raw contractor licensing records into Property Record fields.
 * Contractor data enriches permit records with contractor reputation info.
 */
export function transformContractorRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-contractor')
    .map((record) => {
      const rawContractors = (record.raw_data.contractors ?? []) as RawContractor[];

      const contractors: NormalizedContractor[] = rawContractors
        .filter((c) => c.contractor_name)
        .map((c) => ({
          contractor_name: c.contractor_name!,
          license_number: c.license_number ?? undefined,
          license_type: c.license_type ?? undefined,
          status: c.status ?? undefined,
          issue_date: parseDate(c.issue_date),
          expiration_date: parseDate(c.expiration_date),
          specialty: c.specialty ?? undefined,
        }));

      // Cross-reference contractors with existing permits on the property.
      // If a permit lists a contractor name that matches a licensed contractor,
      // we can enrich the permit with license status.
      // For now, we store contractor info as part of permit enrichment.

      // Build permits from contractor records — each licensed contractor
      // who has done work at this property gets a synthetic permit reference.
      const activeContractors = contractors.filter((c) => c.status === 'Active');

      // Map contractors to permit-like structures for cross-referencing
      const enrichedPermits = activeContractors.map((c) => ({
        permit_type: c.license_type,
        contractor: c.contractor_name,
        status: `Licensed (${c.status})`,
        description: `${c.license_type} - License #${c.license_number ?? 'unknown'}`,
        issue_date: c.issue_date,
      }));

      return {
        parcel_id: record.parcel_id,
        fields: {
          // Contractor data doesn't directly map to PropertyRecord fields,
          // but it enriches permits and derived signals
          permits: enrichedPermits.length > 0
            ? enrichedPermits.map((p) => ({
                permit_type: p.permit_type,
                contractor: p.contractor,
                status: p.status,
                description: p.description,
                issue_date: p.issue_date,
              }))
            : [],
          derived_signals: {},
        },
      };
    });
}

export default transformContractorRecords;
