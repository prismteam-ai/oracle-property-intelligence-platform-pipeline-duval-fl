/**
 * tRPC context: resolves runtime secrets (once, from Secrets Manager), authenticates the request
 * by bearer token, and builds a request-scoped PII-redacting logger. The data API is server-only
 * and behind auth — a valid `Authorization: Bearer <API_ACCESS_TOKEN>` is required for every
 * data procedure. The token is provided to the authenticated frontend operator; it is never baked
 * into the static client bundle.
 */
import type { CreateAWSLambdaContextOptions } from "@trpc/server/adapters/aws-lambda";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { getConfig } from "./env.ts";
import { createLogger, type Logger } from "./logger.ts";

export interface Context {
  authed: boolean;
  requestId: string;
  logger: Logger;
}

function bearer(event: APIGatewayProxyEventV2): string | null {
  const h = event.headers ?? {};
  const raw = h["authorization"] ?? h["Authorization"] ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1]!.trim() : null;
}

export async function createContext(
  opts: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>,
): Promise<Context> {
  const requestId = opts.event.requestContext?.requestId ?? "local";
  const logger = createLogger(requestId, { route: opts.event.rawPath });
  let authed = false;
  try {
    const cfg = await getConfig();
    const token = bearer(opts.event);
    authed = token != null && token === cfg.API_ACCESS_TOKEN;
  } catch (err) {
    logger.error("config/auth resolution failed", { err: (err as Error).message });
  }
  return { authed, requestId, logger };
}
