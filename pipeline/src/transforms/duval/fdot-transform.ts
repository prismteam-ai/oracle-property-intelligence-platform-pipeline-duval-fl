/**
 * FDOT parcel data transform — normalize real FDOT ArcGIS data into Property Record schema.
 * Maps Florida DOT statewide parcel attributes to the lexicon-aligned property fields.
 *
 * This transform handles REAL data from:
 * https://gis.fdot.gov/arcgis/rest/services/Parcels/MapServer/0
 */

import type { RawRecord, TransformResult, PropertyRecord, Address, Owner, Coordinates, Lot, Structure, Tax, DerivedSignals } from '../../lib/types.js';

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Florida DOR Use Code descriptions (subset of common codes for Duval County).
 * Full list: https://floridarevenue.com/property/Documents/dorUseCodeList.pdf
 */
const DOR_USE_CODES: Record<string, string> = {
  '0000': 'Vacant Residential',
  '0001': 'Single Family Residential',
  '0002': 'Mobile Home',
  '0004': 'Condominium',
  '0005': 'Cooperatives',
  '0006': 'Retirement Homes',
  '0007': 'Miscellaneous Residential',
  '0008': 'Multi-Family (< 10 units)',
  '0009': 'Multi-Family (10+ units)',
  '0010': 'Vacant Commercial',
  '0011': 'Stores (one story)',
  '0012': 'Mixed Use (store + office/res)',
  '0013': 'Department Store',
  '0014': 'Supermarket',
  '0016': 'Community Shopping Center',
  '0017': 'Office (one story)',
  '0018': 'Office (multi-story)',
  '0019': 'Professional Service Building',
  '0020': 'Airport/Marina/Bus Terminal',
  '0021': 'Restaurant/Cafeteria',
  '0023': 'Financial Institution',
  '0024': 'Insurance Company Office',
  '0025': 'Repair Service Shop',
  '0026': 'Service Station',
  '0027': 'Auto Sales/Repair',
  '0028': 'Parking Lot/Mobile Home Park',
  '0029': 'Wholesale/Manufacturing Outlet',
  '0030': 'Vacant Industrial',
  '0031': 'Light Manufacturing',
  '0032': 'Heavy Manufacturing',
  '0033': 'Lumber Yard',
  '0034': 'Packing Plant',
  '0035': 'Bottling/Canning Plant',
  '0038': 'Warehouse',
  '0039': 'Wholesale/Distribution',
  '0040': 'Vacant Ag/Rural',
  '0048': 'Cropland (class 4-above)',
  '0050': 'Improved Agricultural',
  '0060': 'Vacant Institutional',
  '0070': 'Vacant Government',
  '0071': 'Church',
  '0072': 'Private School/College',
  '0073': 'Private Hospital',
  '0074': 'Home for Aged',
  '0075': 'Orphanage/Non-Profit Service',
  '0077': 'Clubs/Lodge/Union Halls',
  '0080': 'Undefined',
  '0081': 'Military',
  '0082': 'Forest/Park/Rec Area',
  '0083': 'Public County School',
  '0084': 'College',
  '0085': 'Hospital',
  '0086': 'County/Gov',
  '0087': 'State',
  '0088': 'Federal',
  '0089': 'Municipal/City',
  '0090': 'Leasehold Interest',
  '0091': 'Utilities',
  '0092': 'Mining/Petroleum',
  '0093': 'Subsurface Rights',
  '0094': 'Right-of-Way/Streets/Roads',
  '0095': 'River/Lake/Submerged Land',
  '0096': 'Sewage Disposal/Waste',
  '0097': 'Outdoor Recreation',
  '0099': 'Acreage/Non-Ag',
};

/**
 * Classify a DOR use code into a broad category.
 */
function classifyUseCode(dorUc: string | null): 'residential' | 'commercial' | 'industrial' | 'agricultural' | 'government' | 'institutional' | 'vacant' | 'other' {
  if (!dorUc) return 'other';
  const code = parseInt(dorUc, 10);
  if (isNaN(code)) return 'other';

  if (code >= 0 && code <= 9) return code === 0 ? 'vacant' : 'residential';
  if (code >= 10 && code <= 29) return code === 10 ? 'vacant' : 'commercial';
  if (code >= 30 && code <= 39) return code === 30 ? 'vacant' : 'industrial';
  if (code >= 40 && code <= 59) return code === 40 || code === 50 ? 'vacant' : 'agricultural';
  if (code >= 60 && code <= 69) return 'institutional';
  if (code >= 70 && code <= 79) return code === 70 ? 'vacant' : 'institutional';
  if (code >= 80 && code <= 89) return 'government';
  return 'other';
}

