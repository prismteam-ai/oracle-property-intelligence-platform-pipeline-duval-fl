/**
 * Server-only Neon (Postgres) pool for the agent's data core. DATABASE_URL is read from the
 * environment (populated by the API from Secrets Manager, or from a local .env). Never logged,
 * never sent to a client.
 */
import { Pool, types, type QueryResultRow } from "pg";

// Return DATE columns as raw ISO strings ("1995-11-27") instead of JS Date objects, so downstream
// formatting is a clean YYYY-MM-DD rather than a locale string.
types.setTypeParser(1082, (v) => v);

let pool: Pool | null = null;

function getPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (server-only).");
  pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query<T>(sql, params);
  return res.rows;
}
