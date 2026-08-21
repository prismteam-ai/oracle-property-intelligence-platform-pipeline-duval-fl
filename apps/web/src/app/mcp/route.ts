import {
  COUNTY,
  MAX_ROWS,
  PROPERTIES_VIEW,
  matchChangedProperties,
  resolvePointer,
  runQuery,
  runHistory,
  schema,
} from "@/lib/oracle";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import {
  QUESTIONS,
  buildCountSql,
  buildSql,
  questionBySlug,
} from "@/lib/questions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Model Context Protocol endpoint over Streamable HTTP.
 *
 * Implements the tool surface `elephant-mcp` exposes for a published county —
 * `getPropertyQuerySchema` and `queryProperties` against a view named
 * `properties` — plus Duval-specific tools for the six required questions and
 * the pipeline's run history.
 *
 * This is the access boundary. The downstream CRM consumes Duval data only
 * through this endpoint; it holds no copy of the dataset and cannot reach IPFS
 * directly. Everything here is read-only: a single SELECT, capped rows, and no
 * statement that can mutate or touch the filesystem.
 */

const PROTOCOL_VERSION = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function ok(id: string | number | null | undefined, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function fail(
  id: string | number | null | undefined,
  code: number,
  message: string,
) {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

/** Clamp a caller-supplied row limit. Callers are untrusted: an unbounded
 *  value materialises the whole table and exhausts the container's heap. */
function clampLimit(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_ROWS);
}

/** MCP tool results are content blocks; JSON travels as text. */
function content(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const TOOLS = [
  {
    name: "getPropertyQuerySchema",
    description:
      "List the columns of the Duval property query table, with types and descriptions. Call this before writing SQL.",
    inputSchema: {
      type: "object",
      properties: {
        county: {
          type: "string",
          description: "County slug; only 'duval' is served here.",
        },
      },
    },
  },
  {
    name: "queryProperties",
    description:
      "Run one read-only SELECT (a leading WITH is allowed) against the `properties` view of the Duval query table. Rows are capped.",
    inputSchema: {
      type: "object",
      properties: {
        county: { type: "string" },
        sql: {
          type: "string",
          description: "A single read-only SELECT statement.",
        },
        limit: {
          type: "number",
          description: "Row cap, default 100, max 1000.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "listStandardQuestions",
    description:
      "List the six standard Duval property-intelligence questions, each with the evidence its answer rests on and the limits of that evidence.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "answerStandardQuestion",
    description:
      "Answer one standard question using its vetted SQL. Returns matching rows, the total match count, the derivation basis and the caveat.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          enum: QUESTIONS.map((q) => q.slug),
        },
        params: {
          type: "object",
          description:
            "Optional thresholds, e.g. { min: '25' } for roof age, { max: '400' } for distance in metres.",
          additionalProperties: { type: "string" },
        },
        limit: { type: "number" },
      },
      required: ["slug"],
    },
  },
  {
    name: "getDatasetInfo",
    description:
      "Report which county is served, the published IPNS pointer, the CID it currently resolves to, and record counts.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "matchChangedProperties",
    description:
      "Given a pipeline run id, return the properties that changed in that run and which of them match a criteria expression. This is how a downstream system reacts to a specific record change in a specific run without reading IPFS itself.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "A run id from listPipelineRuns.",
        },
        where: {
          type: "string",
          description:
            "Optional SQL boolean expression over the properties view, e.g. \"roof_age_years > 15 AND address_city = 'JACKSONVILLE'\". Table names and table functions are rejected.",
        },
        delta_types: {
          type: "array",
          items: { type: "string", enum: ["insert", "update", "delete"] },
          description: "Defaults to insert and update.",
        },
        limit: { type: "number" },
      },
      required: ["run_id"],
    },
  },
  {
    name: "listPipelineRuns",
    description:
      "List the pipeline's published run history: per-run insert/update/delete counts, timings, and recorded limitations.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
] as const;

