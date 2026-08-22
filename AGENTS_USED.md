# soofi-xyz Team Kit Usage

## Routing Decision

Consulted `arceus` (master router) which recommended:
- **Primary agent**: `oracle` — county property/permit ingestion pipeline
- **Supporting agents**: `metagross` (monorepo scaffold), `donphan` (MCP data exploration)
- **Mandatory skill**: `apply-engineering-guidelines` (Golden Path baseline)

## Agent → Component Mapping

| Kit Agent | Component | How Used |
|-----------|-----------|----------|
| `oracle` | `pipeline/` | County ingestion pipeline following oracle skill sequence: discovery → seed → appraisal → permits → ownership → geo → business → contractor → SunBiz → BBB → reconcile → publish |
| `metagross` | Root monorepo | Turborepo-style workspace layout with frontend/backend split: `pipeline/`, `frontend/`, `agent/`, `mcp/`, `infra/` |
| `donphan` | `mcp/` | MCP server exposing published IPFS data via DuckDB httpfs — listOracleProperties, queryProperties, getPropertyDetail |
| `ash` | `agent/` | AI agent with Vercel AI SDK, tool-calling over published data |

## Skills Applied

| Skill | Evidence |
|-------|---------|
| `apply-engineering-guidelines` | TypeScript everywhere, Vercel AI SDK for agent, CDK for infra, Vitest tests, Powertools observability, PagerDuty alerting, GitHub Actions CI |
| `use-oracle` | 14-step pipeline sequence: bootstrap → discovery → seed → appraisal onboarding → validate transform → permit adapter → pilot ingest → full ingest → SunBiz → BBB → query-db loading → publish open data → publish query table → deploy MCP |
| `use-elephant-mcp` | MCP server queries published IPFS Parquet via DuckDB httpfs, supports PROPERTY_QUERY_TABLE_MAP and DATASET_COVERAGE_MAP conventions |
| `build-frontend-backends` | React + Vite frontend with Shadcn/ui, Hono API backend, shared TypeScript types |
| `build-ai-agents` | Vercel AI SDK agent with tool definitions, DuckDB-backed property queries |

## Pipeline Skill Sequence Alignment

Our 14-step pipeline maps to the oracle skill sequence:

| Step | Oracle Skill | Our Implementation |
|------|-------------|-------------------|
| 1 | bootstrap-oracle-infra | `infra/` CDK stacks: EC2 + Docker Compose (Restate + Postgres) |
| 2 | county-discovery | `pipeline/src/sources/duval-catalog.ts` |
| 3 | county-seed-data | `pipeline/data/seeds/duval.csv` + `pipeline/src/seeds/load-seed.ts` |
| 4 | county-appraisal-onboarding | `pipeline/src/sources/appraiser.ts` |
| 5 | validate-county-transform | `pipeline/tests/integration/appraiser-transform.test.ts` |
| 6 | county-permit-adapter | `pipeline/src/sources/permits.ts` |
| 7 | county-ingest-run (pilot) | `pipeline/src/scripts/pilot-ingest.ts --limit 25` |
| 8 | county-ingest-run (full) | `pipeline/src/scripts/pilot-ingest.ts` (200 properties) |
| 9 | sunbiz-corporate-ingest | `pipeline/src/sources/sunbiz.ts` |
| 10 | bbb-harvest | `pipeline/src/sources/bbb.ts` |
| 11 | query-db-loading-matching | `pipeline/src/services/parcel.ts` (reconciliation) |
| 12 | county-open-data-publish | `pipeline/src/lib/ingest.ts` (JSON publish to IPFS) |
| 13 | county-query-table-publish | `pipeline/src/lib/ingest.ts` (Parquet publish to IPFS) |
| 14 | deploy-open-data-mcp | `mcp/src/server.ts` (MCP server) |

## Engineering Guidelines Compliance

| Guideline | Status |
|-----------|--------|
| TypeScript for all services | Yes |
| Vercel AI SDK for LLM | Yes — `ai` + `@ai-sdk/anthropic` |
| AWS primary, us-east-2 | Yes |
| CDK only IaC | Yes |
| Powertools Logger/Tracer/Metrics | Yes — `@aws-lambda-powertools/*` |
| PagerDuty alerting | Yes — Events API v2 via SNS |
| Vitest tests | Yes — 258+ unit tests |
| GitHub Actions CI | Yes — `.github/workflows/ci.yml` |
| Prettier + ESLint | Yes |
| IPFS/IPNS publishing | Yes — Filebase with CID verification |
