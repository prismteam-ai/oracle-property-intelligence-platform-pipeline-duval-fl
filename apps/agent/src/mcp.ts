/**
 * MCP server (stdio) exposing the Oracle Duval agent to Cursor and any MCP client. It surfaces the
 * same data + reasoning core the hosted UI/API use, so an engineer can ask the six inquiry
 * workflows, run structured DuckDB SQL, or retrieve source-backed records directly from the editor.
 *
 * Run (Cursor launches this): the process reads DATABASE_URL / OPENSEARCH_* from the environment and
 * uses the ambient AWS credentials (profile/role) for Bedrock. See apps/agent/mcp.json.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ask } from "./agent.ts";
import { runWorkflow, recordsBySource } from "./queries.ts";
import { retrieve } from "./tools/retrieval.ts";
import { duckdbQuery } from "./tools/duckdb.ts";

const WORKFLOW_IDS = [
  "roof_age",
  "water_view",
  "ownership_age",
  "regional_owner",
  "walking_distance",
  "records_by_source",
] as const;

export function buildServer(): McpServer {
  const server = new McpServer({ name: "oracle-duval-agent", version: "0.1.0" });

  server.tool(
    "ask_oracle",
    "Ask a natural-language question about reconciled Duval County property records. Returns a " +
      "source-backed answer (hybrid retrieval + SQL/DuckDB) with citations. Handles the six inquiry " +
      "workflows: roof age, water view, ownership age, regional owners, walking distance, records by source.",
    { question: z.string().min(3).max(500) },
    async ({ question }) => {
      const a = await ask(question);
      return { content: [{ type: "text", text: JSON.stringify(a, null, 2) }] };
    },
  );

  server.tool(
    "run_workflow",
    "Run one of the six inquiry workflows deterministically over Neon and return the matching " +
      "parcels with coverage + provenance.",
    { id: z.enum(WORKFLOW_IDS), limit: z.number().int().min(1).max(200).default(25) },
    async ({ id, limit }) => {
      const data = id === "records_by_source" ? await recordsBySource() : await runWorkflow(id, limit);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.tool(
    "duckdb_query",
    "Run read-only DuckDB SQL over the flat one-row-per-property query table (view: properties) — " +
      "the same shape the elephant MCP's embedded DuckDB reads off IPFS.",
    { sql: z.string().min(6).max(2000) },
    async ({ sql }) => {
      const res = await duckdbQuery(sql);
      return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
    },
  );

  server.tool(
    "retrieve_records",
    "Semantic retrieval over the Duval OpenSearch index — returns the most relevant source-backed " +
      "property records with citations.",
    { question: z.string().min(3).max(500), topK: z.number().int().min(1).max(20).default(6) },
    async ({ question, topK }) => {
      const records = await retrieve(question, topK);
      return { content: [{ type: "text", text: JSON.stringify(records, null, 2) }] };
    },
  );

  return server;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run as a stdio server when invoked directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("MCP server failed:", e);
    process.exit(1);
  });
}
