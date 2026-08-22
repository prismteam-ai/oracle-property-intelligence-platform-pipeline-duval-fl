/**
 * Seed data loader for Duval County parcels.
 * T018 — Import CSV seed file into the properties table as skeleton records.
 */

import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { getPool, runMigrations } from '../lib/db.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface SeedRow {
  parcel_id: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
}

/**
 * Parse the Duval seed CSV file and return rows.
 */
export async function parseSeedCsv(
  csvPath?: string,
): Promise<SeedRow[]> {
  const filePath = csvPath ?? resolve(__dirname, '..', '..', 'data', 'seeds', 'duval.csv');

  return new Promise((resolveP, reject) => {
    const rows: SeedRow[] = [];
    const parser = createReadStream(filePath).pipe(
      parse({ columns: true, trim: true, skip_empty_lines: true }),
    );

    parser.on('data', (row: SeedRow) => rows.push(row));
    parser.on('error', reject);
    parser.on('end', () => resolveP(rows));
  });
}

/**
 * Load seed data into the properties table.
 * Inserts skeleton records (parcel_id + address only) with ON CONFLICT DO NOTHING.
 */
export async function loadSeed(csvPath?: string): Promise<number> {
  const rows = await parseSeedCsv(csvPath);
  const pool = getPool();

  let inserted = 0;

  for (const row of rows) {
    const address = JSON.stringify({
      street: row.address_street,
      city: row.address_city,
      state: row.address_state,
      zip: row.address_zip,
    });

    const result = await pool.query(
      `INSERT INTO properties (parcel_id, address, county_jurisdiction)
       VALUES ($1, $2, 'duval')
       ON CONFLICT (parcel_id) DO NOTHING`,
      [row.parcel_id, address],
    );

    if (result.rowCount && result.rowCount > 0) {
      inserted++;
    }
  }

  console.info(`[seed] loaded ${inserted} new parcels from seed data (${rows.length} total in CSV)`);
  return inserted;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1]?.endsWith('load-seed.ts') ||
  process.argv[1]?.endsWith('load-seed.js');

if (isMain) {
  (async () => {
    try {
      await runMigrations();
      const count = await loadSeed();
      console.info(`Seed loading complete. ${count} records inserted.`);
      process.exit(0);
    } catch (err) {
      console.error('Seed loading failed:', err);
      process.exit(1);
    }
  })();
}