async function callTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "getPropertyQuerySchema": {
      const columns = await schema();
      const pointer = await resolvePointer();
      return content({
        county: COUNTY,
        view: PROPERTIES_VIEW,
        columnCount: columns.length,
        columns,
        source: { ipns: pointer.ipnsName, cid: pointer.cid },
        nullabilityNote:
          "Permits, contractors, Sunbiz tenancy, BBB reputation, exterior wall material, roof covering material and hoa_flag are not ingested for Duval and are NULL. NULL means not collected, not absent.",
        safetyNote:
          "Read-only: one SELECT (a leading WITH is allowed). Mutating or filesystem statements are rejected. Rows are capped at 1000.",
      });
    }

    case "queryProperties": {
      const sql = String(args["sql"] ?? "");
      const limit = clampLimit(args["limit"], 100);
      const result = await runQuery(sql, { limit });
      return content({
        county: COUNTY,
        sql: result.sql,
        rowCount: result.rows.length,
        durationMs: result.durationMs,
        rows: result.rows,
        provenance: {
          source_system: "duval_appraiser",
          ipns_name: result.pointer.ipnsName,
          query_table_cid: result.pointer.cid,
          retrieved_at: new Date().toISOString(),
        },
      });
    }

    case "listStandardQuestions":
      return content({
        county: COUNTY,
        questions: QUESTIONS.map((q) => ({
          slug: q.slug,
          title: q.title,
          prompt: q.prompt,
          basis: q.basis,
          caveat: q.caveat,
          params: q.params ?? [],
        })),
      });

    case "answerStandardQuestion": {
      const slug = String(args["slug"] ?? "");
      const question = questionBySlug(slug);
      if (!question) throw new Error(`Unknown question slug: ${slug}`);
      const params = (args["params"] as Record<string, string>) ?? {};
      const limit = clampLimit(args["limit"], 25);
      const listSql = buildSql(question, params, limit);
      const [list, count] = await Promise.all([
        runQuery(listSql, { limit }),
        runQuery<{ matches: number }>(buildCountSql(question, params)),
      ]);
      return content({
        question: question.title,
        matches: Number(count.rows[0]?.matches ?? 0),
        sql: listSql,
        rows: list.rows,
        basis: question.basis,
        caveat: question.caveat,
        provenance: {
          ipns_name: list.pointer.ipnsName,
          query_table_cid: list.pointer.cid,
          retrieved_at: new Date().toISOString(),
        },
      });
    }

    case "getDatasetInfo": {
      const pointer = await resolvePointer();
      const totals = await runQuery<Record<string, number>>(`
        SELECT count(*) AS properties,
               count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coordinates,
               count(DISTINCT owner_name) AS distinct_owners
        FROM ${PROPERTIES_VIEW}
      `);
      return content({
        county: COUNTY,
        countyName: "Duval",
        stateCode: "FL",
        view: PROPERTIES_VIEW,
        pointer,
        propertyQueryTableMap: {
          [COUNTY]: pointer.ipnsUrl,
        },
        totals: totals.rows[0],
        infrastructure:
          "Served from a Parquet artifact on IPFS via DuckDB. No hosted database is involved; any consumer can point their own MCP at the same address.",
      });
    }

    case "matchChangedProperties": {
      const runId = String(args["run_id"] ?? "");
      if (!runId) throw new Error("run_id is required.");
      const match = await matchChangedProperties({
        runId,
        where: args["where"] ? String(args["where"]) : undefined,
        deltaTypes: Array.isArray(args["delta_types"])
          ? (args["delta_types"] as string[])
          : undefined,
        limit: clampLimit(args["limit"], 50),
      });
      return content({
        ...match,
        provenance: {
          source_system: "duval-oracle-pipeline",
          pipeline_run_id: match.runId,
          changes_artifact_cid: match.changesCid,
          changes_artifact_uri: match.changesUrl,
          retrieved_at: new Date().toISOString(),
        },
        note: "changedInRun counts distinct folios whose roll record or parcel geometry changed in this run; matched counts how many of those also satisfy the criteria expression. A geometry change usually means a split, a new plat or new construction.",
      });
    }

    case "listPipelineRuns": {
      const history = await runHistory();
      if (!history) throw new Error("Run history artifact is unavailable.");
      const limit = clampLimit(args["limit"], 20);
      return content({
        county: COUNTY,
        generatedAt: history.generatedAt,
        sourceUrl: history.sourceUrl,
        runs: history.runs.slice(0, limit),
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function POST(request: Request): Promise<Response> {
  const limit = rateLimit(clientKey(request.headers, "mcp"), {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Rate limit exceeded." },
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(limit.retryAfterSeconds),
        },
      },
    );
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return fail(null, -32700, "Parse error");
  }

  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "duval-oracle-mcp",
          version: "0.1.0",
          title: "Duval County Property Intelligence",
        },
        instructions:
          "Duval County, Florida property intelligence, served from a Parquet artifact on IPFS. Call getPropertyQuerySchema before writing SQL. Prefer answerStandardQuestion for the six standard questions — it returns the derivation basis and caveat alongside the rows.",
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const name = String(params?.["name"] ?? "");
      const args = (params?.["arguments"] as Record<string, unknown>) ?? {};
      try {
        return ok(id, await callTool(name, args));
      } catch (error) {
        // Tool failures are results, not protocol errors — the caller (often a
        // model) can read the message and correct its request.
        return ok(id, {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    }

    case "ping":
      return ok(id, {});

    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Discovery aid: GET describes the endpoint rather than 405-ing. */
export async function GET(): Promise<Response> {
  return Response.json({
    name: "duval-oracle-mcp",
    protocol: "Model Context Protocol over Streamable HTTP",
    protocolVersion: PROTOCOL_VERSION,
    transport: "POST JSON-RPC 2.0 to this URL",
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    example: {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    },
  });
}
