/**
 * DuckDB query layer. Runs SQL over a flat, one-row-per-property query-table Parquet — the same
 * shape the kit's `county-query-table-publish` produces and the elephant MCP's embedded DuckDB
 * range-reads off IPFS. This is the demonstrable structured layer (README "DuckDB + IPFS").
 *
 * The Parquet is NON-PII (folio, public situs, derived facts — no owner names/mailing), so it can
 * ship with the deploy and be read locally, in the Lambda, and by Cursor. Native binary loading is
 * guarded: if `@duckdb/node-api` cannot initialise in the runtime, callers fall back to Postgres.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Bundled Parquet path (repo: apps/agent/data/…; Lambda: alongside the handler). */
export const PARQUET_CANDIDATES = [
  join(HERE, "..", "..", "data", "duval-query-table.parquet"), // local: apps/agent/data
  join(HERE, "data", "duval-query-table.parquet"), // bundled Lambda: /var/task/data
  join(process.cwd(), "data", "duval-query-table.parquet"), // Lambda cwd fallback
];

export function parquetPath(): string | null {
  return PARQUET_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/** DuckDB returns counts as BigInt and dates as objects — normalise to JSON-serialisable values. */
function jsonSafeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") out[k] = Number(v);
    else if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
    else out[k] = v;
  }
  return out;
}

let instancePromise: Promise<{ run: (sql: string) => Promise<Record<string, unknown>[]> } | null> | null = null;

async function getEngine() {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    try {
      const mod = (await import("@duckdb/node-api")) as typeof import("@duckdb/node-api");
      const instance = await mod.DuckDBInstance.create(":memory:");
      const conn = await instance.connect();
      const pq = parquetPath();
      if (pq) {
        await conn.run(`create or replace view properties as select * from read_parquet('${pq.replace(/'/g, "''")}')`);
      }
      return {
        run: async (sql: string) => {
          const reader = await conn.runAndReadAll(sql);
          return (reader.getRowObjects() as Record<string, unknown>[]).map(jsonSafeRow);
        },
      };
    } catch (err) {
      // Native binary unavailable in this runtime — signal fallback.
      console.warn(JSON.stringify({ level: "warn", msg: "duckdb unavailable, falling back to postgres", err: (err as Error).message }));
      return null;
    }
  })();
  return instancePromise;
}

export async function duckdbAvailable(): Promise<boolean> {
  return (await getEngine()) !== null && parquetPath() !== null;
}

const READONLY = /^\s*(select|with|pragma|describe|summarize|explain)\b/i;

/** Run a read-only SQL statement over the DuckDB query-table view `properties`. */
export async function duckdbQuery(sql: string): Promise<{ engine: "duckdb"; rows: Record<string, unknown>[] }> {
  if (!READONLY.test(sql)) throw new Error("Only read-only queries (SELECT/WITH/PRAGMA/DESCRIBE) are allowed.");
  if (/;\s*\S/.test(sql.trim().replace(/;\s*$/, ""))) throw new Error("Single-statement queries only.");
  const engine = await getEngine();
  if (!engine) throw new Error("DuckDB engine is not available in this runtime.");
  const rows = await engine.run(sql);
  return { engine: "duckdb", rows };
}
