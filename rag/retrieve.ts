/**
 * Retrieval interface (Task 11) — the query half of the hybrid answering layer.
 *
 * `retrieve(question)` embeds a natural-language question with Bedrock Titan, runs hybrid
 * (kNN + lexical) search over the OpenSearch index scoped to Duval, bands each hit by confidence,
 * and returns source-backed records WITH their citations. This is the callable the grounding agent
 * (Task 12) uses to answer semantic / exploratory questions with evidence.
 */
import { CONFIDENCE_BANDS, EMBEDDING_MODEL_ID } from "./config.ts";
import { BedrockEmbeddingService } from "./embeddings.ts";
import { OpenSearchRetrievalIndex } from "./opensearch.ts";
import type {
  ConfidenceBand,
  EmbeddingService,
  RetrievalFilters,
  RetrievalIndex,
  RetrievalResult,
  RetrievedRecord,
} from "./types.ts";

/** Band on the per-query normalized relevance (hit score / best in-query score), in [0,1]. */
function band(normalizedRelevance: number): ConfidenceBand {
  if (normalizedRelevance >= CONFIDENCE_BANDS.strong) return "strong";
  if (normalizedRelevance >= CONFIDENCE_BANDS.weak) return "weak";
  return "drop";
}

export interface RetrieveOptions {
  topK?: number;
  /** Optional hard metadata filters applied on top of semantic retrieval (county scope always on). */
  filters?: RetrievalFilters;
  /** Drop hits below the weak confidence band (default true). */
  dropLowConfidence?: boolean;
}

export class Retriever {
  constructor(
    private readonly embedder: EmbeddingService = new BedrockEmbeddingService(),
    private readonly index: RetrievalIndex = new OpenSearchRetrievalIndex(),
  ) {}

  async retrieve(question: string, opts: RetrieveOptions = {}): Promise<RetrievalResult> {
    const topK = opts.topK ?? 5;
    const filters = opts.filters ?? {};
    const dropLow = opts.dropLowConfidence ?? true;

    const queryVector = await this.embedder.embed(question);
    // Hybrid (kNN + lexical) retrieval, relevance-ranked by OpenSearch.
    const hits = await this.index.search(queryVector, question, topK, filters);
    // Per-query normalized relevance for banding: the best in-query hit is the reference point.
    const topScore = hits.length > 0 ? Math.max(...hits.map((h) => h.hybridScore)) : 1;

    const records: RetrievedRecord[] = hits
      .map((h): RetrievedRecord => {
        const d = h.doc;
        const rel = topScore > 0 ? h.hybridScore / topScore : 0;
        return {
          folio: d.folio,
          score: Number(h.hybridScore.toFixed(4)),
          band: band(rel),
          property_usage_type: d.property_usage_type,
          is_commercial: d.is_commercial,
          situs_address: d.situs_address,
          summary: d.text_for_embedding,
          facts: {
            permit_count: d.permit_count,
            roofing_permit_count: d.roofing_permit_count,
            most_recent_roofing_permit_date: d.most_recent_roofing_permit_date,
            roof_age_years: d.roof_age_years,
            near_transit: d.near_transit,
            nearest_transit_stop_name: d.nearest_transit_stop_name,
            nearest_transit_distance_m: d.nearest_transit_distance_m,
            water_view: d.water_view,
            nearest_water_distance_m: d.nearest_water_distance_m,
          },
          citations: d.sources,
        };
      })
      .filter((r) => (dropLow ? r.band !== "drop" : true));

    return {
      question,
      applied_filters: filters,
      embedding_model: EMBEDDING_MODEL_ID,
      count: records.length,
      records,
    };
  }
}
