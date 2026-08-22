/**
 * Duval County data source catalog.
 * T017 — Enumerates all known public data sources for Duval County, FL.
 */

import type { DataSource } from '../lib/types.js';

export const DUVAL_SOURCES: DataSource[] = [
  {
    source_id: 'duval-appraiser',
    name: 'Duval County Property Appraiser',
    category: 'property',
    url: 'https://paopropertysearch.coj.net',
    collection_method: 'browser-flow',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'Rate limited portal. Requires Playwright browser automation. No bulk API. Session-based search with CAPTCHA risk.',
  },
  {
    source_id: 'duval-permits',
    name: 'Duval County Building Permits',
    category: 'permit',
    url: 'https://buildinginspections.coj.net',
    collection_method: 'browser-flow',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'Permit data may lag by 1-2 business days. Some older permits lack detailed descriptions.',
  },
  {
    source_id: 'duval-ownership',
    name: 'Duval County Ownership Transfer Records',
    category: 'ownership',
    url: 'https://paopropertysearch.coj.net',
    collection_method: 'browser-flow',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'Ownership history linked to appraiser portal. Transfer records may not include all deed types.',
  },
  {
    source_id: 'duval-business',
    name: 'Duval County Business Tax Receipts',
    category: 'business',
    url: 'https://www.coj.net/departments/finance/business-tax-receipts',
    collection_method: 'scrape',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'Business records linked to properties by address matching only. No parcel ID cross-reference.',
  },
  {
    source_id: 'duval-contractor',
    name: 'Duval County Contractor Licensing',
    category: 'contractor',
    url: 'https://www.coj.net/departments/regulatory-compliance',
    collection_method: 'scrape',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'Contractor records may have slow response times (3+ seconds per request). Rate limiting enforced.',
  },
  {
    source_id: 'duval-geo',
    name: 'Duval County GIS Parcel Centroids (COJ CityBiz)',
    category: 'location',
    url: 'https://maps.coj.net/coj/rest/services/CityBiz/Parcels/MapServer',
    collection_method: 'api',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'ArcGIS REST API with paging limits (2000 records per request). Geo-blocked from non-US IPs. Fields: RE_NO, LNAMEOWNER, PUSE, ACRES, TOT_LND_VA, TOT_BLD_VA, FLD_ZONE.',
  },
  {
    source_id: 'fdot-duval-parcels',
    name: 'FL DOT Statewide Parcels — Duval County (Layer 16)',
    category: 'property',
    url: 'https://gis.fdot.gov/arcgis/rest/services/Parcels/FeatureServer/16',
    collection_method: 'api',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'FDOT statewide parcel data (DOR tax roll joined). FeatureServer layer 16 = Duval County. May require token from some IPs. Provides real parcel IDs (PARCELNO), addresses (APTS_*), valuations (JV, AV_NSD, TV_NSD), coordinates (polygon centroids), owner info (OWN_*), DOR use codes, building data (ACT_YR_BLT, TOT_LVG_AR), land data (ACREAGE). ~368k parcels countywide.',
  },
  {
    source_id: 'duval-sunbiz',
    name: 'Florida SunBiz Corporate Records',
    category: 'ownership',
    url: 'https://search.sunbiz.org/Inquiry/CorporationSearch',
    collection_method: 'scrape',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'Statewide data — must filter to Duval County owners. Corporate name matching is fuzzy. Rate limited.',
  },
  {
    source_id: 'duval-bbb',
    name: 'BBB Contractor Reputation Data',
    category: 'contractor',
    url: 'https://www.bbb.org/search',
    collection_method: 'scrape',
    last_successful_run: null,
    record_count: 0,
    limitations:
      'BBB data is voluntary. Not all contractors are listed. Rating changes may lag. Scraping subject to ToS.',
  },
];

/**
 * Get all Duval County data sources.
 */
export function getDuvalCatalog(): DataSource[] {
  return DUVAL_SOURCES;
}

/**
 * Get a specific source by ID.
 */
export function getSourceById(sourceId: string): DataSource | undefined {
  return DUVAL_SOURCES.find((s) => s.source_id === sourceId);
}

/**
 * Get sources by category.
 */
export function getSourcesByCategory(category: DataSource['category']): DataSource[] {
  return DUVAL_SOURCES.filter((s) => s.category === category);
}
