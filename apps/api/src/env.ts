/**
 * Server-only runtime configuration. Secrets are resolved from AWS Secrets Manager (one JSON
 * secret whose ARN is passed to the Lambda) with a fallback to process.env for local runs. None
 * of these values is ever sent to the client — the frontend is a static bundle that talks to this
 * Lambda over tRPC and only receives already-redacted results.
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";

const SecretSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENSEARCH_ENDPOINT: z.string().min(1),
  OPENSEARCH_USERNAME: z.string().min(1),
  OPENSEARCH_PASSWORD: z.string().min(1),
  /** Bearer token the authenticated frontend must present to reach the data API. */
  API_ACCESS_TOKEN: z.string().min(8),
});

export type RuntimeConfig = z.infer<typeof SecretSchema> & { AWS_REGION: string };

let cached: RuntimeConfig | null = null;

async function loadSecretJson(): Promise<Record<string, unknown>> {
  const arn = process.env.API_SECRET_ARN;
  if (!arn) {
    // Local / non-Lambda path: read straight from the environment.
    return {
      DATABASE_URL: process.env.DATABASE_URL,
      OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT,
      OPENSEARCH_USERNAME: process.env.OPENSEARCH_USERNAME,
      OPENSEARCH_PASSWORD: process.env.OPENSEARCH_PASSWORD,
      API_ACCESS_TOKEN: process.env.API_ACCESS_TOKEN ?? "local-dev-token",
    };
  }
  const client = new SecretsManagerClient({});
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) throw new Error("API secret has no SecretString");
  return JSON.parse(res.SecretString) as Record<string, unknown>;
}

/** Resolve (and cache) the runtime config. Throws a clear error if a required secret is missing. */
export async function getConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  const raw = await loadSecretJson();
  const parsed = SecretSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Runtime secret is invalid or incomplete: ${parsed.error.message}`);
  }
  cached = {
    ...parsed.data,
    AWS_REGION: process.env.DATA_AWS_REGION ?? process.env.AWS_REGION ?? "us-east-1",
  };
  // Expose OpenSearch + Bedrock config to the agent package via env (same process).
  process.env.DATABASE_URL = cached.DATABASE_URL;
  process.env.OPENSEARCH_ENDPOINT = cached.OPENSEARCH_ENDPOINT;
  process.env.OPENSEARCH_USERNAME = cached.OPENSEARCH_USERNAME;
  process.env.OPENSEARCH_PASSWORD = cached.OPENSEARCH_PASSWORD;
  return cached;
}
