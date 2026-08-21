import "server-only";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

/**
 * The read path.
 *
 * This app holds no database. It resolves the published IPNS pointer to a CID
 * once, fetches that immutable artifact once, and queries it with an in-process
 * DuckDB. Every page you see is a SQL query against a Parquet file published on
 * IPFS.
 *
 * Two measurements shaped this. Resolving IPNS per query is unusable: the
 * gateway re-resolves the name on every range request DuckDB issues, which
 * measured **4m14s** for a single count against **1.2s** by CID — so the
 * pointer is resolved once via a HEAD (`x-ipfs-roots`, ~0.5s) and cached. And
 * range-reading the artifact per query still costs on first touch of each
 * column — one page measured **16.5s** — so the 40 MB artifact is fetched once
 * (~4s) and read locally thereafter, at 30-40ms per page.
 */

export const GATEWAY = "https://ipfs.filebase.io";
export const COUNTY = "duval";

/** Stable, published address. Survives every republish of the dataset. */
export const QUERY_TABLE_IPNS =
  process.env["ORACLE_QUERY_TABLE_IPNS"] ??
  "k51qzi5uqu5dkokw1ojybn247mp12gu2x71hiqmt5mul44l5wbud2l3jm37azb";

/** Escape hatch: pin a CID directly if a pointer ever fails to propagate. */
const PINNED_CID = process.env["ORACLE_QUERY_TABLE_CID"] ?? "";

export const PROPERTIES_VIEW = "properties";

export interface DatasetPointer {
  ipnsName: string;
  ipnsUrl: string;
  cid: string;
  cidUrl: string;
  resolvedAt: string;
  resolvedFrom: "ipns" | "pinned-cid";
}

let pointer: DatasetPointer | undefined;
let pointerExpiry = 0;
const POINTER_TTL_MS = 10 * 60_000;

export async function resolvePointer(): Promise<DatasetPointer> {
  if (pointer && Date.now() < pointerExpiry) return pointer;

  if (PINNED_CID) {
    pointer = {
      ipnsName: QUERY_TABLE_IPNS,
      ipnsUrl: `${GATEWAY}/ipns/${QUERY_TABLE_IPNS}`,
      cid: PINNED_CID,
      cidUrl: `${GATEWAY}/ipfs/${PINNED_CID}`,
      resolvedAt: new Date().toISOString(),
      resolvedFrom: "pinned-cid",
    };
    pointerExpiry = Date.now() + POINTER_TTL_MS;
    return pointer;
  }

  const ipnsUrl = `${GATEWAY}/ipns/${QUERY_TABLE_IPNS}`;
  const res = await fetch(ipnsUrl, { method: "HEAD" });
  if (!res.ok) {
    throw new Error(
      `Could not resolve IPNS ${QUERY_TABLE_IPNS}: ${res.status}`,
    );
  }
  const cid =
    res.headers.get("x-ipfs-roots")?.split(",")[0]?.trim() ??
    res.headers.get("etag")?.replace(/"/g, "").trim();
  if (!cid) {
    throw new Error(`Gateway returned no x-ipfs-roots for ${QUERY_TABLE_IPNS}`);
  }

  pointer = {
    ipnsName: QUERY_TABLE_IPNS,
    ipnsUrl,
    cid,
    cidUrl: `${GATEWAY}/ipfs/${cid}`,
    resolvedAt: new Date().toISOString(),
    resolvedFrom: "ipns",
  };
  pointerExpiry = Date.now() + POINTER_TTL_MS;
  return pointer;
}

let connection: DuckDBConnection | undefined;
let connectedCid: string | undefined;
let connecting:
  Promise<{ conn: DuckDBConnection; ptr: DatasetPointer }> | undefined;

/**
 * Fetch the published artifact once, to a local file.
 *
 * Range-reading the Parquet straight off the gateway works, but the first query
 * to touch a new column pays for that column's chunks over the network — one
 * page measured 16.5s. Pulling the whole 40 MB artifact takes about 4 seconds
 * once, after which every query is local and sub-second.
 *
 * This does not reintroduce a database. The file is a disposable copy of an
 * immutable, content-addressed artifact, keyed by CID: it is exactly the
 * "every consumer runs their own copy, pointed at the same data" model the
 * Elephant MCP is built around. Delete the container and the next one fetches
 * it again from IPFS.
 */
async function materialise(ptr: {
  cid: string;
  cidUrl: string;
}): Promise<string> {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");

  const dir = path.join(os.tmpdir(), "duval-oracle");
  fs.mkdirSync(dir, { recursive: true });
  // Keyed by CID, so a republished dataset lands beside the old one rather than
  // being silently served from a stale cache.
  const file = path.join(dir, `${ptr.cid}.parquet`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;

  const res = await fetch(ptr.cidUrl);
  if (!res.ok) {
    throw new Error(`Could not fetch ${ptr.cidUrl}: HTTP ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.subarray(0, 4).toString("ascii") !== "PAR1") {
    throw new Error(
      `Artifact at ${ptr.cidUrl} is not a Parquet file (missing PAR1 header).`,
    );
  }
  // Write via a temp name so a torn download can never be picked up as complete.
  const tmp = `${file}.partial`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
  return file;
}

/**
 * A long-lived connection with the `properties` view already defined.
 *
 * The view name matches the Elephant contract, so the SQL shown on every answer
 * page is the same SQL an `elephant-mcp` consumer would write.
 */
async function connect(): Promise<{
  conn: DuckDBConnection;
  ptr: DatasetPointer;
}> {
  const ptr = await resolvePointer();
  if (connection && connectedCid === ptr.cid) return { conn: connection, ptr };
  // Concurrent first requests must not each download 40 MB.
  if (connecting) return connecting;

  connecting = (async () => {
    const file = await materialise(ptr);
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    await conn.run(
      `CREATE OR REPLACE VIEW ${PROPERTIES_VIEW} AS SELECT * FROM read_parquet('${file.replace(/'/g, "''")}')`,
    );
    // Close the connection the previous CID was served from, rather than
    // dropping the reference and leaking the instance.
    const previous = connection;
    connection = conn;
    connectedCid = ptr.cid;
    if (previous) {
      try {
        previous.closeSync();
      } catch {
        // Already closed or mid-query; nothing useful to do.
      }
    }
    return { conn, ptr };
  })();

  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
}

