/**
 * GIS/coordinate data transform — normalize coordinates into Property Record.
 * T024 — Extract lat/lng and lot metadata from ArcGIS features.
 */

import type { RawRecord, TransformResult, Coordinates, Lot } from '../../lib/types.js';

/**
 * Transform raw GIS records into Property Record fields.
 */
export function transformGeoRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-geo')
    .map((record) => {
      const raw = record.raw_data;
      const attrs = (raw.attributes ?? {}) as Record<string, unknown>;

      // Extract coordinates
      let coordinates: Coordinates | null = null;
      const lat = Number(raw.lat ?? (raw.geometry as { y?: number })?.y);
      const lng = Number(raw.lng ?? (raw.geometry as { x?: number })?.x);

      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
        coordinates = { lat, lng };
      }

      // Extract lot info
      const acreage = Number(attrs.ACREAGE ?? attrs.acreage);
      const zoning = String(attrs.ZONING ?? attrs.zoning ?? '');

      const lot: Lot = {};
      if (!isNaN(acreage) && acreage > 0) {
        lot.area_acres = acreage;
        lot.area_sqft = Math.round(acreage * 43560);
      }
      if (zoning) {
        lot.zoning = zoning;
      }

      return {
        parcel_id: record.parcel_id,
        fields: {
          coordinates,
          lot,
        },
      };
    });
}

export default transformGeoRecords;
