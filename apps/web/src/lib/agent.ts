import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { PROPERTIES_VIEW, runQuery, schema } from "./oracle";
import { QUESTIONS, buildSql, questionBySlug } from "./questions";

/**
 * Natural-language agent over the published Duval dataset.
 *
 * Built on the Vercel AI SDK with Zod tool schemas, per the team's engineering
 * guidelines — the provider adapter is `@ai-sdk/anthropic`, not the Anthropic
 * SDK directly.
 *
 * The agent has no database access and no ability to invent numbers. Every tool
 * it can call resolves to a read-only SELECT against the Parquet artifact
 * published on IPFS, and each returns the SQL it ran alongside the rows. That is
 * what makes an answer source-backed: the number comes from a query the reader
 * can see and re-run, not from the model.
 */

/** Sonnet 5 rather than Opus 5: this endpoint is public, interactive and driven
 *  by a browser, so latency is a functional requirement. Sonnet 5 is near-Opus
 *  on agentic work at materially lower latency. */
const MODEL = process.env["ORACLE_AGENT_MODEL"] ?? "claude-sonnet-5";

const SYSTEM = `You are the Duval County property intelligence agent.

You answer questions about property in Duval County, Florida by querying a
published dataset of 404,023 parcels. The dataset is a Parquet file on IPFS; you
reach it through the tools below, which run read-only SQL against a view called
"${PROPERTIES_VIEW}".

Rules that matter:

- Never state a number you did not get from a tool call. If you cannot query it,
  say so rather than estimating.
- Always report what an answer is derived from, and its limits. The derived
  columns are proxies, not observations: roof age comes from effective year
  built rather than a roofing permit; waterfront is distance from the parcel
  centroid to a named water body, which is adjacency and not a view; ownership
  tenure is exact only where a sale is recorded in the current roll period and
  is otherwise banded from the Florida assessment-cap differential.
- Permit, contractor, Sunbiz and BBB columns are NULL for Duval in this
  milestone. If asked about them, say they are not ingested — never read NULL as
  "none".
- Prefer the purpose-built question tools over raw SQL. Reach for runSql only
  when no question tool fits.
- Answer concisely. Lead with the number, then the basis, then the caveat.
- Cite specific parcels by their request_identifier where it helps.`;

const questionSlugs = QUESTIONS.map((q) => q.slug) as [string, ...string[]];

export interface AgentToolCall {
  tool: string;
  sql?: string;
  rowCount?: number;
  durationMs?: number;
}

export interface AgentAnswer {
  text: string;
  toolCalls: AgentToolCall[];
  model: string;
  cid?: string;
}

export async function askAgent(question: string): Promise<AgentAnswer> {
  const toolCalls: AgentToolCall[] = [];
  let cid: string | undefined;

  const record = (
    name: string,
    sql: string,
    rowCount: number,
    durationMs: number,
    pointerCid: string,
  ) => {
    toolCalls.push({ tool: name, sql, rowCount, durationMs });
    cid = pointerCid;
  };

  const tools = {
    describeDataset: tool({
      description:
        "List the columns available on the properties view, with types. Call this before writing raw SQL.",
      inputSchema: z.object({}),
      execute: async () => {
        const columns = await schema();
        toolCalls.push({ tool: "describeDataset", rowCount: columns.length });
        return { view: PROPERTIES_VIEW, columns };
      },
    }),

    answerStandardQuestion: tool({
      description:
        "Answer one of the six standard property-intelligence questions using its vetted SQL, basis and caveat. Prefer this over raw SQL.",
      inputSchema: z.object({
        slug: z
          .enum(questionSlugs)
          .describe("Which standard question to answer"),
        params: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Optional thresholds, e.g. { min: '25' } for roof age or { max: '400' } for distance in metres",
          ),
      }),
      execute: async ({ slug, params }) => {
        const question = questionBySlug(slug);
        if (!question) return { error: `Unknown question: ${slug}` };
        const sql = buildSql(question, params ?? {}, 20);
        const result = await runQuery(sql, { limit: 20 });
        record(
          "answerStandardQuestion",
          sql,
          result.rows.length,
          result.durationMs,
          result.pointer.cid,
        );
        return {
          question: question.title,
          sql,
          rows: result.rows,
          basis: question.basis,
          caveat: question.caveat,
        };
      },
    }),

    countMatching: tool({
      description:
        "Count properties matching a SQL WHERE predicate. Use for 'how many' questions across the whole county.",
      inputSchema: z.object({
        where: z
          .string()
          .describe(
            "A SQL boolean expression over the properties view, e.g. \"roof_age_years > 30 AND address_city = 'JACKSONVILLE'\"",
          ),
      }),
      execute: async ({ where }) => {
        const sql = `SELECT count(*) AS matches FROM ${PROPERTIES_VIEW} WHERE ${where}`;
        try {
          const result = await runQuery<{ matches: number }>(sql);
          record(
            "countMatching",
            sql,
            1,
            result.durationMs,
            result.pointer.cid,
          );
          return { sql, matches: Number(result.rows[0]?.matches ?? 0) };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),

    runSql: tool({
      description:
        "Run a read-only SELECT against the properties view. Single statement only; results are capped. Use when no standard question fits.",
      inputSchema: z.object({
        sql: z
          .string()
          .describe(
            `A single read-only SELECT (a leading WITH is allowed) over the "${PROPERTIES_VIEW}" view`,
          ),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({ sql, limit }) => {
        try {
          const result = await runQuery(sql, { limit: limit ?? 25 });
          record(
            "runSql",
            result.sql,
            result.rows.length,
            result.durationMs,
            result.pointer.cid,
          );
          return { sql: result.sql, rows: result.rows };
        } catch (error) {
          // Returned rather than thrown, so the model can correct its own SQL.
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  };

  const result = await generateText({
    model: anthropic(MODEL),
    system: SYSTEM,
    prompt: question,
    tools,
    // Bounded so a public endpoint cannot be driven into an unbounded tool loop.
    stopWhen: stepCountIs(6),
  });

  return { text: result.text, toolCalls, model: MODEL, cid };
}
