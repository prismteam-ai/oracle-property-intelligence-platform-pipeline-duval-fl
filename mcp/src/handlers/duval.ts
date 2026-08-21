/**
 * Duval County MCP handler.
 * T062 — Resolves IPNS pointers, queries published Parquet via DuckDB httpfs.
 * Zero hosted database dependency — all reads from published IPFS data.
 */

import { queryAll, exec, loadHttpfs, createParquetView, closeDb } from './duckdb.js';

// ---------------------------------------------------------------------------
// IPNS map configuration
// ---------------------------------------------------------------------------

export interface IpnsMapConfig {
  openData: Record<string, string>;   // county -> IPNS key
  queryTable: Record<string, string>; // county -> IPNS key
}

/**
 * Parse IPNS maps from environment variables.
 * ORACLE_OPEN_DATA_IPNS_MAP: JSON like {"duval":"<ipns-key>"}
 * ORACLE_QUERY_TABLE_IPNS_MAP: JSON like {"duval":"<ipns-key>"}
 */
export function loadIpnsMaps(): IpnsMapConfig {
  const openDataRaw = process.env.ORACLE_OPEN_DATA_IPNS_MAP ?? '{}';
  const queryTableRaw = process.env.ORACLE_QUERY_TABLE_IPNS_MAP ?? '{}';

  return {
    openData: JSON.parse(openDataRaw) as Record<string, string>,
    queryTable: JSON.parse(queryTableRaw) as Record<string, string>,
  };
}

// ---------------------------------------------------------------------------
// County info
// ---------------------------------------------------------------------------

export interface CountyInfo {
  county: string;
  openDataIpnsKey: string | null;
  queryTableIpnsKey: string | null;
  openDataGatewayUrl: string | null;
  queryTableGatewayUrl: string | null;
}

/**
 * List all available counties with their IPNS pointers.
 */
export function listCounties(config: IpnsMapConfig): CountyInfo[] {
  const counties = new Set<string>([
    ...Object.keys(config.openData),
    ...Object.keys(config.queryTable),
  ]);

  return Array.from(counties).map((county) => {
    const openDataKey = config.openData[county] ?? null;
    const queryTableKey = config.queryTable[county] ?? null;

    return {
      county,
      openDataIpnsKey: openDataKey,
      queryTableIpnsKey: queryTableKey,
      openDataGatewayUrl: openDataKey
        ? `https://ipfs.filebase.io/ipns/${openDataKey}`
        : null,
      queryTableGatewayUrl: queryTableKey
        ? `https://ipfs.filebase.io/ipns/${queryTableKey}`
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// DuckDB query over published Parquet
// ---------------------------------------------------------------------------

let httpfsLoaded = false;

/**
 * Ensure httpfs is loaded (once).
 */
async function ensureHttpfs(): Promise<void> {
  if (!httpfsLoaded) {
    await loadHttpfs();
    httpfsLoaded = true;
  }
}

/**
 * Query published Parquet for a county via DuckDB httpfs.
 * The SQL query runs against a view named after the county.
 */
export async function queryProperties(
  config: IpnsMapConfig,
  county: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const ipnsKey = config.queryTable[county];
  if (!ipnsKey) {
    throw new Error(`No query table IPNS key configured for county: ${county}`);
  }

  await ensureHttpfs();

  // Create or replace the view pointing to the published Parquet
  const viewName = `${county}_properties`;
  await createParquetView(viewName, ipnsKey);

  // Replace any reference to the generic table name with the view
  const normalizedSql = sql
    .replace(/\bproperties\b/gi, viewName)
    .replace(/\bquery_table\b/gi, viewName);

  return queryAll(normalizedSql);
}

/**
 * Get a single property by parcel_id from published Parquet.
 */
export async function getPropertyDetail(
  config: IpnsMapConfig,
  county: string,
  parcelId: string,
): Promise<Record<string, unknown> | null> {
  const ipnsKey = config.queryTable[county];
  if (!ipnsKey) {
    throw new Error(`No query table IPNS key configured for county: ${county}`);
  }

  await ensureHttpfs();

  const viewName = `${county}_properties`;
  await createParquetView(viewName, ipnsKey);

  const escapedParcelId = parcelId.replace(/'/g, "''");
  const rows = await queryAll(
    `SELECT * FROM ${viewName} WHERE parcel_id = '${escapedParcelId}' LIMIT 1`,
  );

  return rows[0] ?? null;
}

/**
 * Clean up DuckDB resources.
 */
export function cleanup(): void {
  httpfsLoaded = false;
  closeDb();
}
