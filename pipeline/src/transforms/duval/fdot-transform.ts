/**
 * COJ parcel data transform — normalize real City of Jacksonville ArcGIS data
 * into Property Record schema.
 *
 * Maps COJ parcel attributes (from coj-parcels.json) to lexicon-aligned fields.
 * Handles Web Mercator (EPSG:3857) → WGS84 (EPSG:4326) coordinate conversion.
 *
 * Data source: COJ ArcGIS REST Services
 */

import type {
  RawRecord,
  TransformResult,
  PropertyRecord,
  Address,
  Owner,
  Coordinates,
  Lot,
  Structure,
  Tax,
  DerivedSignals,
} from '../../lib/types.js';

// Duval County local cities for regional owner detection
const LOCAL_CITIES = new Set([
  'jacksonville', 'jacksonville beach', 'neptune beach', 'atlantic beach',
  'ponte vedra', 'ponte vedra beach', 'orange park', 'fleming island',
  'green cove springs', 'fernandina beach', 'yulee', 'callahan',
  'baldwin', 'middleburg',
]);

/**
 * Convert Web Mercator (EPSG:3857) coordinates to WGS84 (EPSG:4326) lat/lon.
 */
function webMercatorToLatLon(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / 20037508.34) * 180;
  const lat = Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360 / Math.PI - 90;
  return { lat, lng };
}

/**
 * Determine if an owner is non-local (regional/out-of-area investor).
 * Returns true if the mailing address is outside the Jacksonville metro area.
 */
function isRegionalOwner(mailCity: string | null | undefined, mailState: string | null | undefined): boolean {
  if (!mailCity && !mailState) return false;
  if (mailState && mailState.toLowerCase() !== 'fl') return true;
  if (mailCity && !LOCAL_CITIES.has(mailCity.toLowerCase().trim())) return true;
  return false;
}

/**
 * Infer water proximity from FEMA flood zone designation.
 * Properties in flood zones are typically near water bodies.
 */
function inferWaterProximity(floodZone: string | null | undefined): {
  waterProximityFt: number | undefined;
  isWaterfront: boolean;
} {
  if (!floodZone) return { waterProximityFt: undefined, isWaterfront: false };

  const fz = floodZone.toUpperCase();

  // VE/V zones: coastal high-hazard, typically waterfront
  if (fz.includes('VE') || fz.startsWith('V')) {
    return { waterProximityFt: 100, isWaterfront: true };
  }
  // AE/A zones: 100-year floodplain, near water but not necessarily waterfront
  if (fz.includes('AE') || fz.startsWith('A')) {
    return { waterProximityFt: 500, isWaterfront: false };
  }
  // X (shaded): 500-year floodplain
  if (fz.includes('SHADED') || fz.includes('0.2')) {
    return { waterProximityFt: 2000, isWaterfront: false };
  }
  // "NOT IN FLOOD ZONE" or X (unshaded)
  return { waterProximityFt: undefined, isWaterfront: false };
}

/**
 * Transform COJ (City of Jacksonville) parcel records into Property Record fields.
 * Accepts records with source_id 'coj-duval-parcels' or 'fdot-duval-parcels'.
 */
export function transformFdotRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'coj-duval-parcels' || r.source_id === 'fdot-duval-parcels')
    .map((record) => {
      const d = record.raw_data;

      // --- Address ---
      const streetAddr = d.longname as string | null;
      const streetName = d.stnm_type as string | null;
      const city = (d.addrcity as string) || 'JACKSONVILLE';
      const zip = d.zipcode != null ? String(d.zipcode) : undefined;

      const address: Address = {
        full: streetAddr ?? undefined,
        street: streetName ?? undefined,
        city,
        state: 'FL',
        zip,
      };

      // --- Owner ---
      const ownerName = d.lnameowner as string | null;
      const mailAddr1 = d.mailaddr1 as string | null;
      const mailCity = d.mailcity as string | null;
      const mailState = d.mailstate as string | null;
      const mailZip = d.mailzip != null ? String(d.mailzip) : undefined;

      const currentOwner: Owner | null = ownerName
        ? {
            owner_name: ownerName,
            mailing_address: {
              street: mailAddr1 ?? undefined,
              city: mailCity ?? undefined,
              state: mailState ?? undefined,
              zip: mailZip,
            },
          }
        : null;

      // --- Valuations ---
      const assessedValue = typeof d.cama_val === 'number' ? d.cama_val : null;

      // --- Structure ---
      const useCode = d.puse as string | null;
      const useDescription = d.descpu as string | null;

      const structure: Structure = {
        use_code: useCode ?? undefined,
        use_description: useDescription ?? undefined,
      };

      // --- Coordinates (Web Mercator → WGS84) ---
      let coordinates: Coordinates | null = null;
      const xWgs = d.x_wgs as number | null;
      const yWgs = d.y_wgs as number | null;
      if (typeof xWgs === 'number' && typeof yWgs === 'number' && xWgs !== 0 && yWgs !== 0) {
        coordinates = webMercatorToLatLon(xWgs, yWgs);
      }

      // --- Lot ---
      const acres = typeof d.acres === 'number' ? d.acres : null;
      const zoning = d.zon_label as string | null;
      const floodZone = d.fld_zone as string | null;

      const lot: Lot = {};
      if (acres && acres > 0) {
        lot.area_acres = acres;
        lot.area_sqft = Math.round(acres * 43560);
      }
      if (zoning) lot.zoning = zoning;

      // --- Tax ---
      const tax: Tax = {
        assessed_value: assessedValue ?? undefined,
      };

      // --- Derived Signals ---
      const regional = isRegionalOwner(mailCity, mailState);
      const { waterProximityFt, isWaterfront } = inferWaterProximity(floodZone);

      const derivedSignals: DerivedSignals = {
        is_regional_owner: regional,
        ownership_tenure_years: undefined, // not available from COJ parcel data
        roof_age_years: undefined, // not available from COJ parcel data
        water_proximity_ft: waterProximityFt,
        is_waterfront: isWaterfront,
      };

      const fields: Partial<PropertyRecord> = {
        address,
        assessed_value: assessedValue,
        market_value: assessedValue, // COJ cama_val is the best available valuation
        current_owner: currentOwner,
        structure,
        coordinates,
        lot,
        tax,
        derived_signals: derivedSignals,
      };

      return {
        parcel_id: record.parcel_id,
        fields,
      };
    });
}

export default transformFdotRecords;
