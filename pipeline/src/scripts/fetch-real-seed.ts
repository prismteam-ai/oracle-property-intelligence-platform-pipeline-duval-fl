/**
 * Fetch real Duval County parcel data from the FDOT statewide parcel ArcGIS service
 * and generate a seed CSV at pipeline/data/seeds/duval.csv.
 *
 * Usage:
 *   npx tsx pipeline/src/scripts/fetch-real-seed.ts [--limit=50] [--commercial-first]
 *
 * This replaces the fabricated seed data with real parcel IDs, addresses, and metadata
 * from the Florida DOT's statewide parcel service (not geo-blocked).
 *
 * Source: https://gis.fdot.gov/arcgis/rest/services/Parcels/MapServer/0
 * Filter: CO_NO=16 (Duval County)
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchDuvalParcels, generateRealSeedCsv } from '../sources/fdot-parcels.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : 50;
  const commercialFirst = args.includes('--commercial-first');

  console.info('='.repeat(60));
  console.info('Fetching REAL Duval County parcel data from FDOT');
  console.info(`  Limit: ${limit}`);
  console.info(`  Commercial first: ${commercialFirst}`);
  console.info('='.repeat(60));

  // Fetch real parcels
  const records = await fetchDuvalParcels(limit);

  if (records.length === 0) {
    console.error('ERROR: No parcels returned from FDOT API. Check network connectivity.');
    process.exit(1);
  }

  // Sort commercial first if requested
  if (commercialFirst) {
    records.sort((a, b) => {
      const aCode = parseInt(String(a.raw_data.dor_use_code ?? '99'), 10);
      const bCode = parseInt(String(b.raw_data.dor_use_code ?? '99'), 10);
      const aCommercial = aCode >= 10 && aCode <= 39 ? 0 : 1;
      const bCommercial = bCode >= 10 && bCode <= 39 ? 0 : 1;
      return aCommercial - bCommercial;
    });
  }

  // Generate CSV
  const header = 'parcel_id,address_street,address_city,address_state,address_zip';
  const rows = records.map((r) => {
    const d = r.raw_data;
    const street = String(d.address_street ?? '').replace(/"/g, '""');
    const city = String(d.address_city ?? '').replace(/"/g, '""');
    const state = String(d.address_state ?? 'FL');
    const zip = String(d.address_zip ?? '');
    return `${r.parcel_id},"${street}","${city}","${state}","${zip}"`;
  });

  const csv = [header, ...rows].join('\n') + '\n';

  // Write seed CSV
  const seedPath = resolve(__dirname, '..', '..', 'data', 'seeds', 'duval.csv');
  writeFileSync(seedPath, csv);
  console.info(`\nSeed CSV written: ${seedPath}`);
  console.info(`  Parcels: ${records.length}`);

  // Also write extended data as JSON for the real-data ingestion
  const jsonPath = resolve(__dirname, '..', '..', 'data', 'seeds', 'duval-fdot.json');
  writeFileSync(jsonPath, JSON.stringify(records, null, 2));
  console.info(`  Extended FDOT data: ${jsonPath}`);

  // Print summary
  console.info('\nSample parcels:');
  for (const r of records.slice(0, 5)) {
    const d = r.raw_data;
    console.info(`  ${r.parcel_id} | ${d.address_street}, ${d.address_city} ${d.address_zip} | JV=$${d.just_value} | UC=${d.dor_use_code} | YrBlt=${d.year_built}`);
  }

  // Count use code distribution
  const useCodes: Record<string, number> = {};
  for (const r of records) {
    const uc = String(r.raw_data.dor_use_code ?? 'unknown');
    useCodes[uc] = (useCodes[uc] ?? 0) + 1;
  }
  console.info('\nUse code distribution:');
  for (const [code, count] of Object.entries(useCodes).sort((a, b) => b[1] - a[1])) {
    console.info(`  UC ${code}: ${count} parcels`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