/** Pull the dataset ahead of the first request so no page pays for the fetch. */
export async function warmUp(): Promise<DatasetPointer> {
  const { ptr } = await connect();
  return ptr;
}

/** BigInt is not JSON-serialisable and React cannot render it. */
function normalise(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        normalise(v),
      ]),
    );
  }
  return value;
}

export interface QueryResult<T> {
  rows: T[];
  sql: string;
  durationMs: number;
  pointer: DatasetPointer;
}

/** Cheap first pass. Real enforcement is the AST check below. */
const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|COPY|ATTACH|INSTALL|LOAD|PRAGMA|CALL|SET|EXPORT)\b/i;

export const MAX_ROWS = 1000;

/** Names a query may read from, beyond any CTE it defines itself. */
const ALLOWED_TABLES = new Set([PROPERTIES_VIEW]);

interface AstScan {
  tableFunctions: Set<string>;
  baseTables: Set<string>;
  cteNames: Set<string>;
}

function scanAst(node: unknown, out: AstScan): AstScan {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const v of node) scanAst(v, out);
    return out;
  }
  const rec = node as Record<string, unknown>;

  // Table functions are how DuckDB reads the filesystem and the network:
  // read_text, read_csv, read_parquet, glob, and friends. A query over the
  // published dataset never needs one.
  if (rec["type"] === "TABLE_FUNCTION") {
    const fn = (rec["function"] as Record<string, unknown> | undefined)?.[
      "function_name"
    ];
    out.tableFunctions.add(String(fn ?? "unknown"));
  }
  if (rec["type"] === "BASE_TABLE") {
    out.baseTables.add(String(rec["table_name"] ?? "").toLowerCase());
  }
  // CTE names appear as BASE_TABLE references, so collect their definitions.
  const cteMap = rec["cte_map"] as Record<string, unknown> | undefined;
  if (cteMap && Array.isArray(cteMap["map"])) {
    for (const entry of cteMap["map"] as Array<Record<string, unknown>>) {
      if (entry?.["key"]) out.cteNames.add(String(entry["key"]).toLowerCase());
    }
  }

  for (const v of Object.values(rec)) scanAst(v, out);
  return out;
}

/**
 * Validate a statement by parsing it, not by pattern-matching it.
 *
 * A keyword blocklist cannot make this endpoint safe. DuckDB reaches the
 * filesystem through ordinary table functions — `SELECT * FROM
 * read_text('/proc/self/environ')` is a plain SELECT containing no forbidden
 * keyword, and on a public endpoint that is arbitrary file read and secret
 * exfiltration. So the statement is parsed with `json_serialize_sql` and
 * rejected unless every table reference is the published view or a CTE the
 * query defines itself, and no table function appears anywhere in the tree —
 * including inside UNION branches and scalar subqueries, which a regex over the
 * statement text will not see.
 */
