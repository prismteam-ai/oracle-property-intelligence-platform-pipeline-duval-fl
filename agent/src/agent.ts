/**
 * Duval County property intelligence agent.
 * T056 — Vercel AI SDK agent with system prompt and tool definitions.
 */

import { streamText, generateText, type CoreMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { queryProperties } from './tools/query-properties.js';
import { getPropertyDetail } from './tools/property-detail.js';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a Duval County, Florida property intelligence assistant. You help users explore and analyze property data from the Oracle Pipeline.

CAPABILITIES:
- Query the property dataset using SQL (DuckDB over published Parquet files on IPFS)
- Look up individual properties by parcel ID
- Answer questions about roof ages, ownership tenure, water proximity, transit access, and more

RULES:
1. Always use the available tools to answer data questions - never make up property data
2. Always cite source provenance when presenting results (mention contributing_sources and last_pipeline_run)
3. When users ask broad questions, write efficient SQL with appropriate filters and LIMIT clauses
4. Present results in a clear, organized format
5. If a query returns no results, explain possible reasons (data coverage, filter criteria)
6. For multi-criteria queries, combine conditions in a single SQL WHERE clause
7. Always mention the data source (Published Parquet via DuckDB on IPFS/IPNS)

AVAILABLE COLUMNS in the "properties" table:
- parcel_id: Property parcel identifier (e.g., RE0001234)
- address: Full property address
- assessed_value: County-assessed property value
- market_value: Estimated market value
- roof_age_years: Age of roof in years (derived from year built or roof permit)
- ownership_tenure_years: Years since last ownership transfer
- is_regional_owner: Whether owner's mailing address differs from property location
- water_proximity_ft: Distance to nearest waterway in feet
- is_waterfront: Whether property is within 500ft of water
- transit_distance_mi: Distance to nearest public transit stop in miles
- starbucks_distance_mi: Distance to nearest Starbucks in miles
- within_walking_transit: Whether transit stop is within 0.5 miles
- within_walking_starbucks: Whether Starbucks is within 0.5 miles
- current_owner_name: Name of current property owner
- contributing_sources: Data sources that contributed to this record
- last_pipeline_run: Reference to the pipeline run that last updated this record`;

// ---------------------------------------------------------------------------
// Model provider setup
// ---------------------------------------------------------------------------

function getModel() {
  const modelId = process.env.AI_MODEL ?? 'claude-sonnet-4-20250514';

  // Detect provider from model name
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openai(modelId);
  }

  // Default to Anthropic
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic(modelId);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const tools = {
  queryProperties,
  getPropertyDetail,
};

// ---------------------------------------------------------------------------
// Chat functions
// ---------------------------------------------------------------------------

/**
 * Stream a chat response for the given messages.
 */
export function streamChat(messages: CoreMessage[]) {
  return streamText({
    model: getModel(),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    maxSteps: 5,
  });
}

/**
 * Generate a complete chat response (non-streaming).
 */
export async function generateChat(messages: CoreMessage[]) {
  return generateText({
    model: getModel(),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    maxSteps: 5,
  });
}

export { tools, SYSTEM_PROMPT };
