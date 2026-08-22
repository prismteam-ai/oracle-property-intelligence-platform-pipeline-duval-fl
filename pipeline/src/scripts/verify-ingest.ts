/**
 * Ingestion verification script — check pipeline output quality.
 * T039 — Verify property count, per-source counts, reconciliation,
 *         provenance completeness, derived signal coverage.
 *
 * Usage:
 *   npm run verify
 *   npm run verify -- --county duval
 */

import { getPool, closePool } from '../lib/db.js';
import type { Provenance, DerivedSignals } from '../lib/types.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { county: string } {
  const args = process.argv.slice(2);
  let county = 'duval';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--county' && args[i + 1]) {
      county = args[i + 1]!;
      i++;
    }
  }

  return { county };
}

// ---------------------------------------------------------------------------
// Verification checks
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  passed: boolean;
  details: string;
  value?: number | string;
}

async function runChecks(county: string): Promise<CheckResult[]> {
  const pool = getPool();
  const results: CheckResult[] = [];

  // 1. Total property count
  const countResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM properties WHERE county_jurisdiction = $1',
    [county],
  );
  const totalProperties = parseInt(countResult.rows[0]?.count ?? '0', 10);
  results.push({
    name: 'Total Property Count',
    passed: totalProperties > 0,
    details: totalProperties > 0
      ? `${totalProperties} properties in database`
      : 'No properties found in database',
    value: totalProperties,
  });

  // 2. No duplicate parcel IDs
  const dupeResult = await pool.query<{ dupe_count: string }>(
    `SELECT COUNT(*) as dupe_count FROM (
       SELECT parcel_id FROM properties WHERE county_jurisdiction = $1
       GROUP BY parcel_id HAVING COUNT(*) > 1
     ) dupes`,
    [county],
  );
  const dupeCount = parseInt(dupeResult.rows[0]?.dupe_count ?? '0', 10);
  results.push({
    name: 'No Duplicate Parcel IDs',
    passed: dupeCount === 0,
    details: dupeCount === 0
      ? 'No duplicate parcel_ids found'
      : `${dupeCount} duplicate parcel_ids detected`,
    value: dupeCount,
  });

  // 3. Pipeline run exists and completed
  const runResult = await pool.query<{
    run_id: string;
    status: string;
    record_count: number;
    delta_new: number;
    delta_updated: number;
    started_at: string;
    completed_at: string;
  }>(
    `SELECT run_id, status, record_count, delta_new, delta_updated, started_at, completed_at
     FROM pipeline_runs WHERE county = $1 ORDER BY started_at DESC LIMIT 1`,
    [county],
  );
  const latestRun = runResult.rows[0];
  results.push({
    name: 'Pipeline Run Completed',
    passed: !!latestRun && (latestRun.status === 'success' || latestRun.status === 'partial'),
    details: latestRun
      ? `Last run: ${latestRun.run_id} (${latestRun.status}), ${latestRun.record_count} records`
      : 'No pipeline runs found',
    value: latestRun?.status ?? 'none',
  });

  // 4. Per-source record counts
  if (latestRun) {
    const sourceResult = await pool.query<{
      source_id: string;
      records_ingested: number;
      status: string;
      duration_ms: number;
    }>(
      'SELECT source_id, records_ingested, status, duration_ms FROM run_sources WHERE run_id = $1',
      [latestRun.run_id],
    );

    const expectedSources = [
      'duval-appraiser',
      'duval-permits',
      'duval-ownership',
      'duval-geo',
      'duval-business',
      'duval-contractor',
      'duval-sunbiz',
      'duval-bbb',
    ];

    const ingestedSources = new Set(sourceResult.rows.map((r) => r.source_id));
    const missingSources = expectedSources.filter((s) => !ingestedSources.has(s));

    results.push({
      name: 'All Sources Ingested',
      passed: missingSources.length === 0,
      details: missingSources.length === 0
        ? `All ${expectedSources.length} sources ingested`
        : `Missing sources: ${missingSources.join(', ')}`,
      value: `${ingestedSources.size}/${expectedSources.length}`,
    });

    // Per-source detail
    for (const source of sourceResult.rows) {
      results.push({
        name: `  Source: ${source.source_id}`,
        passed: source.status === 'success' || source.status === 'partial',
        details: `${source.records_ingested} records, ${source.duration_ms}ms, status=${source.status}`,
        value: source.records_ingested,
      });
    }
  }

  // 5. Provenance completeness — every record should have provenance
  const provenanceResult = await pool.query<{ no_prov_count: string }>(
    `SELECT COUNT(*) as no_prov_count FROM properties
     WHERE county_jurisdiction = $1
       AND (provenance IS NULL OR provenance::text = '{}' OR provenance::text = 'null')`,
    [county],
  );
  const noProvCount = parseInt(provenanceResult.rows[0]?.no_prov_count ?? '0', 10);
  const provenancePct = totalProperties > 0
    ? Math.round(((totalProperties - noProvCount) / totalProperties) * 100)
    : 0;
  results.push({
    name: 'Provenance Completeness',
    passed: noProvCount === 0,
    details: `${provenancePct}% of records have provenance (${noProvCount} missing)`,
    value: `${provenancePct}%`,
  });

  // 6. Provenance contributing_sources coverage
  const provSourceResult = await pool.query<{ provenance: Provenance }>(
    `SELECT provenance FROM properties WHERE county_jurisdiction = $1 AND provenance IS NOT NULL LIMIT 100`,
    [county],
  );
  const sourceCountMap: Record<string, number> = {};
  let totalChecked = 0;
  for (const row of provSourceResult.rows) {
    const prov = typeof row.provenance === 'string'
      ? (JSON.parse(row.provenance) as Provenance)
      : row.provenance;
    if (prov?.contributing_sources) {
      totalChecked++;
      for (const src of prov.contributing_sources) {
        sourceCountMap[src] = (sourceCountMap[src] ?? 0) + 1;
      }
    }
  }
  results.push({
    name: 'Provenance Source Coverage (sample)',
    passed: Object.keys(sourceCountMap).length > 0,
    details: `Sources referenced in provenance: ${Object.entries(sourceCountMap).map(([k, v]) => `${k}(${v})`).join(', ')}`,
    value: Object.keys(sourceCountMap).length,
  });

  // 7. Derived signals coverage
  const signalChecks = [
    { signal: 'roof_age_years', name: 'Roof Age Signal' },
    { signal: 'ownership_tenure_years', name: 'Ownership Tenure Signal' },
    { signal: 'is_regional_owner', name: 'Regional Owner Signal' },
    { signal: 'water_proximity_ft', name: 'Water Proximity Signal' },
    { signal: 'transit_distance_mi', name: 'Transit Distance Signal' },
    { signal: 'starbucks_distance_mi', name: 'Starbucks Distance Signal' },
  ];

  const signalResult = await pool.query<{ derived_signals: DerivedSignals }>(
    `SELECT derived_signals FROM properties WHERE county_jurisdiction = $1 AND derived_signals IS NOT NULL LIMIT 100`,
    [county],
  );

  for (const check of signalChecks) {
    let hasSignal = 0;
    for (const row of signalResult.rows) {
      const signals = typeof row.derived_signals === 'string'
        ? (JSON.parse(row.derived_signals) as DerivedSignals)
        : row.derived_signals;
      if (signals && (signals as Record<string, unknown>)[check.signal] !== undefined) {
        hasSignal++;
      }
    }
    const coverage = signalResult.rows.length > 0
      ? Math.round((hasSignal / signalResult.rows.length) * 100)
      : 0;
    results.push({
      name: `  ${check.name}`,
      passed: coverage > 0,
      details: `${coverage}% coverage (${hasSignal}/${signalResult.rows.length} sample)`,
      value: `${coverage}%`,
    });
  }

  // 8. Content hash presence (idempotency readiness)
  const hashResult = await pool.query<{ hash_count: string }>(
    `SELECT COUNT(*) as hash_count FROM properties
     WHERE county_jurisdiction = $1 AND content_hash IS NOT NULL`,
    [county],
  );
  const hashCount = parseInt(hashResult.rows[0]?.hash_count ?? '0', 10);
  const hashPct = totalProperties > 0
    ? Math.round((hashCount / totalProperties) * 100)
    : 0;
  results.push({
    name: 'Content Hash Coverage',
    passed: hashPct === 100 || totalProperties === 0,
    details: `${hashPct}% of records have content hash (${hashCount}/${totalProperties})`,
    value: `${hashPct}%`,
  });

  // 9. Reconciliation confidence scores
  const confidenceResult = await pool.query<{
    avg_confidence: string;
    min_confidence: string;
    max_confidence: string;
  }>(
    `SELECT
       AVG((provenance->>'reconciliation_confidence')::float) as avg_confidence,
       MIN((provenance->>'reconciliation_confidence')::float) as min_confidence,
       MAX((provenance->>'reconciliation_confidence')::float) as max_confidence
     FROM properties
     WHERE county_jurisdiction = $1
       AND provenance IS NOT NULL
       AND provenance->>'reconciliation_confidence' IS NOT NULL`,
    [county],
  );
  const avgConf = parseFloat(confidenceResult.rows[0]?.avg_confidence ?? '0');
  const minConf = parseFloat(confidenceResult.rows[0]?.min_confidence ?? '0');
  const maxConf = parseFloat(confidenceResult.rows[0]?.max_confidence ?? '0');
  results.push({
    name: 'Reconciliation Confidence',
    passed: avgConf > 0,
    details: `avg=${avgConf.toFixed(2)}, min=${minConf.toFixed(2)}, max=${maxConf.toFixed(2)}`,
    value: avgConf.toFixed(2),
  });

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { county } = parseArgs();

  console.info('='.repeat(60));
  console.info('Oracle Pipeline — Ingestion Verification');
  console.info(`  County: ${county}`);
  console.info('='.repeat(60));
  console.info('');

  try {
    const results = await runChecks(county);

    let passCount = 0;
    let failCount = 0;

    for (const check of results) {
      const icon = check.passed ? 'PASS' : 'FAIL';
      const pad = check.name.startsWith('  ') ? '  ' : '';
      console.info(`  [${icon}] ${pad}${check.name}`);
      console.info(`         ${check.details}`);
      if (check.passed) passCount++;
      else failCount++;
    }

    console.info('');
    console.info('='.repeat(60));
    console.info(`VERIFICATION SUMMARY: ${passCount} passed, ${failCount} failed`);
    console.info('='.repeat(60));

    if (failCount > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Verification failed:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
