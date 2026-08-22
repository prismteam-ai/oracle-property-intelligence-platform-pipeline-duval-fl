/**
 * Postgres connection pool and typed query helpers.
 * T011 — Foundational database layer.
 */

import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Connection pool
// ---------------------------------------------------------------------------

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/oracle_pipeline';
    pool = new Pool({ connectionString, max: 20, idleTimeoutMillis: 30_000 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// ---------------------------------------------------------------------------
// Typed query helpers
// ---------------------------------------------------------------------------

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  const p = getPool();
  const result = await p.query<T>(sql, params);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const { rows } = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const p = getPool();
  const result = await p.query(sql, params);
  return result.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

export interface MigrationRecord {
  filename: string;
  applied_at: Date;
}

/**
 * Run all SQL migrations in `pipeline/src/migrations/` that haven't been applied yet.
 * Uses a `schema_migrations` tracking table.
 */
export async function runMigrations(): Promise<string[]> {
  const p = getPool();

  // Ensure tracking table exists
  await p.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Read already-applied migrations
  const { rows: applied } = await p.query<MigrationRecord>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  // Discover migration files
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    files = [];
  }

  const ran: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      console.info(`[migration] applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migration] failed: ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  if (ran.length === 0) {
    console.info('[migration] all migrations up to date');
  }

  return ran;
}
