/**
 * OpenSearch retrieval adapter — kNN vector index + hybrid (vector + lexical) search.
 *
 * The index is a single denormalized document per Duval property (folio spine). Retrieval is a
 * scored decision pipeline, not "top vector hit wins" (build-rag-systems / retrieval-and-confidence
 * rule): a `county` scope filter is always applied, optional metadata filters narrow the candidate
 * set, and the query blends kNN similarity with a BM25 match over the summary text.
 *
 * Endpoint + master credentials are read from the environment (config.ts). The identical query
 * DSL runs against the AWS domain or a local Docker OpenSearch — only the endpoint/auth differ.
 */
import { Client } from "@opensearch-project/opensearch";
import {
  EMBEDDING_DIMENSION,
  INDEX_NAME,
  openSearchConfig,
} from "./config.ts";
import type {
  EmbeddedDoc,
  PropertyDoc,
  RetrievalFilters,
  RetrievalIndex,
} from "./types.ts";

export function makeClient(): Client {
  const cfg = openSearchConfig();
  return new Client({
    node: cfg.node,
    auth: { username: cfg.username, password: cfg.password },
    ssl: { rejectUnauthorized: true },
  });
}

/** kNN mapping: HNSW over Lucene with cosine similarity on unit-normalized Titan vectors. */
function indexBody(): Record<string, unknown> {
  return {
    settings: {
      index: {
        knn: true,
        "knn.algo_param.ef_search": 100,
        number_of_shards: 1,
        number_of_replicas: 0, // single-node domain — no replica to allocate
      },
    },
    mappings: {
      properties: {
        embedding: {
          type: "knn_vector",
          dimension: EMBEDDING_DIMENSION,
          method: {
            name: "hnsw",
            space_type: "cosinesimil",
            engine: "lucene",
            parameters: { ef_construction: 128, m: 16 },
          },
        },
        id: { type: "keyword" },
        corpus_type: { type: "keyword" },
        county: { type: "keyword" },
        folio: { type: "keyword" },
        property_type: { type: "keyword" },
        property_usage_type: { type: "keyword" },
        is_commercial: { type: "boolean" },
        built_year: { type: "integer" },
        effective_built_year: { type: "integer" },
        situs_address: { type: "text" },
        situs_zip: { type: "keyword" },
        owner_type: { type: "keyword" },
        permit_count: { type: "integer" },
        permit_types: { type: "keyword" },
        roofing_permit_count: { type: "integer" },
        has_recent_roofing_permit: { type: "boolean" },
        most_recent_roofing_permit_date: { type: "date" },
        has_coordinate: { type: "boolean" },
        latitude: { type: "float" },
        longitude: { type: "float" },
        near_transit: { type: "boolean" },
        nearest_transit_stop_name: { type: "text" },
        nearest_transit_distance_m: { type: "float" },
        near_starbucks: { type: "boolean" },
        dist_band: { type: "keyword" },
        water_view: { type: "boolean" },
        nearest_water_distance_m: { type: "float" },
        roof_age_years: { type: "float" },
        sources: { type: "object", enabled: false }, // stored + returned, not indexed/analyzed
        text_for_embedding: { type: "text" },
        embedding_model: { type: "keyword" },
        embedding_dimension: { type: "integer" },
        indexed_at: { type: "date" },
      },
    },
  };
}

/** Translate optional metadata filters into OpenSearch filter clauses (county scope always on). */
function filterClauses(filters: RetrievalFilters): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [{ term: { county: "duval" } }];
  if (filters.is_commercial !== undefined)
    clauses.push({ term: { is_commercial: filters.is_commercial } });
  if (filters.near_transit !== undefined)
    clauses.push({ term: { near_transit: filters.near_transit } });
  if (filters.water_view !== undefined)
    clauses.push({ term: { water_view: filters.water_view } });
  if (filters.has_recent_roofing_permit !== undefined)
    clauses.push({ term: { has_recent_roofing_permit: filters.has_recent_roofing_permit } });
  if (filters.property_usage_type !== undefined)
    clauses.push({ term: { property_usage_type: filters.property_usage_type } });
  if (filters.min_roofing_permits !== undefined)
    clauses.push({ range: { roofing_permit_count: { gte: filters.min_roofing_permits } } });
  return clauses;
}

export class OpenSearchRetrievalIndex implements RetrievalIndex {
  private readonly client: Client;

  constructor(client: Client = makeClient()) {
    this.client = client;
  }

  async ensureIndex(): Promise<void> {
    const exists = await this.client.indices.exists({ index: INDEX_NAME });
    if (exists.body) return;
    await this.client.indices.create({ index: INDEX_NAME, body: indexBody() });
  }

  async bulkIndex(docs: EmbeddedDoc[]): Promise<{ indexed: number; errors: number }> {
    let indexed = 0;
    let errors = 0;
    const CHUNK = 100;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const slice = docs.slice(i, i + CHUNK);
      const body = slice.flatMap((d) => [
        { index: { _index: INDEX_NAME, _id: d.id } },
        d,
      ]);
      const res = await this.client.bulk({ refresh: i + CHUNK >= docs.length, body });
      for (const item of res.body.items) {
        if (item.index?.error) errors++;
        else indexed++;
      }
    }
    return { indexed, errors };
  }

  async countDocs(): Promise<number> {
    const res = await this.client.count({ index: INDEX_NAME });
    return res.body.count as number;
  }

  /**
   * Hybrid kNN + lexical retrieval, relevance-ranked by OpenSearch. The kNN clause carries the
   * metadata filter (Lucene efficient filtering) and finds semantic neighbours; a BM25 `match`
   * over the summary reinforces exact terms ("roofing", "waterfront", "transit") and rewards
   * records where the signal is dense (e.g. many recent roofing permits). The embedding vector is
   * excluded from `_source` (it is not needed downstream and keeps the response small).
   */
  async search(
    queryVector: number[],
    queryText: string,
    topK: number,
    filters: RetrievalFilters,
  ): Promise<{ folio: string; hybridScore: number; doc: PropertyDoc }[]> {
    const filter = { bool: { filter: filterClauses(filters) } };
    const res = await this.client.search({
      index: INDEX_NAME,
      body: {
        size: topK,
        _source: { excludes: ["embedding"] },
        query: {
          bool: {
            should: [
              { knn: { embedding: { vector: queryVector, k: Math.max(topK * 4, 50), filter } } },
              {
                bool: {
                  must: { match: { text_for_embedding: { query: queryText, boost: 0.4 } } },
                  filter: filterClauses(filters),
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
      },
    });
    const hits = res.body.hits.hits as { _score: number; _source: PropertyDoc }[];
    return hits.map((h) => ({
      folio: h._source.folio,
      hybridScore: h._score,
      doc: h._source,
    }));
  }
}
