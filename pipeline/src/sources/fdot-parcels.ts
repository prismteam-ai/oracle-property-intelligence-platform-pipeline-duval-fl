/**
 * Florida DOT Statewide Parcels ArcGIS REST API adapter.
 * Fetches real Duval County parcel data from the FDOT parcel service.
 *
 * This service is NOT geo-blocked (unlike maps.coj.net) and provides:
 * - Real parcel IDs (PARCELNO field = RE number)
 * - Situs addresses (APTS_STRT, APTS_CITY, APTS_STATE, APTS_ZIP)
 * - Valuations (JV = just value, AV_NSD = assessed value, TV_NSD = taxable value)
 * - Building data (ACT_YR_BLT, TOT_LVG_AR, NO_BULDNG, NO_RES_UNTS)
 * - Land data (ACREAGE, LND_VAL)
 * - Use codes (DOR_UC = FL DOR use code)
 * - Owner info (OWN_NAME, OWN_ADDR1, OWN_CITY, OWN_STATE, OWN_ZIPCD)
 * - Parcel geometry (polygons in WGS84)
 *
 * Source: https://gis.fdot.gov/arcgis/rest/services/Parcels/MapServer/0
 * County filter: CO_NO=16 (Duval County FIPS)
 */

import type { RawRecord } from '../lib/types.js';

/**
 * FDOT FeatureServer has one layer per county. Duval = layer 16.
 * Note: This service may require a token from some IPs (esp. non-US).
 * When the token is required, use pre-fetched data from pipeline/data/real/fdot-parcels.json.
 * Pre-fetch with: npx tsx pipeline/src/scripts/fetch-real-seed.ts (run from US IP / EC2)
 */
const FDOT_BASE = 'https://gis.fdot.gov/arcgis/rest/services/Parcels/FeatureServer/16';
const DUVAL_CO_NO = 16;
const PAGE_SIZE = 100;
const REQUEST_DELAY_MS = 500;
const MAX_RETRIES = 3;

/** All available fields from the FDOT parcel service for Duval County */
const OUT_FIELDS = [
  'PARCELNO',      // Parcel number (RE number)
  'CO_NO',         // County number (16 = Duval)
  'APTS_STRT',     // Situs street address
  'APTS_CITY',     // Situs city
  'APTS_STATE',    // Situs state
  'APTS_ZIP',      // Situs ZIP
  'OWN_NAME',      // Owner name
  'OWN_ADDR1',     // Owner mailing address line 1
  'OWN_ADDR2',     // Owner mailing address line 2
  'OWN_CITY',      // Owner city
  'OWN_STATE',     // Owner state
  'OWN_ZIPCD',     // Owner ZIP
  'DOR_UC',        // FL DOR use code
  'JV',            // Just (market) value
  'AV_NSD',        // Assessed value (non-school district)
  'TV_NSD',        // Taxable value (non-school district)
  'LND_VAL',       // Land value
  'NCONST_VAL',    // Construction/building value
  'ACT_YR_BLT',    // Actual year built
  'EFF_YR_BLT',    // Effective year built
  'TOT_LVG_AR',    // Total living area (sqft)
  'NO_BULDNG',     // Number of buildings
  'NO_RES_UNTS',   // Number of residential units
  'ACREAGE',       // Acreage
  'SEC',           // Section
  'TWP',           // Township
  'RNG',           // Range
  'S_LEGAL',       // Short legal description
].join(',');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FdotFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
    x?: number;
    y?: number;
  };
}

interface FdotQueryResponse {
  features?: FdotFeature[];
  exceededTransferLimit?: boolean;
  error?: { code: number; message: string };
}

/**
 * Query the FDOT ArcGIS REST API.
 */
async function queryFdot(
  where: string,
  offset = 0,
  retryCount = 0,
): Promise<FdotQueryResponse> {
  const params = new URLSearchParams({
    where,
    outFields: OUT_FIELDS,
    returnGeometry: 'true',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    outSR: '4326',
  });

  const url = `${FDOT_BASE}/query?${params}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`FDOT query failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as FdotQueryResponse;
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`[fdot-parcels] Retry ${retryCount + 1}/${MAX_RETRIES}: ${err}`);
      await sleep(REQUEST_DELAY_MS * (retryCount + 1));
      return queryFdot(where, offset, retryCount + 1);
    }
    throw err;
  }
}

/**
 * Compute centroid from polygon rings.
 */
function computeCentroid(rings: number[][][]): { lat: number; lng: number } | null {
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length === 0) return null;

  const outerRing = rings[0];
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const point of outerRing) {
    if (point && point.length >= 2) {
      sumX += point[0]!;
      sumY += point[1]!;
      count++;
    }
  }

  if (count === 0) return null;
  return { lng: sumX / count, lat: sumY / count };
}

/**
 * Convert an FDOT feature to a RawRecord for the pipeline.
 * The raw_data contains ALL FDOT fields, plus computed centroid.
 */
