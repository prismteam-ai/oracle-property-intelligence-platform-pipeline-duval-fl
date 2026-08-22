/**
 * Real-data pilot ingestion — ingest 25 real Duval County parcels from FDOT.
 *
 * Usage:
 *   USE_REAL_DATA=1 npx tsx pipeline/src/scripts/real-data-pilot.ts [--limit=25]
 *
 * Prerequisites:
 *   - Postgres running (docker compose up -d)
 *   - DATABASE_URL set (or defaults to local)
 *
 * What this does:
 *   1. Fetches real parcel data from FDOT ArcGIS (not geo-blocked)
 *   2. Transforms using the FDOT transform (real addresses, valuations, coordinates)
 *   3. Loads into the properties table
 *   4. Publishes to Filebase (if configured)
 *
 * The FDOT source provides:
 *   - Real parcel IDs (PARCELNO field)
 *   - Real situs addresses (APTS_STRT, APTS_CITY, etc.)
 *   - Real valuations (JV, AV_NSD, TV_NSD)
 *   - Real coordinates (polygon centroids in WGS84)
 *   - Real owner info (OWN_NAME, mailing address)
 *   - Real use codes (DOR_UC — Florida DOR use code)
 *   - Real building data (ACT_YR_BLT, TOT_LVG_AR)
 *   - Real lot data (ACREAGE)
 */

import { randomUUID } from 'node:crypto';
import { getPool, runMigrations } from '../lib/db.js';
import { runIngestion } from '../lib/ingest.js';

async function main() {
  // Ensure real-data mode is enabled
  if (!process.env.USE_REAL_DATA) {
    process.env.USE_REAL_DATA = '1';
  }

  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : 25;

  const runId = `real-pilot-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;

  console.info('='.repeat(60));
  console.info('REAL DATA PILOT — Duval County');
  console.info(`  Source: FDOT Statewide Parcels (not geo-blocked)`);
  console.info(`  Limit: ${limit} parcels`);
  console.info(`  Run ID: ${runId}`);
  console.info('='.repeat(60));

  // Run migrations
  await runMigrations();

  // Create pipeline_run record
  const pool = getPool();
  await pool.query(
    `INSERT INTO pipeline_runs (run_id, county, status) VALUES ($1, 'duval', 'running')
     ON CONFLICT (run_id) DO UPDATE SET status = 'running', started_at = NOW()`,
    [runId],
  );

  // Run the ingestion with real data
  await runIngestion({ county: 'duval', limit, runId });

  // Verify results
  console.info('\n' + '='.repeat(60));
  console.info('VERIFICATION');
  console.info('='.repeat(60));

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM properties WHERE county_jurisdiction = 'duval'`,
  );
  const totalProps = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const sampleResult = await pool.query<{
    parcel_id: string;
    address: string;
    assessed_value: number | null;
    market_value: number | null;
    coordinates: string | null;
  }>(
    `SELECT parcel_id, address::text, assessed_value, market_value, coordinates::text
     FROM properties
     WHERE county_jurisdiction = 'duval'
     ORDER BY created_at DESC
     LIMIT 5`,
  );

  console.info(`\nTotal properties in DB: ${totalProps}`);
  console.info('\nSample records:');
  for (const row of sampleResult.rows) {
    const addr = typeof row.address === 'string' ? JSON.parse(row.address) : row.address;
    const coords = typeof row.coordinates === 'string' ? JSON.parse(row.coordinates) : row.coordinates;
    console.info(`  ${row.parcel_id} | ${addr?.full ?? addr?.street ?? 'no address'} | AV=$${row.assessed_value ?? 'null'} | MV=$${row.market_value ?? 'null'} | coords=(${coords?.lat?.toFixed(4) ?? 'null'}, ${coords?.lng?.toFixed(4) ?? 'null'})`);
  }

  // Check field coverage
  const coverageResult = await pool.query<{
    has_address: string;
    has_assessed: string;
    has_market: string;
    has_coords: string;
    has_owner: string;
    has_structure: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE address IS NOT NULL AND address::text != '{}' AND address::text != 'null') as has_address,
       COUNT(*) FILTER (WHERE assessed_value IS NOT NULL) as has_assessed,
       COUNT(*) FILTER (WHERE market_value IS NOT NULL) as has_market,
       COUNT(*) FILTER (WHERE coordinates IS NOT NULL AND coordinates::text != 'null') as has_coords,
       COUNT(*) FILTER (WHERE current_owner IS NOT NULL AND current_owner::text != 'null') as has_owner,
       COUNT(*) FILTER (WHERE structure IS NOT NULL AND structure::text != '{}') as has_structure
     FROM properties
     WHERE county_jurisdiction = 'duval'`,
  );

  if (coverageResult.rows[0]) {
    const c = coverageResult.rows[0];
    console.info('\nField coverage:');
    console.info(`  Address:        ${c.has_address}/${totalProps}`);
    console.info(`  Assessed value: ${c.has_assessed}/${totalProps}`);
    console.info(`  Market value:   ${c.has_market}/${totalProps}`);
    console.info(`  Coordinates:    ${c.has_coords}/${totalProps}`);
    console.info(`  Owner:          ${c.has_owner}/${totalProps}`);
    console.info(`  Structure:      ${c.has_structure}/${totalProps}`);
  }

  console.info('\n' + '='.repeat(60));
  console.info('PILOT COMPLETE');
  console.info('='.repeat(60));

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
