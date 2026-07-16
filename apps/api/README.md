# @oracle-duval/api — tRPC backend on Lambda (us-east-2)

The server-only data + agent API. A single Node.js 22 Lambda behind an API Gateway HTTP API v2,
deployed via CDK. It is the only place Neon is read; the static frontend only ever receives
already-shaped, PII-free results.

## Routers

| Router | Procedures | Notes |
|---|---|---|
| `health` | `health` | public smoke check |
| `pipeline` | `summary`, `recordsBySource`, `contractors`, `publication` | run summary + 6-source coverage + IPFS/MCP status |
| `workflows` | `list`, `run` | the six inquiry workflows (per-criterion views) |
| `entities` | `explore` | one parcel's reconciled entities + relationships |
| `agent` | `ask`, `duckdb`, `duckdbStatus` | hybrid NL agent + the DuckDB query layer |

Every non-`health` procedure is `protectedProcedure` — it requires `Authorization: Bearer
<API_ACCESS_TOKEN>`. The error formatter strips stack traces; input schemas are `.strict()`.

## Security / hygiene

- **Server-only DB access.** `DATABASE_URL`, OpenSearch creds, and the access token are read from
  AWS Secrets Manager (one JSON secret, ARN passed as `API_SECRET_ARN`) at cold start. Nothing
  sensitive is committed or sent to the client.
- **PII-redacting logs** (`src/logger.ts` + `@oracle-duval/shared` `redactForLog`): owner names /
  mailing addresses / contacts are dropped from every log line; the record shape is kept.
- **Bedrock** runs in us-east-1 via the Lambda role (`bedrock:InvokeModel` on the inference profile).

## Build + deploy

```bash
# The DuckDB layer ships a non-PII query-table Parquet — regenerate it first (reads Neon):
pnpm --filter @oracle-duval/agent duckdb:export
# Bundle (esbuild → ESM; @aws-sdk external/runtime-provided; @duckdb native copied in) + deploy:
API_SECRET_ARN=<arn> ALLOWED_ORIGIN=<amplify-url-or-*> DATA_AWS_REGION=us-east-1 \
  CDK_REGION=us-east-2 pnpm --filter @oracle-duval/api deploy
```

The catch-all route is registered with **explicit** methods (`GET`, `POST`) — never `ANY` — so the
CORS preflight is answered by the API Gateway CORS config, not forwarded to the tRPC handler.
