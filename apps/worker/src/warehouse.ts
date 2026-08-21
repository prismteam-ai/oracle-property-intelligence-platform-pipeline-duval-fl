import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { DATA_DIR, DB_PATH } from "./config.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

let instance: DuckDBInstance | undefined;
let connection: DuckDBConnection | undefined;

/**
 * Single shared connection. DuckDB is single-writer, which is exactly why the
 * worker runs at one replica with no autoscale — concurrent writers would
 * corrupt the file rather than queue.
 */
export async function db(): Promise<DuckDBConnection> {
  if (connection) return connection;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  instance = await DuckDBInstance.create(DB_PATH);
  connection = await instance.connect();
  await connection.run("INSTALL httpfs; LOAD httpfs;").catch(() => {
    // httpfs ships with most builds; a failure here only matters for the
    // Overture step, which reports it explicitly rather than dying at startup.
  });
  await connection.run("INSTALL spatial; LOAD spatial;").catch(() => {});
  return connection;
}

/**
 * Execute a .sql file one statement at a time — DuckDB's client runs a single
 * statement per call.
 *
 * Chunks routinely begin with comment lines, so a chunk is kept when it contains
 * any non-comment line. Testing only the first character would silently discard
 * the statement that follows a comment block.
 *
 * `substitutions` replaces `${TOKEN}` placeholders so thresholds defined in
 * config.ts are the single source of truth rather than being restated as magic
 * numbers in SQL.
 */
export async function runSqlFile(
  fileName: string,
  substitutions: Record<string, string | number> = {},
): Promise<void> {
  const conn = await db();
  let sql = fs.readFileSync(path.join(HERE, fileName), "utf8");
  for (const [token, value] of Object.entries(substitutions)) {
    sql = sql.replaceAll(`\${${token}}`, String(value));
  }
  const remaining = sql.match(/\$\{[A-Z_]+\}/g);
  if (remaining) {
    throw new Error(
      `${fileName} has unsubstituted placeholders: ${[...new Set(remaining)].join(", ")}`,
    );
  }
  const statements = sql
    .split(/;\s*$/m)
    .map((chunk) => chunk.trim())
    .filter((chunk) =>
      chunk
        .split("\n")
        .some((line) => line.trim() && !line.trim().startsWith("--")),
    );
  for (const stmt of statements) {
    await conn.run(stmt);
  }
}

export async function migrate(): Promise<void> {
  await runSqlFile("schema.sql");
}

/** Run a query and return plain JS objects. */
export async function query<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const conn = await db();
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects() as T[];
}

/** Run a statement for its effect. */
export async function exec(sql: string): Promise<void> {
  const conn = await db();
  await conn.run(sql);
}

/** Scalar helper for counts and single-value probes. */
export async function scalar<T = number>(sql: string): Promise<T> {
  const rows = await query<Record<string, T>>(sql);
  const first = rows[0];
  if (!first) throw new Error(`Query returned no rows: ${sql}`);
  return Object.values(first)[0] as T;
}

/** SQL string literal escaping for the few places we interpolate values. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function close(): Promise<void> {
  connection?.closeSync();
  instance?.closeSync();
  connection = undefined;
  instance = undefined;
}
