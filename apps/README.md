# Oracle Duval — hosted UI + API + agent (Task 12)

The deployed serving layer of the Oracle Property Intelligence Platform: a Turborepo/pnpm workspace
with three apps and two shared packages, built on the `build-frontend-backends` playbook (Amplify
frontend + tRPC on Lambda) and `build-ai-agents` (Bedrock reasoning + tools).

```
apps/
  web/     Next.js (static export) → AWS Amplify (us-east-2), behind Basic Auth + an in-app token gate
  api/     tRPC router on AWS Lambda behind API Gateway HTTP API v2 (us-east-2), deployed via CDK
  agent/   hybrid retrieval + SQL/DuckDB agent over Neon (the data + reasoning core) + MCP for Cursor
packages/
  shared/      six-workflow + source-category definitions, PII redaction, shared types
  api-client/  tRPC client factory + React hooks + the AppRouter type (imported by the web app)
```

## How it fits together

- **`apps/web`** is a static Next.js bundle — no server, no secret ever reaches the client. It calls
  the API over tRPC using the shared `api-client`. Pages: pipeline-run summary, records-by-source
  (all six categories incl. contractor), inquiry workflows (per-criterion views), parcel exploration,
  the agent chat, and the IPFS/DuckDB/MCP publication view.
- **`apps/api`** is the only place Neon is read (server-only). Every data procedure is behind a
  bearer-token check; logs are PII-redacting (owner names/addresses dropped, shape kept). It
  delegates all data + reasoning to `@oracle-duval/agent`. `DATABASE_URL` / OpenSearch creds / the
  access token live in AWS Secrets Manager, resolved at Lambda cold start — never in a committed file.
- **`apps/agent`** owns the canonical six-workflow SQL, the OpenSearch retrieval path (Task 11), the
  DuckDB query layer, and the Bedrock-grounded `ask()`. It is reused verbatim by the API and by the
  Cursor MCP server.

## Deployment regions (hard constraint)

- Frontend (Amplify) + API (Lambda/API Gateway) → **us-east-2**.
- Data plane read cross-region: Neon, OpenSearch, and Bedrock → **us-east-1**.

## Auth (how the reviewer reaches it)

1. **Amplify Basic Auth** on the branch — a browser username/password gate at the network layer.
2. **In-app access token** — the data API requires `Authorization: Bearer <token>`; the app collects
   the token once (kept in `sessionStorage`, never baked into the static bundle) and sends it on
   every call. The API rejects any request without it (401).

Both credentials are supplied in the PR body (never committed).

## Reproduce the deploy

```bash
pnpm install
# 1) API: export the non-PII query-table Parquet, bundle the Lambda, deploy the CDK stack
pnpm --filter @oracle-duval/agent duckdb:export
API_SECRET_ARN=<secret-arn> ALLOWED_ORIGIN='*' DATA_AWS_REGION=us-east-1 \
  pnpm --filter @oracle-duval/api deploy
# 2) Web: build the static export against the API URL and manual-deploy to Amplify
NEXT_PUBLIC_API_URL=<api-url> pnpm --filter @oracle-duval/web build   # → apps/web/out
#    then: amplify create-deployment → PUT out.zip → start-deployment (see task report)
```
