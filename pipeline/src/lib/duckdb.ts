/**
 * DuckDB in-process setup with httpfs for querying published Parquet.
 * T016 — DuckDB wrapper with typed query helpers.
 */

import duckdb from 'duckdb';

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let db: duckdb.Database | null = null;
let conn: duckdb.Connection | null = null;

/**
 * Get or create the DuckDB in-memory instance with httpfs loaded.
 */
export function getDb(): duckdb.Database {
  if (!db) {
    db = new duckdb.Database(':memory:');
  }
  return db;
}

export function getConnection(): duckdb.Connection {
  if (!conn) {
    conn = getDb().connect();
  }
  return conn;
}

// ---------------------------------------------------------------------------
// Promisified query helpers
// ---------------------------------------------------------------------------

/**
 * Execute a query and return all rows.
 */
export function queryAll<T extends Record<string, unknown> = duckdb.RowData>(
  sql: string,
  _params?: unknown[],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const c = getConnection();
    const cb = (err: duckdb.DuckDbError | null, rows: duckdb.TableData) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    };
    c.all(sql, cb);
  });
}

/**
 * Execute a statement (INSERT, CREATE, etc.) without returning rows.
 */
export function exec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = getConnection();
    c.exec(sql, (err: duckdb.DuckDbError | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Execute a query and return the first row, or null.
 */
export async function queryOne<T extends Record<string, unknown> = duckdb.RowData>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await queryAll<T>(sql, params);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// httpfs setup
// ---------------------------------------------------------------------------

/**
 * Load the httpfs extension and configure it for reading from IPFS gateways.
 * Call once after initialization.
 */
export async function loadHttpfs(): Promise<void> {
  await exec('INSTALL httpfs;');
  await exec('LOAD httpfs;');
}

/**
 * Create a view over a published Parquet file on IPFS via IPNS.
 */
export async function createParquetView(
  viewName: string,
  ipnsKey: string,
  parquetPath: string = 'query-tables/duval/query-table.parquet',
): Promise<void> {
  const url = `https://ipfs.filebase.io/ipns/${ipnsKey}/${parquetPath}`;
  await exec(`CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM read_parquet('${url}');`);
}

/**
 * Create a view over a local Parquet file.
 */
export async function createLocalParquetView(
  viewName: string,
  filePath: string,
): Promise<void> {
  await exec(`CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM read_parquet('${filePath}');`);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function closeDb(): void {
  if (conn) {
    conn.close();
    conn = null;
  }
  if (db) {
    db.close();
    db = null;
  }
}
