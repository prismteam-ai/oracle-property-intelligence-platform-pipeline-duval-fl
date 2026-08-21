/**
 * Cross-cutting types shared by the API, the agent, and the web UI. The provenance-carrying
 * shapes mirror what the reconciled Neon entities expose; they deliberately never carry owner
 * identity (design §8 PII boundary).
 */

/** A source-provenance citation attached to any answer/record surfaced by the platform. */
export interface Citation {
  source_system: string;
  source_record_key: string | null;
  source_uri: string | null;
  page_sha256: string | null;
  folio: string;
  contributes: string;
}

/** One property row surfaced by a workflow query (public situs data + facts, no owner PII). */
export interface PropertyHit {
  folio: string;
  situs_address: string | null;
  property_usage_type: string | null;
  is_commercial: boolean;
  /** Workflow-specific facts (roof age, water distance, transit distance, held-years, ...). */
  facts: Record<string, string | number | boolean | null>;
  /** The inspectable derivation basis for the fact (e.g. distance_basis / roof_age_basis JSON). */
  basis?: unknown;
  citations: Citation[];
}

/** Result of a per-criterion workflow query. */
export interface WorkflowResult {
  workflow: string;
  question: string;
  basis: string;
  /** Set when the underlying fact is not yet fully backfilled (Task 13); UI shows it honestly. */
  pendingNote?: string;
  /** Live coverage: how many of the eligible parcels have this fact populated. */
  coverage: { populated: number; eligible: number; total: number };
  matched: number;
  rows: PropertyHit[];
}

/** The agent's grounded answer to a natural-language question. */
export interface AgentAnswer {
  question: string;
  workflow: string | null;
  answer: string;
  /** Distinct evidence records the answer is grounded in. */
  evidence: PropertyHit[];
  citations: Citation[];
  /** Which retrieval/query paths contributed (retrieval, sql, duckdb). */
  paths: string[];
  model: string;
  notes?: string;
}

/** Records-by-source overview row. */
export interface SourceCoverageRow {
  category: string;
  label: string;
  source: string;
  description: string;
  ingested: number;
  expected: number | null;
  firstLoadedAt: string | null;
  lastLoadedAt: string | null;
  cid: string | null;
}