export async function assertReadOnly(
  conn: DuckDBConnection,
  sql: string,
): Promise<void> {
  const reader = await conn.runAndReadAll(
    `SELECT json_serialize_sql('${sql.replace(/'/g, "''")}') AS ast`,
  );
  const raw = reader.getRowObjects()[0]?.["ast"];
  if (!raw) throw new Error("Could not parse the statement.");

  const ast = JSON.parse(String(raw)) as Record<string, unknown>;
  if (ast["error"]) {
    throw new Error(
      `Could not parse the statement: ${String(ast["error_message"] ?? "unknown")}`,
    );
  }

  const found = scanAst(ast, {
    tableFunctions: new Set(),
    baseTables: new Set(),
    cteNames: new Set(),
  });

  if (found.tableFunctions.size > 0) {
    throw new Error(
      `Table functions are not permitted: ${[...found.tableFunctions].join(", ")}. ` +
        `Query the "${PROPERTIES_VIEW}" view directly.`,
    );
  }
  for (const table of found.baseTables) {
    if (!ALLOWED_TABLES.has(table) && !found.cteNames.has(table)) {
      throw new Error(
        `Unknown table "${table}". Only the "${PROPERTIES_VIEW}" view is available.`,
      );
    }
  }
}

/**
 * Run one read-only SELECT against the published dataset.
 *
 * Both the agent and the public MCP endpoint pass model-authored SQL through
 * here, so this is the trust boundary: a single statement, SELECT or a leading
 * CTE, validated against its own parse tree, and wrapped in an outer LIMIT that
 * the caller cannot raise.
 */
export async function runQuery<T = Record<string, unknown>>(
  sql: string,
  opts: { limit?: number } = {},
): Promise<QueryResult<T>> {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.includes(";")) {
    throw new Error("Only a single statement is allowed.");
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    throw new Error("Only SELECT (or a leading WITH) is allowed.");
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("Only read-only queries are allowed.");
  }

  const started = Date.now();
  const { conn, ptr } = await connect();
  await assertReadOnly(conn, trimmed);

  // Wrapped rather than appended. Appending only when the statement lacks a
  // trailing LIMIT lets a caller supply `LIMIT 400000` and read the whole
  // table, which exhausts the container's heap while materialising rows.
  const limit = Math.max(1, Math.min(opts.limit ?? 100, MAX_ROWS));
  const capped = `SELECT * FROM (${trimmed}) LIMIT ${limit}`;

  const reader = await conn.runAndReadAll(capped);
  return {
    rows: normalise(reader.getRowObjects()) as T[],
    sql: trimmed,
    durationMs: Date.now() - started,
    pointer: ptr,
  };
}

/** Column names and types, straight from the published Parquet. */
export async function schema(): Promise<Array<{ name: string; type: string }>> {
  const { conn } = await connect();
  const reader = await conn.runAndReadAll(
    `DESCRIBE SELECT * FROM ${PROPERTIES_VIEW}`,
  );
  return reader.getRowObjects().map((r) => ({
    name: String(r["column_name"]),
    type: String(r["column_type"]),
  }));
}

/**
 * Published run history, read from IPFS rather than from a database.
 *
 * The pipeline publishes this artifact after each run finishes, so the history
 * the UI shows is the same immutable document any other consumer would read.
 */
export interface PublishedRun {
  run_id: string;
  mode: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  sources_attempted: number;
  sources_succeeded: number;
  sources_skipped_unchanged: number;
  records_in: number;
  inserts: number;
  updates: number;
  deletes: number;
  unchanged: number;
  limitations: string | null;
  artifacts: string | null;
}

export interface PublishedStep {
  run_id: string;
  step_key: string;
  seq: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  detail: string | null;
  error: string | null;
}

export interface RunHistory {
  county: string;
  generatedAt: string;
  runs: PublishedRun[];
  steps: PublishedStep[];
  sourceUrl: string;
}

/**
 * The published run-history artifact.
 *
 * Only the query table gets an IPNS name (the Filebase plan allows exactly one),
 * so the run history is addressed by CID and the value moves on every publish.
 * The default below is the CID of the most recent published run history; the
 * publish step prints the new value to set after each run. Defaulting it — rather
 * than leaving it empty — means the run-history pages work out of the box instead
 * of shipping dead.
 */
const RUN_HISTORY_CID =
  process.env["ORACLE_RUN_HISTORY_CID"] ??
  "QmWnaXoNtJ7MvTkja9sFujEq9hvzVqLWhp14rQteFnhojQ";

export async function runHistory(): Promise<RunHistory | undefined> {
  if (!RUN_HISTORY_CID) return undefined;
  const sourceUrl = `${GATEWAY}/ipfs/${RUN_HISTORY_CID}`;
  const res = await fetch(sourceUrl, { next: { revalidate: 60 } });
  if (!res.ok) return undefined;
  const body = (await res.json()) as Omit<RunHistory, "sourceUrl">;
  return { ...body, sourceUrl };
}

export interface ChangeMatch {
  runId: string;
  changedInRun: number;
  matched: number;
  rows: Array<Record<string, unknown>>;
  changesCid: string;
  changesUrl: string;
  durationMs: number;
}

