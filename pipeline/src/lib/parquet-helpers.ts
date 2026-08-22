/**
 * Shared Parquet helpers — flatten property records and build Parquet buffers.
 * Extracted from publish-query-table.ts for reuse in ingest.ts.
 */

import type { PropertyRecord } from './types.js';

// ---------------------------------------------------------------------------
// Flatten property record to tabular format
// ---------------------------------------------------------------------------

export function flattenProperty(prop: PropertyRecord): Record<string, unknown> {
  return {
    uuid: prop.uuid,
    parcel_id: prop.parcel_id,
    street: prop.address?.street ?? null,
    city: prop.address?.city ?? null,
    state: prop.address?.state ?? null,
    zip: prop.address?.zip ?? null,
    full_address: prop.address?.full ?? null,
    county_jurisdiction: prop.county_jurisdiction,
    assessed_value: prop.assessed_value,
    market_value: prop.market_value,
    current_owner_name: prop.current_owner?.owner_name ?? null,
    current_owner_type: prop.current_owner?.owner_type ?? null,
    year_built: prop.structure?.year_built ?? null,
    sqft: prop.structure?.sqft ?? null,
    stories: prop.structure?.stories ?? null,
    bedrooms: prop.structure?.bedrooms ?? null,
    bathrooms: prop.structure?.bathrooms ?? null,
    roof_type: prop.structure?.roof_type ?? null,
    construction_type: prop.structure?.construction_type ?? null,
    use_code: prop.structure?.use_code ?? null,
    use_description: prop.structure?.use_description ?? null,
    lot_area_sqft: prop.lot?.area_sqft ?? null,
    lot_area_acres: prop.lot?.area_acres ?? null,
    zoning: prop.lot?.zoning ?? null,
    lat: prop.coordinates?.lat ?? null,
    lng: prop.coordinates?.lng ?? null,
    taxable_value: prop.tax?.taxable_value ?? null,
    tax_year: prop.tax?.tax_year ?? null,
    annual_tax: prop.tax?.annual_tax ?? null,
    // Derived signals as top-level columns
    roof_age_years: prop.derived_signals?.roof_age_years ?? null,
    ownership_tenure_years: prop.derived_signals?.ownership_tenure_years ?? null,
    is_regional_owner: prop.derived_signals?.is_regional_owner ?? null,
    water_proximity_ft: prop.derived_signals?.water_proximity_ft ?? null,
    is_waterfront: prop.derived_signals?.is_waterfront ?? null,
    transit_distance_mi: prop.derived_signals?.transit_distance_mi ?? null,
    starbucks_distance_mi: prop.derived_signals?.starbucks_distance_mi ?? null,
    within_walking_transit: prop.derived_signals?.within_walking_transit ?? null,
    within_walking_starbucks: prop.derived_signals?.within_walking_starbucks ?? null,
    // Provenance summary
    source_count: prop.provenance?.contributing_sources?.length ?? 0,
    reconciliation_confidence: prop.provenance?.reconciliation_confidence ?? null,
    last_pipeline_run: prop.provenance?.last_pipeline_run ?? null,
  };
}

// ---------------------------------------------------------------------------
// Build Parquet buffer from flat rows
// ---------------------------------------------------------------------------

export async function buildParquetBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const parquet = await import('parquetjs-lite');

  const schema = new parquet.ParquetSchema({
    uuid: { type: 'UTF8' },
    parcel_id: { type: 'UTF8' },
    street: { type: 'UTF8', optional: true },
    city: { type: 'UTF8', optional: true },
    state: { type: 'UTF8', optional: true },
    zip: { type: 'UTF8', optional: true },
    full_address: { type: 'UTF8', optional: true },
    county_jurisdiction: { type: 'UTF8' },
    assessed_value: { type: 'DOUBLE', optional: true },
    market_value: { type: 'DOUBLE', optional: true },
    current_owner_name: { type: 'UTF8', optional: true },
    current_owner_type: { type: 'UTF8', optional: true },
    year_built: { type: 'INT32', optional: true },
    sqft: { type: 'INT32', optional: true },
    stories: { type: 'INT32', optional: true },
    bedrooms: { type: 'INT32', optional: true },
    bathrooms: { type: 'INT32', optional: true },
    roof_type: { type: 'UTF8', optional: true },
    construction_type: { type: 'UTF8', optional: true },
    use_code: { type: 'UTF8', optional: true },
    use_description: { type: 'UTF8', optional: true },
    lot_area_sqft: { type: 'DOUBLE', optional: true },
    lot_area_acres: { type: 'DOUBLE', optional: true },
    zoning: { type: 'UTF8', optional: true },
    lat: { type: 'DOUBLE', optional: true },
    lng: { type: 'DOUBLE', optional: true },
    taxable_value: { type: 'DOUBLE', optional: true },
    tax_year: { type: 'INT32', optional: true },
    annual_tax: { type: 'DOUBLE', optional: true },
    roof_age_years: { type: 'INT32', optional: true },
    ownership_tenure_years: { type: 'INT32', optional: true },
    is_regional_owner: { type: 'BOOLEAN', optional: true },
    water_proximity_ft: { type: 'DOUBLE', optional: true },
    is_waterfront: { type: 'BOOLEAN', optional: true },
    transit_distance_mi: { type: 'DOUBLE', optional: true },
    starbucks_distance_mi: { type: 'DOUBLE', optional: true },
    within_walking_transit: { type: 'BOOLEAN', optional: true },
    within_walking_starbucks: { type: 'BOOLEAN', optional: true },
    source_count: { type: 'INT32', optional: true },
    reconciliation_confidence: { type: 'DOUBLE', optional: true },
    last_pipeline_run: { type: 'UTF8', optional: true },
  });

  const writer = await parquet.ParquetWriter.openBuffer(schema);

  for (const row of rows) {
    const cleanRow: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val !== null && val !== undefined) {
        cleanRow[key] = val;
      }
    }
    await writer.appendRow(cleanRow);
  }

  await writer.close();

  return (writer as unknown as { toBuffer: () => Buffer }).toBuffer();
}
