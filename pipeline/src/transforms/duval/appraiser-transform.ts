/**
 * Appraiser data transform — normalize raw appraiser data into Property Record schema.
 * T020 — Lexicon-aligned transformation with derived signal computation.
 */

import type { RawRecord, TransformResult, PropertyRecord } from '../../lib/types.js';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Parse a numeric value from raw data, handling strings with currency symbols, commas, etc.
 */
function parseNumeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Parse an integer value.
 */
function parseInt_(value: unknown): number | null {
  const num = parseNumeric(value);
  return num !== null ? Math.round(num) : null;
}

/**
 * Parse a string value, returning null for empty/undefined.
 */
function parseStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * Compute roof age in years from year_built or roof permit date.
 */
function computeRoofAge(yearBuilt: number | null, _roofPermitDate?: string): number | null {
  // Prefer roof permit date if available
  // For now, fall back to year_built
  if (yearBuilt !== null && yearBuilt > 1800 && yearBuilt <= CURRENT_YEAR) {
    return CURRENT_YEAR - yearBuilt;
  }
  return null;
}

/**
 * Transform raw appraiser records into Lexicon-aligned Property Record fields.
 */
export function transformAppraiserRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'duval-appraiser')
    .map((record) => {
      const raw = record.raw_data;

      const yearBuilt = parseInt_(raw.year_built) ?? parseInt_(raw.yearBuilt);
      const assessedValue = parseNumeric(raw.assessed_value) ?? parseNumeric(raw.assessedValue);
      const marketValue = parseNumeric(raw.market_value) ?? parseNumeric(raw.marketValue);
      const sqft = parseInt_(raw.sqft);
      const stories = parseInt_(raw.stories);
      const bedrooms = parseInt_(raw.bedrooms);
      const bathrooms = parseInt_(raw.bathrooms);
      const roofType = parseStr(raw.roof_type) ?? parseStr(raw.roofType);
      const constructionType = parseStr(raw.construction_type) ?? parseStr(raw.constructionType);
      const useCode = parseStr(raw.use_code) ?? parseStr(raw.useCode);
      const useDescription = parseStr(raw.use_description) ?? parseStr(raw.useDescription);

      const ownerName = parseStr(raw.owner) ?? parseStr(raw.owner_name);
      const address = parseStr(raw.address);

      const lastSaleDate = parseStr(raw.last_sale_date) ?? parseStr(raw.lastSaleDate);
      const lastSalePrice = parseNumeric(raw.last_sale_price) ?? parseNumeric(raw.lastSalePrice);

      const taxYear = parseInt_(raw.tax_year) ?? parseInt_(raw.taxYear);
      const taxableValue = parseNumeric(raw.taxable_value) ?? parseNumeric(raw.taxableValue);
      const annualTax = parseNumeric(raw.annual_tax) ?? parseNumeric(raw.annualTax);

      const roofAge = computeRoofAge(yearBuilt);

      // Parse address string into components if available
      const addressObj = parseAddressString(address);

      const fields: Partial<PropertyRecord> = {
        assessed_value: assessedValue,
        market_value: marketValue,
        structure: {
          year_built: yearBuilt ?? undefined,
          sqft: sqft ?? undefined,
          stories: stories ?? undefined,
          bedrooms: bedrooms ?? undefined,
          bathrooms: bathrooms ?? undefined,
          roof_type: roofType ?? undefined,
          construction_type: constructionType ?? undefined,
          use_code: useCode ?? undefined,
          use_description: useDescription ?? undefined,
        },
        current_owner: ownerName
          ? { owner_name: ownerName }
          : null,
        tax: {
          assessed_value: assessedValue ?? undefined,
          taxable_value: taxableValue ?? undefined,
          tax_year: taxYear ?? undefined,
          annual_tax: annualTax ?? undefined,
        },
        derived_signals: {
          roof_age_years: roofAge ?? undefined,
        },
      };

      // Add address if parseable
      if (addressObj) {
        fields.address = addressObj;
      }

      // Add ownership history if sale data available
      if (ownerName && lastSaleDate) {
        fields.ownership = [
          {
            owner_name: ownerName,
            transfer_date: lastSaleDate,
            sale_price: lastSalePrice ?? undefined,
          },
        ];
      }

      return {
        parcel_id: record.parcel_id,
        fields,
      };
    });
}

/**
 * Parse a free-form address string into components.
 */
function parseAddressString(
  address: string | null,
): { street?: string; city?: string; state?: string; zip?: string; full?: string } | null {
  if (!address) return null;

  // Try to parse "123 Main St, Jacksonville, FL 32202"
  const match = address.match(
    /^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/,
  );

  if (match) {
    return {
      street: match[1]?.trim(),
      city: match[2]?.trim(),
      state: match[3]?.trim(),
      zip: match[4]?.trim(),
      full: address,
    };
  }

  return { full: address };
}

// Default export as TransformFn
export default transformAppraiserRecords;