/**
 * Which properties changed in a given run, and which of those match a criteria
 * set.
 *
 * This exists so a downstream consumer — the acquisition CRM — can be notified
 * about a *specific record change in a specific run* without ever touching
 * IPFS itself. It resolves the run's immutable changes artifact from the
 * published run history, joins it to the query table, and applies the caller's
 * predicate.
 *
 * The caller supplies a boolean expression over `properties`, never a table
 * name or a table function. That fragment is validated by parsing it in
 * isolation — `SELECT 1 FROM properties WHERE (<expr>)` — through the same AST
 * check that guards the public query path, so it cannot reach the filesystem,
 * the network, or any table other than the published view. The `read_parquet`
 * call against the changes artifact is constructed here from a CID that came
 * out of the run history, not from anything the caller sent.
 */
export async function matchChangedProperties(opts: {
  runId: string;
  where?: string;
  deltaTypes?: string[];
  columns?: string[];
  limit?: number;
}): Promise<ChangeMatch> {
  const history = await runHistory();
  const run = history?.runs.find((r) => r.run_id === opts.runId);
  if (!run)
    throw new Error(`Run ${opts.runId} is not in the published history.`);

  const artifacts = parseJsonColumn<
    Record<string, { cid?: string; cidUrl?: string }>
  >(run.artifacts, {});
  const cid = artifacts["changes"]?.cid;
  if (!cid) {
    throw new Error(
      `Run ${opts.runId} published no changes artifact, so its record-level changes cannot be replayed. ` +
        `Runs from before change publication was added carry only their aggregate counts.`,
    );
  }
  const changesUrl = `${GATEWAY}/ipfs/${cid}`;

  const started = Date.now();
  const { conn } = await connect();

  // Same reason the query table is pulled locally: range-reading a Parquet
  // through the IPFS gateway costs 100 s for this join, against under a second
  // once the (small) artifact is on local disk. It is immutable and addressed
  // by CID, so caching it is free of staleness risk.
  const changesFile = await materialise({ cid, cidUrl: changesUrl });
  const changesRef = `read_parquet('${changesFile.replace(/'/g, "''")}')`;

  const where = opts.where?.trim();
  if (where)
    await assertReadOnly(conn, `SELECT 1 FROM properties WHERE (${where})`);

  const types = (opts.deltaTypes ?? ["insert", "update"])
    .filter((t) => ["insert", "update", "delete"].includes(t))
    .map((t) => `'${t}'`)
    .join(", ");
  if (!types) throw new Error("No valid delta type requested.");

  // Only changes keyed by folio are addressable as properties. `parcels`
  // carries roll changes (ownership, value, sale); `parcel_points` carries
  // geometry changes, which matter to an acquisition team because a parcel
  // appearing in a newer vintage is usually a split, a new plat or new
  // construction. A change to a place or a water body is real too, but it has
  // no folio, so there is nobody to notify about it.
  const changed = `
    SELECT record_key, min(delta_type) AS delta_type
      FROM ${changesRef}
     WHERE table_name IN ('parcels', 'parcel_points')
       AND delta_type IN (${types})
     GROUP BY record_key`;

  const cols = (
    opts.columns?.length
      ? opts.columns.filter((c) => /^[a-z_][a-z0-9_]*$/i.test(c))
      : [
          "request_identifier",
          "address_street",
          "address_city",
          "owner_name",
          "market_value",
          "latitude",
          "longitude",
        ]
  )
    .map((c) => `p.${c}`)
    .join(", ");

  const limit = Math.max(1, Math.min(opts.limit ?? 50, MAX_ROWS));
  const [counts] = (
    await conn.runAndReadAll(`
      WITH changed AS (${changed})
      SELECT (SELECT count(*) FROM changed)                                AS changed_in_run,
             (SELECT count(*) FROM changed c
                JOIN ${PROPERTIES_VIEW} p ON p.request_identifier = c.record_key
               ${where ? `WHERE (${where})` : ""})                          AS matched
    `)
  ).getRowObjects();

  const rows = (
    await conn.runAndReadAll(`
      WITH changed AS (${changed})
      SELECT ${cols}, c.delta_type
        FROM changed c
        JOIN ${PROPERTIES_VIEW} p ON p.request_identifier = c.record_key
       ${where ? `WHERE (${where})` : ""}
       ORDER BY p.market_value DESC NULLS LAST
       LIMIT ${limit}
    `)
  ).getRowObjects();

  return {
    runId: opts.runId,
    changedInRun: Number(counts?.["changed_in_run"] ?? 0),
    matched: Number(counts?.["matched"] ?? 0),
    rows: normalise(rows) as Array<Record<string, unknown>>,
    changesCid: cid,
    changesUrl,
    durationMs: Date.now() - started,
  };
}

export function parseJsonColumn<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
