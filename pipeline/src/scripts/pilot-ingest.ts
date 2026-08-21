/**
 * Pilot ingestion script — run county-ingest workflow with limited parcels.
 * T037 — End-to-end verification for ~25 parcels.
 * T038 — Full county ingestion (same script, no --limit flag).
 *
 * Usage:
 *   npm run ingest -- --county duval --limit 25
 *   npm run ingest -- --county duval                  # full county run
 */

import { randomUUID } from 'node:crypto';
import { getPool, closePool } from '../lib/db.js';
import { runIngestion } from '../lib/ingest.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { county: string; limit?: number } {
  const args = process.argv.slice(2);
  let county = 'duval';
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--county' && args[i + 1]) {
      county = args[i + 1]!;
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]!, 10);
      if (isNaN(limit) || limit < 1) {
        console.error('--limit must be a positive integer');
        process.exit(1);
      }
      i++;
    }
  }

  return { county, limit };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { county, limit } = parseArgs();
  const runId = randomUUID();

  // Create pipeline_run record before calling runIngestion
  const pool = getPool();
  await pool.query(
    `INSERT INTO pipeline_runs (run_id, county, started_at, status, record_count, delta_new, delta_updated, delta_removed, source_limitations)
     VALUES ($1, $2, NOW(), 'running', 0, 0, 0, 0, '[]'::jsonb)
     ON CONFLICT (run_id) DO NOTHING`,
    [runId, county],
  );

  await runIngestion({ county, limit, runId });
  await closePool();
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
