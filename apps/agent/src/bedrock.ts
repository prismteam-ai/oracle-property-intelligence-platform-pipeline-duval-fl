/**
 * Amazon Bedrock access (us-east-1): Titan v2 embeddings for retrieval and Claude (via a
 * cross-region inference profile) for the agent's narrative reasoning. Bare model IDs are NOT
 * invokable on-demand — Claude 4.x requires the `us.` inference-profile ID.
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  ConverseCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";

export const EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
export const EMBEDDING_DIMENSION = 1024;
/** Cross-region inference profile (on-demand). Overridable via env for portability. */
export const REASONING_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const REGION = process.env.BEDROCK_REGION ?? process.env.DATA_AWS_REGION ?? "us-east-1";

let client: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (!client) client = new BedrockRuntimeClient({ region: REGION });
  return client;
}

/** Embed one text with Titan v2 → 1024-dim cosine-normalized vector. */
export async function embed(text: string): Promise<number[]> {
  const res = await getClient().send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSION, normalize: true }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] };
  return parsed.embedding;
}

export interface ReasonResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
}

/**
 * Reason over evidence with Claude via the Converse API, with a cached system prompt (prompt
 * caching cuts cost on the repeated grounding instructions). Returns the narrative + token usage.
 */
export async function reason(system: string, userPrompt: string): Promise<ReasonResult> {
  const messages: Message[] = [{ role: "user", content: [{ text: userPrompt }] }];
  const res = await getClient().send(
    new ConverseCommand({
      modelId: REASONING_MODEL_ID,
      // Cache the (large, stable) system grounding block across turns.
      system: [{ text: system }, { cachePoint: { type: "default" } }],
      messages,
      inferenceConfig: { maxTokens: 900, temperature: 0.2 },
    }),
  );
  const text = res.output?.message?.content?.map((c) => ("text" in c ? c.text : "")).join("") ?? "";
  const u = (res.usage ?? {}) as {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  return {
    text: text.trim(),
    usage: {
      inputTokens: u.inputTokens ?? 0,
      outputTokens: u.outputTokens ?? 0,
      cacheReadTokens: u.cacheReadInputTokens ?? 0,
      cacheWriteTokens: u.cacheWriteInputTokens ?? 0,
    },
  };
}
