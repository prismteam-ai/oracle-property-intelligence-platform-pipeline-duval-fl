/**
 * Query CLI — run arbitrary SQL against DuckDB over published Parquet via httpfs.
 * T044 — npm run query -- "SELECT * FROM properties LIMIT 10"
 *
 * Usage:
 *   npm run query -- "SELECT count(*) FROM properties"
 *   npm run query -- --ipns <ipns-key> "SELECT parcel_id, assessed_value FROM properties WHERE assessed_value > 200000"
 */

import { getConnection, exec, queryAll, closeDb, loadHttpfs, createParquetView } from '../lib/duckdb.js';
import { getName, IPNS_LABELS } from '../lib/ipns.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.info('Usage: npm run query -- [--ipns <key>] "<SQL>"');
    console.info('');
    console.info('Options:');
    console.info('  --ipns <key>   IPNS network key for the query table (auto-resolved if omitted)');
    console.info('');
    console.info('Examples:');
    console.info('  npm run query -- "SELECT count(*) FROM properties"');
    console.info('  npm run query -- "SELECT parcel_id, roof_age_years FROM properties WHERE roof_age_years > 15"');
    process.exit(0);
  }

  // Parse --ipns flag
  let ipnsKey: string | null = null;
  let sql: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ipns' && i + 1 < args.length) {
      ipnsKey = args[i + 1]!;
      i++; // skip next
    } else {
      sql = args[i]!;
    }
  }

  if (!sql) {
    console.error('Error: No SQL query provided');
    process.exit(1);
  }

  // Resolve IPNS key if not provided
  if (!ipnsKey) {
    console.info('[query] Resolving IPNS key for query table...');
    const name = await getName(IPNS_LABELS.queryTable);
    if (name) {
      ipnsKey = name.network_key;
      console.info(`[query] Resolved: ${IPNS_LABELS.queryTable} -> ${ipnsKey}`);
    } else {
      console.error(
        `[query] Could not resolve IPNS label "${IPNS_LABELS.queryTable}". ` +
          'Provide --ipns <key> manually or run publish:query-table first.',
      );
      process.exit(1);
    }
  }

  try {
    // Initialize DuckDB with httpfs
    console.info('[query] Initializing DuckDB with httpfs...');
    await loadHttpfs();

    // Create view over published Parquet
    await createParquetView('properties', ipnsKey);
    console.info('[query] View "properties" created over published Parquet');

    // Execute the user's query
    console.info(`[query] Executing: ${sql}`);
    console.info('---');

    const rows = await queryAll(sql);

    if (rows.length === 0) {
      console.info('(no rows returned)');
    } else {
      // Print as table
      const columns = Object.keys(rows[0]!);
      console.info(columns.join('\t'));
      for (const row of rows) {
        const values = columns.map((c) => {
          const val = (row as Record<string, unknown>)[c];
          return val === null || val === undefined ? 'NULL' : String(val);
        });
        console.info(values.join('\t'));
      }
      console.info(`---`);
      console.info(`${rows.length} row(s)`);
    }
  } catch (err) {
    console.error('[query] Error:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    closeDb();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[query] Fatal error:', err);
  process.exit(1);
});
