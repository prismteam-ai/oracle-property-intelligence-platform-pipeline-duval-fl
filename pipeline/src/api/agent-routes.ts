/**
 * Agent API routes — POST /api/agent/chat (streaming), GET /api/agent/health.
 * T058 — Wires Vercel AI SDK agent to Hono endpoints.
 */

import { Hono } from 'hono';
import { streamText, type CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { tool } from 'ai';
import { z } from 'zod';
import { query as pgQuery, queryOne as pgQueryOne } from '../lib/db.js';

const agentRoutes = new Hono();

// ---------------------------------------------------------------------------
// System prompt (inline to avoid cross-workspace import)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Duval County, Florida property intelligence assistant. You help users explore and analyze property data from the Oracle Pipeline.

CAPABILITIES:
- Query the property dataset using SQL against Postgres
- Look up individual properties by parcel ID
- Answer questions about roof ages, ownership tenure, water proximity, transit access, and more

RULES:
1. Always use the available tools to answer data questions - never make up property data
2. Always cite source provenance when presenting results
3. When users ask broad questions, use appropriate filters and LIMIT clauses
4. Present results in a clear, organized format
5. If a query returns no results, explain possible reasons
6. For multi-criteria queries, combine conditions in a single query
7. Always mention data freshness (last pipeline run)

AVAILABLE SIGNALS on properties:
- parcel_id, address (jsonb with full, street, city, state, zip)
- assessed_value, market_value
- derived_signals.roof_age_years, derived_signals.ownership_tenure_years
- derived_signals.is_regional_owner, derived_signals.water_proximity_ft
- derived_signals.is_waterfront, derived_signals.transit_distance_mi
- derived_signals.starbucks_distance_mi, derived_signals.within_walking_transit
- derived_signals.within_walking_starbucks
- current_owner (jsonb with owner_name, mailing_address)
- provenance (jsonb with contributing_sources, last_pipeline_run, reconciliation_confidence)
- structure (jsonb with year_built, sqft, stories, bedrooms, bathrooms, roof_type)`;

// ---------------------------------------------------------------------------
// Model provider
// ---------------------------------------------------------------------------

function getModel() {
  const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514';

  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(modelId);
  }

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(modelId);
}

// ---------------------------------------------------------------------------
// Tools (Postgres-based, no DuckDB dependency in pipeline workspace)
// ---------------------------------------------------------------------------

const queryPropertiesTool = tool({
  description:
    'Query Duval County properties from the database. Use PostgreSQL-compatible SQL. ' +
    'The table is "properties" with jsonb columns: address, derived_signals, provenance, ' +
    'current_owner, structure, lot, tax, ownership, permits. ' +
    'Numeric columns: assessed_value, market_value. Text: parcel_id, county_jurisdiction. ' +
    'Access jsonb fields with ->> operator. Always LIMIT results to 20 unless counting.',
  parameters: z.object({
    sql: z.string().describe('PostgreSQL query to execute against the properties table'),
    explanation: z.string().describe('Brief explanation of what this query does'),
  }),
  execute: async ({ sql, explanation }) => {
    try {
      const trimmed = sql.trim().toUpperCase();
      if (!trimmed.startsWith('SELECT')) {
        return { error: 'Only SELECT queries are allowed', explanation };
      }

      const result = await pgQuery(sql);
      return {
        results: result.rows.slice(0, 100),
        row_count: result.rowCount,
        query_executed: sql,
        explanation,
        data_source: 'Pipeline Postgres database',
      };
    } catch (err) {
      return { error: `Query failed: ${String(err)}`, query_attempted: sql, explanation };
    }
  },
});

const getPropertyDetailTool = tool({
  description: 'Look up a single property by parcel ID. Returns all attributes and provenance.',
  parameters: z.object({
    parcel_id: z.string().describe('The parcel ID to look up'),
  }),
  execute: async ({ parcel_id }) => {
    try {
      const row = await pgQueryOne(
        `SELECT * FROM properties WHERE parcel_id = $1`,
        [parcel_id],
      );
      if (!row) return { error: `No property found: ${parcel_id}` };
      return { property: row, data_source: 'Pipeline Postgres database' };
    } catch (err) {
      return { error: `Lookup failed: ${String(err)}`, parcel_id };
    }
  },
});

const getRunHistoryTool = tool({
  description: 'Get recent pipeline run history. Shows run status, record counts, and deltas.',
  parameters: z.object({
    limit: z.number().optional().default(5).describe('Number of recent runs to retrieve'),
  }),
  execute: async ({ limit }) => {
    try {
      const result = await pgQuery(
        `SELECT run_id, county, started_at, completed_at, status, record_count,
                delta_new, delta_updated, delta_removed, published_artifact_cid, ipns_pointer
         FROM pipeline_runs
         ORDER BY started_at DESC
         LIMIT $1`,
        [limit],
      );
      return { runs: result.rows, count: result.rowCount };
    } catch (err) {
      return { error: `Failed to fetch run history: ${String(err)}` };
    }
  },
});

const agentTools = {
  queryProperties: queryPropertiesTool,
  getPropertyDetail: getPropertyDetailTool,
  getRunHistory: getRunHistoryTool,
};

// ---------------------------------------------------------------------------
// POST /api/agent/chat — streaming response
// ---------------------------------------------------------------------------

agentRoutes.post('/api/agent/chat', async (c) => {
  try {
    const body = await c.req.json<{ messages: CoreMessage[] }>();

    if (!body.messages || !Array.isArray(body.messages)) {
      return c.json({ error: 'messages array is required' }, 400);
    }

    const result = streamText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      messages: body.messages,
      tools: agentTools,
      maxSteps: 5,
    });

    return result.toDataStreamResponse();
  } catch (err) {
    console.error('[agent-routes] chat error:', err);
    return c.json({ error: 'Agent chat failed', detail: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/agent/health
// ---------------------------------------------------------------------------

agentRoutes.get('/api/agent/health', (c) => {
  const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  const model = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514';

  return c.json({
    status: hasApiKey ? 'ok' : 'no_api_key',
    model,
    tools: Object.keys(agentTools),
    timestamp: new Date().toISOString(),
  });
});

export { agentRoutes };
