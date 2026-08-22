/**
 * Agent tool: queryProperties — DuckDB SQL over published Parquet via httpfs.
 * T057 — Vercel AI SDK tool definition for property queries.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { queryAll, loadHttpfs, createParquetView, exec } from './duckdb-helper.js';

let initialized = false;

/**
 * Ensure DuckDB is ready with httpfs and the query-table view.
 */
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await loadHttpfs();

  const ipnsKey = process.env.ORACLE_QUERY_TABLE_IPNS_KEY ?? '';
  if (ipnsKey) {
    await createParquetView('properties', ipnsKey);
  } else {
    // Fallback: create an empty view for development
    await exec(`
      CREATE OR REPLACE VIEW properties AS
      SELECT
        '' as parcel_id,
        '' as address,
        0 as assessed_value,
        0 as market_value,
        0 as roof_age_years,
        0 as ownership_tenure_years,
        false as is_regional_owner,
        0.0 as water_proximity_ft,
        false as is_waterfront,
        0.0 as transit_distance_mi,
        0.0 as starbucks_distance_mi,
        false as within_walking_transit,
        false as within_walking_starbucks,
        '' as current_owner_name,
        '' as contributing_sources,
        '' as last_pipeline_run
      WHERE false
    `);
  }
  initialized = true;
}

export const queryProperties = tool({
  description:
    'Query Duval County property data using SQL. The data is stored in a "properties" table ' +
    'with columns: parcel_id, address, assessed_value, market_value, roof_age_years, ' +
    'ownership_tenure_years, is_regional_owner, water_proximity_ft, is_waterfront, ' +
    'transit_distance_mi, starbucks_distance_mi, within_walking_transit, within_walking_starbucks, ' +
    'current_owner_name, contributing_sources, last_pipeline_run. ' +
    'Write DuckDB-compatible SQL. Always limit results to 20 rows unless the user asks for a count.',
  parameters: z.object({
    sql: z.string().describe('DuckDB SQL query to execute against the properties table'),
    explanation: z.string().describe('Brief explanation of what this query does'),
  }),
  execute: async ({ sql, explanation }) => {
    await ensureInit();

    try {
      // Safety: only allow SELECT
      const trimmed = sql.trim().toUpperCase();
      if (!trimmed.startsWith('SELECT')) {
        return {
          error: 'Only SELECT queries are allowed',
          explanation,
        };
      }

      const rows = await queryAll(sql);
      return {
        results: rows.slice(0, 100), // hard cap
        row_count: rows.length,
        query_executed: sql,
        explanation,
        data_source: 'Published Parquet via DuckDB (IPFS/IPNS)',
      };
    } catch (err) {
      return {
        error: `Query failed: ${String(err)}`,
        query_attempted: sql,
        explanation,
      };
    }
  },
});
