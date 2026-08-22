/**
 * SunBiz corporate data transform — enrich ownership records with corporate entity data.
 * T033 — Link corporate entities from FL SunBiz to property owners.
 */

import type { RawRecord, TransformResult, Owner } from '../../lib/types.js';

interface RawEntity {
  entity_name?: string;
  document_number?: string;
  status?: string;
  filing_date?: string;
  state?: string;
  entity_type?: string;
  registered_agent?: string;
  principal_address?: string;
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
 * Determine if an entity is a regional (out-of-area) owner based on filing state
 * or principal address.
 */
function isRegionalEntity(entity: RawEntity): boolean {
  // If incorporated outside FL, likely regional
  if (entity.state && entity.state !== 'FL') return true;

  // Check principal address for Jacksonville area
  const addr = (entity.principal_address ?? '').toLowerCase();
  const localCities = [
    'jacksonville',
    'jax',
    'neptune beach',
    'atlantic beach',
    'jacksonville beach',
    'ponte vedra',
    'orange park',
  ];
  if (addr) {
    return !localCities.some((city) => addr.includes(city));
  }

  return false;
}

/**
 * Transform raw SunBiz corporate records into Property Record fields.
 * Enriches ownership data with corporate entity information.
 */
export function transformSunbizRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-sunbiz')
    .map((record) => {
      const rawEntities = (record.raw_data.entities ?? []) as RawEntity[];

      // Filter to active entities only for ownership enrichment
      const activeEntities = rawEntities.filter(
        (e) => e.entity_name && (e.status === 'Active' || !e.status),
      );

      if (activeEntities.length === 0) {
        // No corporate entities found — this owner is likely an individual
        return {
          parcel_id: record.parcel_id,
          fields: {
            derived_signals: {},
          },
        };
      }

      // Use the first active entity as the primary corporate owner
      const primaryEntity = activeEntities[0]!;

      const currentOwner: Owner = {
        owner_name: primaryEntity.entity_name!,
        owner_type: primaryEntity.entity_type ?? 'Corporate',
        mailing_address: primaryEntity.principal_address
          ? { full: primaryEntity.principal_address }
          : undefined,
      };

      // Determine if this is a regional owner based on corporate data
      const regional = activeEntities.some(isRegionalEntity);

      // Build ownership records from corporate filing history
      const ownership = activeEntities.map((e) => ({
        owner_name: e.entity_name ?? 'Unknown Entity',
        transfer_date: parseDate(e.filing_date),
        deed_type: `Corporate Filing (${e.entity_type ?? 'Unknown'})`,
      }));

      return {
        parcel_id: record.parcel_id,
        fields: {
          current_owner: currentOwner,
          ownership,
          derived_signals: {
            is_regional_owner: regional,
          },
        },
      };
    });
}

export default transformSunbizRecords;
