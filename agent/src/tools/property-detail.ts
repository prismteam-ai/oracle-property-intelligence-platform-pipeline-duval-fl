/**
 * Agent tool: getPropertyDetail — single-property lookup by parcel_id.
 * T057 — Vercel AI SDK tool definition for property detail.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { queryAll } from './duckdb-helper.js';

export const getPropertyDetail = tool({
  description:
    'Look up a single property by its parcel ID (e.g., RE0001234). Returns all available ' +
    'attributes including address, assessed value, roof age, ownership tenure, water proximity, ' +
    'transit distance, Starbucks distance, owner info, and source provenance.',
  parameters: z.object({
    parcel_id: z.string().describe('The parcel ID to look up (e.g., RE0001234)'),
  }),
  execute: async ({ parcel_id }) => {
    try {
      const rows = await queryAll(
        `SELECT * FROM properties WHERE parcel_id = '${parcel_id.replace(/'/g, "''")}'`,
      );

      if (rows.length === 0) {
        return {
          error: `No property found with parcel_id: ${parcel_id}`,
        };
      }

      return {
        property: rows[0],
        data_source: 'Published Parquet via DuckDB (IPFS/IPNS)',
      };
    } catch (err) {
      return {
        error: `Lookup failed: ${String(err)}`,
        parcel_id,
      };
    }
  },
});
