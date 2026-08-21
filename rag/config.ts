/**
 * RAG retrieval layer — configuration (Task 11).
 *
 * The retrieval half of the hybrid answering layer (design §3): real Duval County records are
 * embedded with Amazon Bedrock and indexed into Amazon OpenSearch (us-east-1) as a kNN vector
 * index, so semantic / exploratory questions return source-backed, citable records.
 *
 * Server-only. Every secret is read from the environment and never hardcoded or logged:
 *   - DATABASE_URL           Neon connection string (read the real records)
 *   - OPENSEARCH_ENDPOINT    the OpenSearch domain endpoint (host, no scheme, or full https URL)
 *   - OPENSEARCH_USERNAME    OpenSearch fine-grained-access master user
 *   - OPENSEARCH_PASSWORD    OpenSearch fine-grained-access master password
 *   - AWS credentials        resolved by the standard AWS SDK provider chain (SSO/profile/role)
 *
 * The same OpenSearch query-building code runs against either the AWS domain or a local
 * Docker OpenSearch (only OPENSEARCH_ENDPOINT / auth differ), per the build-rag-systems rule
 * that local emulation must mirror the production contract rather than fork it.
 */

/** OpenSearch index holding one denormalized, embedded document per Duval property (folio spine). */
export const INDEX_NAME = "duval-property-records";

/** Amazon Bedrock embedding model. Titan Text Embeddings v2 → 1024-dim, cosine-normalized. */
export const EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
export const EMBEDDING_DIMENSION = 1024;

/** us-east-1 for both Bedrock and OpenSearch (design hard constraint). */
export const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

/**
 * Confidence bands for retrieved evidence, on the **per-query normalized relevance**
 * (hybrid score / the query's top hybrid score), which — unlike a raw kNN/BM25 score — is
 * comparable across queries. Titan v2's absolute cosine scale is compressed and query-dependent,
 * so an absolute cutoff is not meaningful; the normalized margin from the best in-query match is.
 * These classify how strongly a record should be surfaced as evidence to the grounding agent
 * (Task 12); the thresholds are calibrated against the probe set, not copied blindly.
 */
export const CONFIDENCE_BANDS = {
  strong: 0.85, // >= : within ~15% of the best in-query match — strong, directly-cited evidence
  weak: 0.6, //    >= : plausible; surface with a caveat / for exploration
  // < weak : drop from the cited set
} as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `${name} is not set. Provide it via the environment (server-only — never commit or log it).`,
    );
  }
  return v.trim();
}

export function databaseUrl(): string {
  return required("DATABASE_URL");
}

export interface OpenSearchConfig {
  node: string;
  username: string;
  password: string;
}

/** Read the OpenSearch endpoint + master credentials from the environment. */
export function openSearchConfig(): OpenSearchConfig {
  const raw = required("OPENSEARCH_ENDPOINT");
  const node = raw.startsWith("http") ? raw : `https://${raw}`;
  return {
    node: node.replace(/\/+$/, ""),
    username: required("OPENSEARCH_USERNAME"),
    password: required("OPENSEARCH_PASSWORD"),
  };
}