// Duval County local cities for regional owner detection
const LOCAL_CITIES = new Set([
  'jacksonville', 'jacksonville beach', 'neptune beach', 'atlantic beach',
  'ponte vedra', 'ponte vedra beach', 'orange park', 'fleming island',
  'green cove springs', 'fernandina beach', 'yulee', 'callahan',
  'baldwin', 'middleburg',
]);

function isRegionalOwner(ownerCity: string | null, ownerState: string | null): boolean {
  if (!ownerCity && !ownerState) return false;
  if (ownerState && ownerState.toLowerCase() !== 'fl') return true;
  if (ownerCity && !LOCAL_CITIES.has(ownerCity.toLowerCase())) return true;
  return false;
}

/**
 * Transform FDOT parcel records into Property Record fields.
 * This maps REAL data from the FDOT ArcGIS statewide parcel service.
 */
export function transformFdotRecords(records: RawRecord[]): TransformResult[] {
  return records
    .filter((r) => r.source_id === 'fdot-duval-parcels')
    .map((record) => {
      const d = record.raw_data;

      // Address
      const address: Address = {
        street: (d.address_street as string) ?? undefined,
        city: (d.address_city as string) ?? undefined,
        state: (d.address_state as string) ?? 'FL',
        zip: (d.address_zip as string) ?? undefined,
      };
      if (address.street && address.city) {
        address.full = `${address.street}, ${address.city}, ${address.state ?? 'FL'} ${address.zip ?? ''}`.trim();
      }

      // Owner
      const ownerName = d.owner_name as string | null;
      const ownerCity = d.owner_city as string | null;
      const ownerState = d.owner_state as string | null;
      const currentOwner: Owner | null = ownerName
        ? {
            owner_name: ownerName,
            mailing_address: {
              street: (d.owner_addr1 as string) ?? undefined,
              city: ownerCity ?? undefined,
              state: ownerState ?? undefined,
              zip: (d.owner_zip as string) ?? undefined,
            },
          }
        : null;

      // Valuations
      const justValue = typeof d.just_value === 'number' ? d.just_value : null;
      const assessedValue = typeof d.assessed_value === 'number' ? d.assessed_value : null;
      const taxableValue = typeof d.taxable_value === 'number' ? d.taxable_value : null;
      const landValue = typeof d.land_value === 'number' ? d.land_value : null;
      const buildingValue = typeof d.building_value === 'number' ? d.building_value : null;

      // Structure
      const yearBuilt = typeof d.year_built === 'number' && d.year_built > 1800 ? d.year_built : null;
      const totalLivingArea = typeof d.total_living_area === 'number' ? d.total_living_area : null;
      const dorUseCode = d.dor_use_code as string | null;
      const useCodePadded = dorUseCode ? dorUseCode.padStart(4, '0') : null;
      const useDescription = useCodePadded ? (DOR_USE_CODES[useCodePadded] ?? `DOR Code ${dorUseCode}`) : undefined;

      const structure: Structure = {
        year_built: yearBuilt ?? undefined,
        sqft: totalLivingArea ?? undefined,
        use_code: dorUseCode ?? undefined,
        use_description: useDescription,
      };

      // Coordinates (centroid from polygon)
      let coordinates: Coordinates | null = null;
      const centroid = d.centroid as { lat: number; lng: number } | null;
      if (centroid && typeof centroid.lat === 'number' && typeof centroid.lng === 'number') {
        coordinates = { lat: centroid.lat, lng: centroid.lng };
      }

      // Lot
      const acreage = typeof d.acreage === 'number' ? d.acreage : null;
      const lot: Lot = {};
      if (acreage && acreage > 0) {
        lot.area_acres = acreage;
        lot.area_sqft = Math.round(acreage * 43560);
      }

      // Tax
      const tax: Tax = {
        assessed_value: (assessedValue as number) ?? undefined,
        taxable_value: (taxableValue as number) ?? undefined,
      };

      // Derived signals
      const roofAge = yearBuilt ? CURRENT_YEAR - yearBuilt : undefined;
      const regional = isRegionalOwner(ownerCity, ownerState);

      const derivedSignals: DerivedSignals = {
        roof_age_years: roofAge,
        is_regional_owner: regional,
      };

      const fields: Partial<PropertyRecord> = {
        address,
        assessed_value: assessedValue,
        market_value: justValue as number | null,
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
