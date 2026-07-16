/**
 * The hybrid Oracle agent: retrieval-grounded + SQL/DuckDB over the reconciled Neon entities.
 *
 * For a natural-language question it (1) routes to one of the six inquiry workflows, (2) gathers
 * EVIDENCE from two complementary paths — the deterministic workflow SQL (exact facts + provenance)
 * and semantic retrieval over the OpenSearch index (grounding records) — and (3) asks Claude to
 * write a source-backed answer strictly from that evidence. It never invents facts: where a fact is
 * not yet populated (e.g. regional owners pending the Task 13 backfill) it says so. Walking-distance
 * answers always surface the distance calculation basis.
 */
import type { AgentAnswer, Citation, PropertyHit, WorkflowId } from "@oracle-duval/shared";
import { getWorkflow } from "@oracle-duval/shared";
import { REASONING_MODEL_ID, reason } from "./bedrock.ts";
import { runWorkflow, compoundQuery } from "./queries.ts";
import { retrieve, type RetrieveFilters } from "./tools/retrieval.ts";
import { duckdbAvailable } from "./tools/duckdb.ts";

interface Intent {
  workflow: WorkflowId | null;
  filters: RetrieveFilters;
}

/** Deterministic keyword routing to a workflow (kept explicit — no dynamic tool discovery). */
export function classify(question: string): Intent {
  const q = question.toLowerCase();
  const has = (...ws: string[]) => ws.some((w) => q.includes(w));
  if (has("roof")) return { workflow: "roof_age", filters: { has_recent_roofing_permit: false } };
  if (has("water", "waterfront", "river", "lake", "canal")) return { workflow: "water_view", filters: { water_view: true } };
  if (has("no recorded exchange", "no exchange", "held", "not sold", "ownership age", "same owner", "long-held", "long held", "10 year"))
    return { workflow: "ownership_age", filters: {} };
  if (has("regional owner", "out of area", "out-of-area", "out of state", "absentee", "regional"))
    return { workflow: "regional_owner", filters: {} };
  if (has("walk", "walking", "transit", "bus", "starbucks", "distance", "stop"))
    return { workflow: "walking_distance", filters: { near_transit: true } };
  if (has("by source", "records by", "coverage", "how many records", "per source", "provenance"))
    return { workflow: "records_by_source", filters: {} };
  return { workflow: null, filters: {} };
}

const SYSTEM = `You are the Oracle Property Intelligence agent for Duval County, Florida. You answer
questions about real, reconciled county property records STRICTLY from the EVIDENCE JSON provided in
the user message. Rules:
- Ground every claim in the evidence. Do NOT invent parcels, counts, dates, or distances.
- Cite by folio and source_system (e.g. "folio 1295560000, source duval_appraiser + duval_jaxepics").
- When the evidence includes a coverage object, state how many records the fact is populated for
  (e.g. "51 of 373 parcels have a permit-derived roof age") so the reader knows the honest scale.
- When evidence includes a pendingNote, report it plainly instead of guessing (a fact may not be
  backfilled yet). Never fabricate values for an unpopulated fact.
- For a compound question, \`compound_criteria\` lists the criteria and \`matched_count\` is the EXACT
  number of parcels satisfying ALL of them (\`sql_facts\` are those parcels). State that intersection
  count and list the matches — do NOT say the intersection is unknown.
- For walking-distance questions, state the distance calculation basis: the method (haversine
  great-circle), the parcel coordinate source (US Census geocode), the POI source (JTA GTFS stops /
  OSM), the measured distance in metres, and the walkshed threshold.
- Never reveal owner names or mailing addresses (they are excluded from the evidence by design).
- Be concise: 2-5 sentences plus a short bullet list of the top matching parcels with their key fact.`;

