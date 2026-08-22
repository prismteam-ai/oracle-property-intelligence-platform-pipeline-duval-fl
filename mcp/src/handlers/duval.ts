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
  openData: Record<string, string>;        // county -> IPNS key
  queryTable: Record<string, string>;      // county -> IPNS key
  datasetCoverage: Record<string, string>; // county -> IPNS key
}

/**
 * Parse IPNS maps from environment variables.
 *
 * Supports both original env vars and oracle-convention aliases:
 *   ORACLE_OPEN_DATA_IPNS_MAP      — JSON like {"duval":"<ipns-key>"}
 *   ORACLE_QUERY_TABLE_IPNS_MAP    — JSON like {"duval":"<ipns-key>"}
 *   PROPERTY_QUERY_TABLE_MAP       — oracle-convention alias for query table
 *   DATASET_COVERAGE_MAP           — JSON like {"duval":"<ipns-key>"}
 *
 * If both the original and alias env vars are set, entries are merged
 * (alias values take precedence on conflict).
 */
export function loadIpnsMaps(): IpnsMapConfig {
  const openDataRaw = process.env.ORACLE_OPEN_DATA_IPNS_MAP ?? '{}';
  const queryTableRaw = process.env.ORACLE_QUERY_TABLE_IPNS_MAP ?? '{}';
  const queryTableAliasRaw = process.env.PROPERTY_QUERY_TABLE_MAP ?? '{}';
  const datasetCoverageRaw = process.env.DATASET_COVERAGE_MAP ?? '{}';

  const queryTable = {
    ...(JSON.parse(queryTableRaw) as Record<string, string>),
    ...(JSON.parse(queryTableAliasRaw) as Record<string, string>),
  };

  return {
    openData: JSON.parse(openDataRaw) as Record<string, string>,
    queryTable,
    datasetCoverage: JSON.parse(datasetCoverageRaw) as Record<string, string>,
  };
}

// ---------------------------------------------------------------------------
// County info
// ---------------------------------------------------------------------------

export interface CountyInfo {
  county: string;
  openDataIpnsKey: string | null;
  queryTableIpnsKey: string | null;
  datasetCoverageIpnsKey: string | null;
  openDataGatewayUrl: string | null;
  queryTableGatewayUrl: string | null;
  datasetCoverageGatewayUrl: string | null;
}

/**
 * List all available counties with their IPNS pointers.
 */
export function listCounties(config: IpnsMapConfig): CountyInfo[] {
  const counties = new Set<string>([
    ...Object.keys(config.openData),
    ...Object.keys(config.queryTable),
    ...Object.keys(config.datasetCoverage),
  ]);

  return Array.from(counties).map((county) => {
    const openDataKey = config.openData[county] ?? null;
    const queryTableKey = config.queryTable[county] ?? null;
    const coverageKey = config.datasetCoverage[county] ?? null;

    return {
      county,
      openDataIpnsKey: openDataKey,
      queryTableIpnsKey: queryTableKey,
      datasetCoverageIpnsKey: coverageKey,
      openDataGatewayUrl: openDataKey
        ? `https://ipfs.filebase.io/ipns/${openDataKey}`
        : null,
      queryTableGatewayUrl: queryTableKey
        ? `https://ipfs.filebase.io/ipns/${queryTableKey}`
        : null,
      datasetCoverageGatewayUrl: coverageKey
        ? `https://ipfs.filebase.io/ipns/${coverageKey}`
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
 * Get the dataset-coverage.json for a county from published IPFS data.
 */
export async function getDatasetCoverage(
  config: IpnsMapConfig,
  county: string,
): Promise<Record<string, unknown> | null> {
  const ipnsKey = config.datasetCoverage[county];
  if (!ipnsKey) {
    throw new Error(`No dataset coverage IPNS key configured for county: ${county}`);
  }

  const gatewayUrl = `https://ipfs.filebase.io/ipns/${ipnsKey}`;
  const response = await fetch(gatewayUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch dataset coverage: HTTP ${response.status}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

/**
 * Clean up DuckDB resources.
 */
export function cleanup(): void {
  httpfsLoaded = false;
  closeDb();
}
