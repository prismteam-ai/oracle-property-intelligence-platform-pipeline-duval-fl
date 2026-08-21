/**
 * Lightweight DuckDB wrapper for the MCP workspace.
 * Mirrors pipeline/src/lib/duckdb.ts but scoped to the MCP package.
 */

import duckdb from 'duckdb';

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

let db: duckdb.Database | null = null;
let conn: duckdb.Connection | null = null;

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

export function queryAll<T extends Record<string, unknown> = duckdb.RowData>(
  sql: string,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const c = getConnection();
    c.all(sql, (err: duckdb.DuckDbError | null, rows: duckdb.TableData) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

export function exec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = getConnection();
    c.exec(sql, (err: duckdb.DuckDbError | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// httpfs setup
// ---------------------------------------------------------------------------

export async function loadHttpfs(): Promise<void> {
  await exec('INSTALL httpfs;');
  await exec('LOAD httpfs;');
}

export async function createParquetView(
  viewName: string,
  ipnsKey: string,
  parquetPath: string = 'query-tables/duval/query-table.parquet',
): Promise<void> {
  const url = `https://ipfs.filebase.io/ipns/${ipnsKey}/${parquetPath}`;
  await exec(`CREATE OR REPLACE VIEW ${viewName} AS SELECT * FROM read_parquet('${url}');`);
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