function featureToRawRecord(feature: FdotFeature, sourceId: string): RawRecord | null {
  const a = feature.attributes;
  const parcelNo = String(a.PARCELNO ?? '').trim();
  if (!parcelNo) return null;

  // Compute centroid from polygon geometry
  let centroid: { lat: number; lng: number } | null = null;
  if (feature.geometry?.rings) {
    centroid = computeCentroid(feature.geometry.rings);
  }

  return {
    parcel_id: parcelNo,
    source_id: sourceId,
    raw_data: {
      // Address
      address_street: String(a.APTS_STRT ?? '').trim() || null,
      address_city: String(a.APTS_CITY ?? '').trim() || null,
      address_state: String(a.APTS_STATE ?? '').trim() || null,
      address_zip: String(a.APTS_ZIP ?? '').trim() || null,

      // Owner
      owner_name: String(a.OWN_NAME ?? '').trim() || null,
      owner_addr1: String(a.OWN_ADDR1 ?? '').trim() || null,
      owner_addr2: String(a.OWN_ADDR2 ?? '').trim() || null,
      owner_city: String(a.OWN_CITY ?? '').trim() || null,
      owner_state: String(a.OWN_STATE ?? '').trim() || null,
      owner_zip: String(a.OWN_ZIPCD ?? '').trim() || null,

      // Valuations
      just_value: a.JV ?? null,
      assessed_value: a.AV_NSD ?? null,
      taxable_value: a.TV_NSD ?? null,
      land_value: a.LND_VAL ?? null,
      building_value: a.NCONST_VAL ?? null,

      // Building
      year_built: a.ACT_YR_BLT ?? null,
      effective_year_built: a.EFF_YR_BLT ?? null,
      total_living_area: a.TOT_LVG_AR ?? null,
      num_buildings: a.NO_BULDNG ?? null,
      num_res_units: a.NO_RES_UNTS ?? null,

      // Land
      acreage: a.ACREAGE ?? null,
      dor_use_code: String(a.DOR_UC ?? '').trim() || null,

      // Legal
      section: a.SEC ?? null,
      township: a.TWP ?? null,
      range: a.RNG ?? null,
      short_legal: String(a.S_LEGAL ?? '').trim() || null,

      // Geometry
      centroid,
      geometry_rings: feature.geometry?.rings ?? null,
    },
  };
}

/**
 * Fetch Duval County parcels from the FDOT statewide parcel service.
 * Returns real parcel data with geometry, valuations, owner info, and building data.
 *
 * @param limit Maximum number of parcels to fetch (default: 25 for pilot)
 * @param additionalFilter Optional additional WHERE clause filter (e.g., "DOR_UC LIKE '01%'" for residential)
 */
export async function fetchDuvalParcels(
  limit = 25,
  additionalFilter?: string,
): Promise<RawRecord[]> {
  const sourceId = 'fdot-duval-parcels';
  // Layer 16 IS Duval County — no CO_NO filter needed on per-county layers
  let where = '1=1';
  if (additionalFilter) {
    where = additionalFilter;
  }

  const results: RawRecord[] = [];
  let offset = 0;
  let hasMore = true;

  console.info(`[fdot-parcels] Fetching Duval County parcels (limit=${limit})...`);

  while (hasMore && results.length < limit) {
    const remaining = limit - results.length;
    const batchSize = Math.min(remaining, PAGE_SIZE);

    const response = await queryFdot(
      where,
      offset,
    );

    if (response.error) {
      console.error(`[fdot-parcels] API error: ${response.error.message}`);
      break;
    }

    const features = response.features ?? [];
    if (features.length === 0) {
      hasMore = false;
      break;
    }

    for (const feature of features) {
      if (results.length >= limit) break;
      const record = featureToRawRecord(feature, sourceId);
      if (record) {
        results.push(record);
      }
    }

    offset += features.length;
    hasMore = response.exceededTransferLimit === true && results.length < limit;

    if (hasMore) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.info(`[fdot-parcels] Fetched ${results.length} real parcels from FDOT`);
  return results;
}

/**
 * Fetch parcels by specific parcel IDs from the FDOT service.
 */
export async function fetchParcelsByIds(parcelIds: string[]): Promise<RawRecord[]> {
  const sourceId = 'fdot-duval-parcels';
  const results: RawRecord[] = [];

  // Query in batches of 50 using IN clause
  for (let i = 0; i < parcelIds.length; i += 50) {
    const batch = parcelIds.slice(i, i + 50);
    const where = `PARCELNO IN (${batch.map((id) => `'${id}'`).join(',')})`;

    try {
      const response = await queryFdot(where, 0);

      if (response.error) {
        console.error(`[fdot-parcels] Batch error at ${i}: ${response.error.message}`);
        continue;
      }

      for (const feature of response.features ?? []) {
        const record = featureToRawRecord(feature, sourceId);
        if (record) {
          results.push(record);
        }
      }
    } catch (err) {
      console.error(`[fdot-parcels] Failed batch starting at ${i}:`, err);
    }

    if (i + 50 < parcelIds.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return results;
}

/**
 * Generate a seed CSV from real FDOT data.
 * Returns CSV string with parcel_id, address_street, address_city, address_state, address_zip columns.
 */
export async function generateRealSeedCsv(limit = 50): Promise<string> {
  const records = await fetchDuvalParcels(limit);

  const header = 'parcel_id,address_street,address_city,address_state,address_zip';
  const rows = records.map((r) => {
    const d = r.raw_data;
    const street = String(d.address_street ?? '').replace(/"/g, '""');
    const city = String(d.address_city ?? '').replace(/"/g, '""');
    const state = String(d.address_state ?? 'FL');
    const zip = String(d.address_zip ?? '');
    return `${r.parcel_id},"${street}","${city}","${state}","${zip}"`;
  });

  return [header, ...rows].join('\n') + '\n';
}
