# Oracle Duval — hosted UI + API + agent (Task 12)

The deployed serving layer of the Oracle Property Intelligence Platform: a Turborepo/pnpm workspace
with three apps and two shared packages, built on the `build-frontend-backends` playbook (Amplify
frontend + tRPC on Lambda) and `build-ai-agents` (Bedrock reasoning + tools).

```
apps/
  web/     Next.js (static export) → AWS Amplify (us-east-2), behind a single in-app access-token gate
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

**One clean gate: an in-app access token.** The static site loads openly (it is just an empty shell
with no data and no secret in the bundle). On load the app shows a single React token form; the
reviewer enters the access token once — it is kept in `sessionStorage`, never baked into the bundle —
and it is sent as `Authorization: Bearer <token>` to the tRPC API on every call. The API rejects any
request without it (**401**), so all data + PII stay behind auth via the API.

There is deliberately **no** Amplify Basic Auth: layering a network-level Basic-Auth prompt on top of
the SPA caused the browser's native Sign-in dialog to re-challenge on client-side prefetches while
content was already rendered. Collapsing to the single token gate removes that and is the sole
credential the reviewer needs (supplied in the PR body, never committed).

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
