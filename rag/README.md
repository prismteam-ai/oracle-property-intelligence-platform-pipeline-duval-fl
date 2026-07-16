# Retrieval layer (RAG) — semantic, source-backed retrieval over real Duval records

This is the **retrieval half** of the hybrid answering layer (design §3). The SQL/DuckDB half runs
exact predicates over the reconciled Neon entities; this layer answers **semantic / exploratory**
questions ("commercial properties with recent roofing permits", "parcels near transit", "waterfront
properties") by embedding the question and retrieving the most relevant **real** property records
**with source-backed citations**. The grounding agent (Task 12) uses `retrieve()` to answer in
natural language without inventing beyond the retrieved evidence.

## What is indexed

One denormalized document per **property** (the folio spine — `properties.request_identifier` /
RE#), joining the reconciled entities:

| Contributes | Source system | Cited by |
| --- | --- | --- |
| Property record (use, year built, situs address) | `duval_appraiser` | `source_record_key`, `source_artifact_uri`, `source_record_hash` |
| Building permits (incl. roofing) | `duval_jaxepics` | `source_record_key` (`duval_jaxepics:<parcel>:permit:<id>`) |
| Parcel coordinate | `duval_geo_census` | `source_record_key` |
| Derived geo/roof facts (walking distance, water proximity, roof age) | `oracle_enrichment` | folio + inspectable `property_enrichment.*_basis` |

Each document carries a `sources[]` array of citations so **every retrieved record is traceable to
its source** by `source_system` + `source_record_key` + `folio`. The embedded summary
(`text_for_embedding`) and citations **exclude owner identity** (names / mailing addresses) — the
PII boundary of design §8. `owner_type` (person / company / mixed) is kept as a non-identifying
structural filter. The situs (property) address is public record.

## Retrieval pipeline (not "top vector hit wins")

Per the confidence policy, retrieval is a scored decision pipeline:

1. Embed the question with **Amazon Bedrock Titan Text Embeddings v2** (1024-dim, cosine-normalized).
2. Always apply the **`county = duval`** scope filter; apply any caller-supplied metadata filters
   (`is_commercial`, `near_transit`, `water_view`, `has_recent_roofing_permit`, `min_roofing_permits`,
   `property_usage_type`).
3. Run **hybrid** search over OpenSearch: kNN vector similarity (HNSW / Lucene / `cosinesimil`)
   blended with a BM25 `match` over the summary text, so exact terms reinforce the vector ranking.
4. Band each hit by confidence (`strong` / `weak` / `drop`) and return records **with citations**.

## Infrastructure

- **Amazon OpenSearch Service** managed domain, **us-east-1** — a single `t3.small.search` node,
  single-AZ, 10 GB gp3 EBS, fine-grained access control (HTTPS + master user), encryption at rest
  and node-to-node encryption. Minimal footprint on purpose (see the run record for the cost note).
- **Amazon Bedrock** (`amazon.titan-embed-text-v2:0`) for both index-build and query embeddings.
- **Neon** (Postgres) is the record source, read server-side.

The same OpenSearch query code runs against either the AWS domain or a local Docker OpenSearch —
only the endpoint/auth (from the environment) differ; local emulation mirrors the production
contract rather than forking it.

## Files

| File | Role |
| --- | --- |
| `config.ts` | Index name, model id, confidence bands, env-read secrets (server-only) |
| `types.ts` | Zod corpus contract + citation schema + retrieval interfaces |
| `corpus.ts` | `CorpusStore` — reads Neon, builds citable property docs (no owner PII) |
| `embeddings.ts` | `EmbeddingService` — Bedrock Titan v2 adapter |
| `opensearch.ts` | `RetrievalIndex` — kNN mapping, bulk load, hybrid search |
| `build-index.ts` | Index build script: Neon → embed → bulk-index |
| `retrieve.ts` | `retrieve(question)` — the callable the agent uses |
| `probe.ts` | Verification probes over the real index |

## Running (all secrets from the environment — never committed)

```bash
# Required env: DATABASE_URL, OPENSEARCH_ENDPOINT, OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD,
#               AWS credentials (SSO/profile/role), AWS_REGION=us-east-1
npm run rag:build-index   # read Neon → embed via Bedrock → bulk-index into OpenSearch
npm run rag:probe         # run the NL verification probes against the real index
```
