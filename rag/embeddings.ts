/**
 * Bedrock embedding adapter — Amazon Titan Text Embeddings v2 (1024-dim, cosine-normalized).
 *
 * AWS credentials + region come from the standard SDK provider chain (SSO / profile / role);
 * no keys are read or logged here. Titan has no server-side batch API, so `embedBatch` fans out
 * with a small concurrency limit (the corpus is a few hundred parcels — well within limits).
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { AWS_REGION, EMBEDDING_DIMENSION, EMBEDDING_MODEL_ID } from "./config.ts";
import type { EmbeddingService } from "./types.ts";

const CONCURRENCY = 8;

export class BedrockEmbeddingService implements EmbeddingService {
  readonly modelId = EMBEDDING_MODEL_ID;
  readonly dimension = EMBEDDING_DIMENSION;
  private readonly client = new BedrockRuntimeClient({ region: AWS_REGION });

  async embed(text: string): Promise<number[]> {
    const cmd = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: text,
        dimensions: this.dimension,
        normalize: true, // unit vectors → OpenSearch cosinesimil score is a clean cosine
      }),
    });
    const res = await this.client.send(cmd);
    const parsed = JSON.parse(new TextDecoder().decode(res.body)) as {
      embedding?: number[];
    };
    if (!parsed.embedding || parsed.embedding.length !== this.dimension) {
      throw new Error(
        `Titan returned an unexpected embedding (len=${parsed.embedding?.length ?? "none"}, expected ${this.dimension})`,
      );
    }
    return parsed.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = new Array(texts.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= texts.length) return;
        out[i] = await this.embed(texts[i]!);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () => worker()),
    );
    return out;
  }
}
