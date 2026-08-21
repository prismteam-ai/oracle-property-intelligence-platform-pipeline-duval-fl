/**
 * Corpus + retrieval contracts for the Duval property RAG layer (Task 11).
 *
 * One retrievable document per property (the folio spine). The document is denormalized across
 * the reconciled Neon entities (appraisal, permits, geocode, enrichment) so a single kNN hit is a
 * complete, citable parcel. `text_for_embedding` is a natural-language summary that deliberately
 * excludes owner identity (names / mailing addresses) — retrieval is grounded in the property and
 * its public sources, and citations point at source_system + record_key + folio, never an owner.
 */
import { z } from "zod";

/** A single source-provenance citation attached to a retrieved record. */
export const CitationSchema = z.object({
  /** e.g. duval_appraiser, duval_jaxepics, duval_geo_census, duval_bbb */
  source_system: z.string(),
  /** stable per-record key in the source system (the primary citation handle) */
  source_record_key: z.string().nullable(),
  /** source artifact URI or public source URL when the source retained one */
  source_uri: z.string().nullable(),
  /** page/content hash when the source retained one (idempotency + tamper-evidence) */
  page_sha256: z.string().nullable(),
  /** the parcel this citation grounds */
  folio: z.string(),
  /** short human label describing what this source contributes */
  contributes: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

/** The corpus document. Mirrors the OpenSearch mapping in opensearch.ts. */
export const PropertyDocSchema = z.object({
  id: z.string(), // = folio; stable document id (idempotent re-index)
  corpus_type: z.literal("property_record"),
  county: z.literal("duval"), // tenant/scope filter — always applied on retrieval

  folio: z.string(), // request_identifier / RE#
  property_type: z.string().nullable(), // Building | LandParcel | Unit
  property_usage_type: z.string().nullable(), // Commercial | OfficeBuilding | RetailStore | ...
  is_commercial: z.boolean(),
  built_year: z.number().int().nullable(),
  effective_built_year: z.number().int().nullable(),
  situs_address: z.string().nullable(), // public property (situs) address — NOT owner mailing
  situs_zip: z.string().nullable(),
  owner_type: z.enum(["person", "company", "mixed"]).nullable(), // structural, non-PII

  permit_count: z.number().int(),
  permit_types: z.array(z.string()),
  roofing_permit_count: z.number().int(),
  has_recent_roofing_permit: z.boolean(),
  most_recent_roofing_permit_date: z.string().nullable(), // ISO date

  has_coordinate: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  near_transit: z.boolean().nullable(),
  nearest_transit_stop_name: z.string().nullable(),
  nearest_transit_distance_m: z.number().nullable(),
  near_starbucks: z.boolean().nullable(),
  dist_band: z.string().nullable(),
  water_view: z.boolean().nullable(),
  nearest_water_distance_m: z.number().nullable(),
  roof_age_years: z.number().nullable(),

  sources: z.array(CitationSchema),

  text_for_embedding: z.string(),
  embedding_model: z.string(),
  embedding_dimension: z.number().int(),
  indexed_at: z.string(),
});
export type PropertyDoc = z.infer<typeof PropertyDocSchema>;

/** A PropertyDoc plus its embedding vector (what actually gets bulk-indexed). */
export type EmbeddedDoc = PropertyDoc & { embedding: number[] };

/** Optional hard metadata filters a caller may apply on top of semantic retrieval. */
export interface RetrievalFilters {
  is_commercial?: boolean;
  near_transit?: boolean;
  water_view?: boolean;
  has_recent_roofing_permit?: boolean;
  min_roofing_permits?: number;
  property_usage_type?: string;
}

export type ConfidenceBand = "strong" | "weak" | "drop";

/** One retrieved, cited record. */
export interface RetrievedRecord {
  folio: string;
  score: number;
  band: ConfidenceBand;
  property_usage_type: string | null;
  is_commercial: boolean;
  situs_address: string | null;
  summary: string; // the text_for_embedding (the grounding evidence)
  facts: {
    permit_count: number;
    roofing_permit_count: number;
    most_recent_roofing_permit_date: string | null;
    roof_age_years: number | null;
    near_transit: boolean | null;
    nearest_transit_stop_name: string | null;
    nearest_transit_distance_m: number | null;
    water_view: boolean | null;
    nearest_water_distance_m: number | null;
  };
  citations: Citation[];
}

export interface RetrievalResult {
  question: string;
  applied_filters: RetrievalFilters;
  embedding_model: string;
  count: number;
  records: RetrievedRecord[];
}

// --- Interfaces (adapters implement these; keeps retrieval logic mode-agnostic) ---

/** Reads the durable source records and builds corpus documents (no embeddings). */
export interface CorpusStore {
  buildDocuments(): Promise<PropertyDoc[]>;
}

/** Turns text into Bedrock embedding vectors. */
export interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly modelId: string;
  readonly dimension: number;
}

/** Creates the index, bulk-loads embedded docs, and runs hybrid kNN retrieval. */
export interface RetrievalIndex {
  ensureIndex(): Promise<void>;
  bulkIndex(docs: EmbeddedDoc[]): Promise<{ indexed: number; errors: number }>;
  countDocs(): Promise<number>;
  search(
    queryVector: number[],
    queryText: string,
    topK: number,
    filters: RetrievalFilters,
  ): Promise<{ folio: string; hybridScore: number; doc: PropertyDoc }[]>;
}
