/**
 * Duval County GIS/coordinate data source adapter.
 * T024 — Fetch parcel centroids from Duval County ArcGIS REST API.
 */

import type { SourceAdapter, RawRecord } from '../lib/types.js';

const SOURCE_ID = 'duval-geo';
const ARCGIS_BASE = 'https://maps.coj.net/arcgis/rest/services';
const PAGE_SIZE = 1000;
const REQUEST_DELAY_MS = 500;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    x: number;
    y: number;
    rings?: number[][][];
  };
}

interface ArcGISResponse {
  features: ArcGISFeature[];
  exceededTransferLimit?: boolean;
}

/**
 * Query the ArcGIS REST API for parcel features.
 */
async function queryArcGIS(
  where: string,
  offset: number = 0,
  retryCount: number = 0,
): Promise<ArcGISResponse> {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    outSR: '4326', // WGS84
  });

  const url = `${ARCGIS_BASE}/Property/Parcels/MapServer/0/query?${params}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`ArcGIS query failed: ${response.status}`);
    }
    return (await response.json()) as ArcGISResponse;
  } catch (err) {
    if (retryCount < MAX_RETRIES) {
      await sleep(REQUEST_DELAY_MS * (retryCount + 1));
      return queryArcGIS(where, offset, retryCount + 1);
    }
    throw err;
  }
}

/**
 * Fetch GIS data for specific parcel IDs.
 */
async function fetchByParcelIds(parcelIds: string[]): Promise<RawRecord[]> {
  const results: RawRecord[] = [];

  // Query in batches of 50 using IN clause
  for (let i = 0; i < parcelIds.length; i += 50) {
    const batch = parcelIds.slice(i, i + 50);
    const where = `RE_NO IN (${batch.map((id) => `'${id}'`).join(',')})`;

    try {
      const response = await queryArcGIS(where);

      for (const feature of response.features) {
        const parcelId = String(feature.attributes.RE_NO ?? feature.attributes.PARCEL_ID ?? '');
        if (!parcelId) continue;

        results.push({
          parcel_id: parcelId,
          source_id: SOURCE_ID,
          raw_data: {
            attributes: feature.attributes,
            geometry: feature.geometry,
            lat: feature.geometry?.y,
            lng: feature.geometry?.x,
          },
        });
      }
    } catch (err) {
      console.error(`[${SOURCE_ID}] Failed to query batch starting at ${i}:`, err);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}

export const geoAdapter: SourceAdapter = {
  source_id: SOURCE_ID,

  async fetch(parcelIds?: string[], options?: { limit?: number }): Promise<RawRecord[]> {
    if (!parcelIds || parcelIds.length === 0) {
      console.warn(`[${SOURCE_ID}] No parcel IDs provided`);
      return [];
    }

    const limit = options?.limit ?? parcelIds.length;
    const idsToFetch = parcelIds.slice(0, limit);

    console.info(`[${SOURCE_ID}] Fetching GIS data for ${idsToFetch.length} parcels`);
    return fetchByParcelIds(idsToFetch);
  },
};

/**
 * Generate mock GIS data for testing.
 * Jacksonville area: lat ~30.2-30.5, lng ~-81.4 to -81.8
 */
export function generateMockGeoRecord(parcelId: string): RawRecord {
  const lat = 30.2 + Math.random() * 0.3;
  const lng = -81.8 + Math.random() * 0.4;

  return {
    parcel_id: parcelId,
    source_id: SOURCE_ID,
    raw_data: {
      attributes: {
        RE_NO: parcelId,
        PARCEL_ID: parcelId,
        ACREAGE: (0.1 + Math.random() * 2).toFixed(2),
        ZONING: ['R-1', 'R-2', 'C-1', 'PUD'][Math.floor(Math.random() * 4)],
      },
      geometry: { x: lng, y: lat },
      lat,
      lng,
    },
  };
}
