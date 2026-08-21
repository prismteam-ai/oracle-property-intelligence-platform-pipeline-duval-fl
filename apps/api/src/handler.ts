/**
 * AWS Lambda entry point (HTTP API v2). Bridges API Gateway to the tRPC router with the AWS Lambda
 * adapter. CORS is answered here so the static Amplify frontend can call the API; the actual
 * OPTIONS preflight is handled by the API Gateway CORS config (the route is registered with
 * explicit methods, never `ANY`, to avoid forwarding preflights to this handler).
 */
import { awsLambdaRequestHandler } from "@trpc/server/adapters/aws-lambda";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { appRouter } from "./routers/index.ts";
import { createContext } from "./context.ts";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

export const handler = awsLambdaRequestHandler({
  router: appRouter,
  createContext,
  responseMeta() {
    return {
      headers: {
        "access-control-allow-origin": ALLOWED_ORIGIN,
        "access-control-allow-headers": "authorization,content-type",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "vary": "origin",
      },
    };
  },
});

export type { APIGatewayProxyEventV2 };
