/**
 * Retrieval tool — the semantic half of the hybrid answering layer. Embeds the question with
 * Titan and runs hybrid (kNN + lexical) search over the deployed OpenSearch index built in
 * Task 11 (`duval-property-records`, 373 real Duval parcels, us-east-1). Returns source-backed,
 * cited records. No re-index — this reuses the live index.
 */
import type { Citation } from "@oracle-duval/shared";
import { Client } from "@opensearch-project/opensearch";
import { embed } from "../bedrock.ts";

const INDEX_NAME = "duval-property-records";

export interface RetrievedRecord {
  folio: string;
  score: number;
  situs_address: string | null;
  property_usage_type: string | null;
  summary: string;
  facts: Record<string, unknown>;
  citations: Citation[];
}

let osClient: Client | null = null;
function getClient(): Client {
  if (osClient) return osClient;
  const raw = process.env.OPENSEARCH_ENDPOINT;
  if (!raw) throw new Error("OPENSEARCH_ENDPOINT is not set (server-only).");
  const node = raw.startsWith("http") ? raw : `https://${raw}`;
  osClient = new Client({
    node: node.replace(/\/+$/, ""),
    auth: { username: process.env.OPENSEARCH_USERNAME ?? "", password: process.env.OPENSEARCH_PASSWORD ?? "" },
  });
  return osClient;
}

export interface RetrieveFilters {
  is_commercial?: boolean;
  water_view?: boolean;
  near_transit?: boolean;
  has_recent_roofing_permit?: boolean;
}

export async function retrieve(question: string, topK = 6, filters: RetrieveFilters = {}): Promise<RetrievedRecord[]> {
  const vector = await embed(question);
  const filter: unknown[] = [{ term: { county: "duval" } }];
  for (const [k, v] of Object.entries(filters)) if (v !== undefined) filter.push({ term: { [k]: v } });

  const body = {
    size: topK,
    query: {
      bool: {
        filter,
        should: [
          { knn: { embedding: { vector, k: topK * 4 } } },
          { match: { text_for_embedding: { query: question, boost: 0.4 } } },
        ],
        minimum_should_match: 1,
      },
    },
    _source: {
      excludes: ["embedding"],
    },
  };

  const res = await getClient().search({ index: INDEX_NAME, body });
  const hits = (res.body.hits?.hits ?? []) as {
    _score: number;
    _source: Record<string, unknown>;
  }[];

  return hits.map((h) => {
    const d = h._source;
    return {
      folio: d.folio as string,
      score: Number((h._score ?? 0).toFixed(4)),
      situs_address: (d.situs_address as string) ?? null,
      property_usage_type: (d.property_usage_type as string) ?? null,
      summary: (d.text_for_embedding as string) ?? "",
      facts: {
        roof_age_years: d.roof_age_years ?? null,
        roofing_permit_count: d.roofing_permit_count ?? 0,
        most_recent_roofing_permit_date: d.most_recent_roofing_permit_date ?? null,
        near_transit: d.near_transit ?? null,
        nearest_transit_stop_name: d.nearest_transit_stop_name ?? null,
        nearest_transit_distance_m: d.nearest_transit_distance_m ?? null,
        water_view: d.water_view ?? null,
        nearest_water_distance_m: d.nearest_water_distance_m ?? null,
      },
      citations: (d.sources as Citation[]) ?? [],
    };
  });
}