function evidenceCitations(hits: PropertyHit[], retrieved: { citations: Citation[] }[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const h of hits) for (const c of h.citations) {
    const k = `${c.source_system}:${c.source_record_key}:${c.contributes}`;
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  for (const r of retrieved) for (const c of r.citations) {
    const k = `${c.source_system}:${c.source_record_key}:${c.contributes}`;
    if (!seen.has(k)) { seen.add(k); out.push(c); }
  }
  return out.slice(0, 24);
}

export interface AskOptions {
  /** Skip the LLM narrative (evidence-only) — used for cheap smoke tests. */
  noNarrative?: boolean;
  limit?: number;
}

export async function ask(question: string, opts: AskOptions = {}): Promise<AgentAnswer> {
  const paths: string[] = [];
  const { workflow } = classify(question);

  // 1) Deterministic facts + provenance. A multi-criterion question ("near transit AND regional
  //    owners") is answered by an exact SQL intersection; otherwise by the single matching workflow.
  let sqlHits: PropertyHit[] = [];
  let workflowMeta: { coverage?: unknown; pendingNote?: string; matched?: number; basis?: string; criteria?: string[] } = {};
  const compound = await compoundQuery(question, 8);
  if (compound) {
    sqlHits = compound.rows;
    workflowMeta = {
      matched: compound.matched,
      basis: `Compound intersection (all of): ${compound.criteria.join(" AND ")}`,
      criteria: compound.criteria,
    };
    paths.push("sql:compound");
  } else if (workflow && workflow !== "records_by_source") {
    const wf = await runWorkflow(workflow, opts.limit ?? 8);
    sqlHits = wf.rows.slice(0, 8);
    workflowMeta = { coverage: wf.coverage, pendingNote: wf.pendingNote, matched: wf.matched, basis: wf.basis };
    paths.push("sql");
  }

  // 2) Semantic retrieval for grounding records with source-backed evidence.
  let retrieved: Awaited<ReturnType<typeof retrieve>> = [];
  try {
    retrieved = await retrieve(question, 6, workflow ? classify(question).filters : {});
    paths.push("retrieval");
  } catch (err) {
    // Retrieval is best-effort; the SQL path still grounds the answer.
    retrieved = [];
  }

  if (await duckdbAvailable()) paths.push("duckdb");

  const evidence = {
    question,
    workflow: workflowMeta.criteria ? "compound" : workflow ?? "(general — no single workflow matched)",
    workflow_question: workflow ? getWorkflow(workflow).question : null,
    compound_criteria: workflowMeta.criteria ?? null,
    basis: workflowMeta.basis ?? null,
    coverage: workflowMeta.coverage ?? null,
    matched_count: workflowMeta.matched ?? null,
    pendingNote: workflowMeta.pendingNote ?? null,
    sql_facts: sqlHits.map((h) => ({ folio: h.folio, situs: h.situs_address, usage: h.property_usage_type, facts: h.facts, basis: h.basis })),
    retrieved_records: retrieved.map((r) => ({ folio: r.folio, situs: r.situs_address, summary: r.summary, facts: r.facts })),
  };

  const citations = evidenceCitations(sqlHits, retrieved);

  if (opts.noNarrative) {
    return {
      question,
      workflow: workflow ?? null,
      answer: `[evidence-only] ${sqlHits.length} SQL facts, ${retrieved.length} retrieved records`,
      evidence: sqlHits,
      citations,
      paths,
      model: REASONING_MODEL_ID,
      notes: workflowMeta.pendingNote,
    };
  }

  const { text } = await reason(SYSTEM, `EVIDENCE:\n${JSON.stringify(evidence, null, 1)}\n\nAnswer the question: ${question}`);
  paths.push("reasoning");

  return {
    question,
    workflow: workflow ?? null,
    answer: text,
    evidence: sqlHits.length ? sqlHits : retrieved.map((r) => ({
      folio: r.folio, situs_address: r.situs_address, property_usage_type: r.property_usage_type,
      is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
      facts: r.facts as Record<string, string | number | boolean | null>, citations: r.citations,
    })),
    citations,
    paths,
    model: REASONING_MODEL_ID,
    notes: workflowMeta.pendingNote,
  };
}
