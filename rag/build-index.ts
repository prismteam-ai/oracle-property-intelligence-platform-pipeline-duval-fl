/**
 * Index build script (Task 11) — reads the real reconciled Duval records from Neon, embeds each
 * property summary with Bedrock Titan v2, and bulk-loads them into the OpenSearch kNN index with
 * source-provenance citations. Idempotent: the folio is the document id, so re-running upserts.
 *
 *   DATABASE_URL / OPENSEARCH_* / AWS creds are read from the environment (never committed).
 *   Run: DATABASE_URL=... OPENSEARCH_ENDPOINT=... OPENSEARCH_USERNAME=... OPENSEARCH_PASSWORD=... \
 *        AWS_PROFILE=... AWS_REGION=us-east-1 npm run rag:build-index
 */
import { NeonCorpusStore } from "./corpus.ts";
import { BedrockEmbeddingService } from "./embeddings.ts";
import { OpenSearchRetrievalIndex } from "./opensearch.ts";
import type { EmbeddedDoc } from "./types.ts";

async function main(): Promise<void> {
  const corpus = new NeonCorpusStore();
  const embedder = new BedrockEmbeddingService();
  const index = new OpenSearchRetrievalIndex();

  console.log("[build] reading + reconciling real Duval records from Neon ...");
  const docs = await corpus.buildDocuments();
  const withPermits = docs.filter((d) => d.permit_count > 0).length;
  const withRoof = docs.filter((d) => d.roofing_permit_count > 0).length;
  const withGeo = docs.filter((d) => d.has_coordinate).length;
  const withTransit = docs.filter((d) => d.near_transit === true).length;
  const withWater = docs.filter((d) => d.water_view === true).length;
  console.log(
    `[build] built ${docs.length} property documents ` +
      `(permits:${withPermits} roofing:${withRoof} geocoded:${withGeo} near_transit:${withTransit} waterfront:${withWater})`,
  );

  console.log(`[build] embedding ${docs.length} summaries via ${embedder.modelId} (${embedder.dimension}-dim) ...`);
  const vectors = await embedder.embedBatch(docs.map((d) => d.text_for_embedding));
  const embedded: EmbeddedDoc[] = docs.map((d, i) => ({ ...d, embedding: vectors[i]! }));

  console.log("[build] ensuring OpenSearch kNN index ...");
  await index.ensureIndex();

  console.log(`[build] bulk-indexing ${embedded.length} documents ...`);
  const { indexed, errors } = await index.bulkIndex(embedded);
  const total = await index.countDocs();
  console.log(`[build] done — indexed=${indexed} errors=${errors} index_doc_count=${total}`);
  if (errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[build] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
