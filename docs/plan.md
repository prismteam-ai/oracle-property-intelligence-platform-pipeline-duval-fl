# Oracle Property Intelligence Platform — Duval County, FL — Implementation Plan

**Goal:** Complete the Oracle pipeline for Duval County — ingest real property/permit/ownership/
business/contractor/coordinate records into canonical, provenance-tracked entities in a hosted query
DB, and serve a UI and a retrieval-grounded agent that answer the required inquiry workflows with
source-backed evidence.

**Approach:** Drive the kit's agents (primarily `oracle`) against the elephant `oracle-node`
pipeline for ingestion, load and reconcile into the hosted query DB, compute geo/derived enrichment,
build the retrieval layer + hosted UI/agent, and wire the public IPFS/MCP layer (publication
exercised as a dry-run; see `docs/decisions/ipfs-publication.md`). County-specific code we author
(transform handler, source adapters, enrichment, UI, agent, MCP config) lives in this repo; the
elephant pipeline infra is deployed, not vendored.

**Tech stack:** AWS (Lambda, S3, Secrets Manager, OpenSearch, Bedrock), Neon Postgres, TypeScript,
Next.js on Amplify, tRPC/Lambda, DuckDB-on-IPFS via Filebase, the elephant MCP on Vercel.

## Global constraints

- **Regions:** data pipeline (oracle-node, Neon, OpenSearch, publish, MCP) in **us-east-1** per the
  elephant skills; frontend (Amplify UI + tRPC/Lambda) in **us-east-2** per the soofi frontend
  guidelines. MCP on Vercel (region-agnostic).
- **Publication:** the query-table and per-property open-data publishes run as **dry-run** (artifact
  + CID + MCP wiring); **no owner PII is uploaded to public IPFS**. The non-PII dataset-coverage
  artifact IS published. Rationale: `docs/decisions/ipfs-publication.md`.
- **Scale:** seed roll + FDOR cadastral geo + Sunbiz loaded in full; expensive per-parcel sources
  (appraiser detail, permits) sampled commercial-first, with an honest coverage snapshot.
- **Ingestion runs server-side** in AWS Lambda (us-east-1, a US IP) — the county portals geo-block
  non-US connections at the network layer; the pipeline is not run from a laptop.
- **Zero fork of the kit exporter** — geo/derived facts are computed in our own layer, not injected
  into the kit's fixed query-table schema.
- **Submission:** fork-and-PR — push to `origin` (the fork), open the PR against the assignment repo.
- **Docs are EN-only.**

## File structure (this repo — county-specific code + docs)

```
docs/
  design.md                      # architecture (committed)
  decisions/ipfs-publication.md  # PII-publication decision (committed)
  plan.md                        # this plan
  duval-county-findings.md       # discovery output (Stage 1)
  coverage-snapshot.md           # per-source coverage + speed limits (Stage 9/13)
transform/
  duval/handler.js               # transform v2 handler (Stage 4)
  duval/browser-flow.json        # appraiser capture flow (Stage 3)
adapters/
  duval-jaxepics.mjs             # permit adapter (Stage 6 support)
enrich/
  walking-distance.ts            # transit + Starbucks proximity (Stage 8)
  water-view.ts                  # water-adjacency (Stage 8)
  roof-age.ts                    # permit-derived roof age (Stage 8)
  regional-owner.ts              # owner-locality (Stage 8)
apps/
  web/                           # Next.js exploration UI → Amplify (Stage 12)
  api/                           # tRPC + Lambda backend (Stage 12)
  agent/                         # retrieval-grounded + SQL agent (Stage 11/12)
infra/
  run-records/                   # ingestion run summaries + CIDs (Stage 6/9)
scripts/
  bootstrap-notes.md             # exact bootstrap steps + verifications (Stage 0)
```

---

## Task 0: Bootstrap infra + workspace

**Drives:** `oracle` agent → `bootstrap-oracle-infra`.
**Prereqs:** AWS SSO session (us-east-1), Neon `DATABASE_URL`, Filebase bucket + S3 keys.

- [ ] `cdk bootstrap` the AWS account in **us-east-1** (account is empty there).
- [ ] Clone the elephant repos (`oracle-node`, `elephant-query-db`, `Counties-trasform-scripts`,
      `lexicon`) into a sibling `oracle-node/` workspace; `npx skills add elephant-xyz/skills --all -y`.
- [ ] Run `bootstrap-oracle-infra`: main stack + permit-harvest stack + own seeds bucket
      (globally-unique name, **not** `counties-seeds`) + Secrets Manager entries.
- [ ] Store `DATABASE_URL` in Secrets Manager; pass its ARN as `QueryDatabaseUrlSecretArn`.
- [ ] Supply the placeholder `ELEPHANT_*` blockchain secrets (required by the template,
      unused for archive-only) and confirm the transform-scripts staging path (`UPLOAD_TRANSFORMS=true`
      vs GitHub sync) + whether a GitHub token secret must merely exist — resolve against the actual stack.
- [ ] Keep the budget kill switch off (`EmergencyStopEnabled=false`).

**Verify:** `describe-stacks` shows main + permit-harvest `CREATE_COMPLETE`; `select 1` against Neon
succeeds; Bedrock (Claude + Titan/Cohere embed) reachable in us-east-1.
**Commit:** `scripts/bootstrap-notes.md` (exact steps + verifications, no secrets).

## Task 1: County discovery

**Drives:** `oracle` → `county-discovery`.

- [ ] Probe Duval sources from a US IP: appraiser portal (access mode, per-parcel detail URL, anti-bot),
      parcel-id format (RE#, 10-digit, leading-zero), permit vendor(s) (JaxEPICS + beach-city Click2Gov),
      bulk seed source (DCPA Data Offerings roll / FDOR NAL), FDOR cadastral FeatureServer (CO_NO=16),
      Sunbiz ZIP-prefix (322xx), BBB, Clerk deeds, JTA GTFS, OSM POI.
- [ ] Record throughput / anti-bot / bulk-vs-runtime feasibility per source.

**Verify:** `docs/duval-county-findings.md` complete (appraiser, parcel-id, permit vendor, bulk
sources, usage-type vocabulary, feasibility, risks).
**Commit:** `docs/duval-county-findings.md`.

## Task 2: Seed data

**Drives:** `oracle` → `county-seed-data`.

- [ ] Produce the Duval seed CSV (RE# as TEXT, padded to 10 — assert non-empty appraiser lookups
      before any full run) from the DCPA roll (preferred) / FDOR NAL (fallback); stage to the seeds bucket.

**Verify:** seed row count reconciles vs the source roll; 0 malformed RE#; sample lookups non-empty.
**Commit:** seed provenance note in `infra/run-records/`.

## Task 3: Appraisal onboarding

**Drives:** `oracle` → `county-appraisal-onboarding`.

- [ ] Author the Duval appraiser capture (`transform/duval/browser-flow.json`) — access mode per the
      discovery findings; per-county prepare queue/flags.

**Verify:** a single parcel completes Prepare (capture ZIP produced with `address.json`, `parcel.json`,
`captures/*.html`).
**Commit:** `transform/duval/browser-flow.json`.

## Task 4: Transform handler

**Drives:** `oracle` → `transform-v2-builder`.

- [ ] Author `transform/duval/handler.js` (ESM) — read the prepared captures, write lexicon-aligned
      entity + relationship outputs via the helper APIs; package as `--transform-zip`.

**Verify:** `elephant-cli transform --transform-version 2` on a prepared ZIP produces a valid output
ZIP for a sample of usage-type-diverse parcels.
**Commit:** `transform/duval/handler.js`.

## Task 5: Validate transform (GATE)

**Drives:** `oracle` → `validate-county-transform`.

- [ ] Prove 100% field coverage on 10–20 usage-type-diverse parcels: diff raw-capture fields vs
      lexicon output, classify gaps, verify `county_jurisdiction`, reconcile distinct-folio count vs seed.

**Verify:** the coverage gate passes (no unexplained field gaps). **Do not scale before this passes.**
**Commit:** validation report in `infra/run-records/`.

## Task 6: Ingest run (Lambda, us-east-1)

**Drives:** `oracle` → `county-ingest-run` (+ `county-permit-adapter` for `adapters/duval-jaxepics.mjs`,
+ `sunbiz-corporate-ingest`, + `bbb-harvest`), monitored with `monitoring-county-ingestion`.

- [ ] Pilot batch → source-feasibility gate → scaled run. Seed/geo/Sunbiz full; appraiser detail +
      permits sampled commercial-first. Scraping/transform run in Lambda (us-east-1).

**Verify:** per-parcel chain (prepare → transform → eligibility → permits → Neon rows); queue/S3/Neon
counts and ETAs from monitoring; honest coverage recorded.
**Commit:** run summary + coverage counts in `infra/run-records/`.

## Task 7: Load + reconcile (canonical entities)

**Drives:** `oracle` → `query-db-loading-matching`.

- [ ] Load appraisal/permits/Sunbiz/BBB into Neon; cross-match by folio (`request_identifier`) +
      normalized address hash; link company↔owner and contractor↔permit; preserve `source_payload`,
      `source_uri`, `page_sha256`, `collected_at`.

**Verify:** row counts reconcile per source; folio is 1:1; provenance present on every record.
**Commit:** load/reconcile summary in `infra/run-records/`.

## Task 8: Enrichment (geo/derived facts in Neon)

**Files:** `enrich/walking-distance.ts`, `enrich/water-view.ts`, `enrich/roof-age.ts`,
`enrich/regional-owner.ts`.
**Interfaces produced:** per-property boolean/banded facts written to Neon columns — `near_transit`,
`near_starbucks`, `dist_band`, `water_view`, `roof_age_years`, `regional_owner` — computed from raw
coordinates (FDOR cadastral centroids) + POI (JTA GTFS, OSM/Overpass) + permit dates + owner locality.

- [ ] Walking-distance: parcel centroid → nearest JTA stop / Starbucks POI → band.
- [ ] Water-view: parcel polygon vs water layer → adjacency/distance.
- [ ] Roof-age: latest re-roof permit date → age (flag missing where no permit).
- [ ] Regional-owner: owner mailing ZIP/state vs property.

**Verify:** each fact populated for the loaded set; roof-age coverage documented (partial by design);
distance basis is inspectable per property.
**Commit:** `enrich/*.ts`.

## Task 9: Publish path (DRY-RUN) + coverage

**Drives:** `oracle` → `county-query-table-publish` (dry-run) + dataset-coverage publish.

- [ ] `export:query-table` from Neon → Parquet; `validate:query-table` folio-cardinality gate;
      `publish:query-table --dry-run` (produces CID + MCP wiring; **no upload**).
- [ ] Publish the **non-PII** `dataset-coverage.json` to Filebase/IPFS behind `oracle-dataset-coverage-duval`.

**Verify:** validation gate green; dry-run prints a CID; coverage resolves via `getOracleDatasetInfo`.
**Commit:** `docs/coverage-snapshot.md` + CIDs in `infra/run-records/`.

## Task 10: Deploy MCP

**Drives:** `deploy-open-data-mcp`.

- [ ] Clone `elephant-mcp`; `npm run build:vercel`; deploy to Vercel; wire the county IPNS +
      `PROPERTY_QUERY_TABLE_MAP` (points at the dry-run target) + coverage.

**Verify:** MCP reachable at a stable alias; `getOracleDatasetInfo` returns Duval coverage;
`queryProperties` returns no rows (by design — decision record §5).
**Commit:** MCP config in `apps/agent/` (no secrets).

## Task 11: Retrieval layer

**Drives:** `build-rag-systems` / `alakazam`.

- [ ] Index the real records into OpenSearch (us-east-1) with Bedrock embeddings; expose retrieval
      for semantic/exploratory questions with source-backed evidence.

**Verify:** a set of natural-language probes retrieves the expected records with citations.
**Commit:** retrieval config + index build script.

## Task 12: Hosted UI + agent

**Drives:** `metagross` → `build-frontend-backends` (Amplify us-east-2 + tRPC/Lambda) + `build-ai-agents`.

- [ ] `apps/web/` (Next.js → Amplify): pipeline-run summary, records-by-source (all 6 categories incl.
      contractor) with provenance/timestamps, entity/relationship exploration, per-criterion query views.
- [ ] `apps/api/` (tRPC/Lambda): server-only reads of Neon (full data, behind auth); PII-redacting logs.
- [ ] `apps/agent/`: retrieval-grounded + SQL agent over Neon — answers the six inquiry workflows with
      source-backed evidence and a "distance calculation basis"; also exposed for Cursor use.

**Verify:** deployed UI reachable behind auth; the agent answers each of the six workflows on real
records; DuckDB query layer demonstrable; IPFS CIDs shown (from dry-run/coverage).
**Commit:** `apps/web/`, `apps/api/`, `apps/agent/`.

## Task 13: Monitoring + coverage finalization

- [ ] Surface the run summary (`monitoring-county-ingestion`) in the UI pipeline-run view; finalize
      `docs/coverage-snapshot.md` (per-source completeness + documented speed limitations).

**Verify:** UI run-summary matches the recorded counts; coverage snapshot is honest and complete.
**Commit:** finalized `docs/coverage-snapshot.md`.

## Task 14: Self-assessment + PR

- [ ] Self-assess with `slowking` against the assignment (per the client's guidance); address findings.
- [ ] Record credentials + access instructions for the hosted runtime in the PR body.
- [ ] Capture the demo video (UI + agent answering the workflows on real Duval records; DuckDB layer;
      IPFS CIDs; MCP-ready).
- [ ] Open the PR from `feat/duval-pipeline` → the assignment repo.

**Verify:** the deployed runtime is reachable with the provided credentials; the demo shows the six
workflows on real data.
**Commit / PR:** final PR with video + access instructions + coverage snapshot.

---

## Self-review (spec coverage)

- Loaded coverage at realistic scale → Tasks 2, 6 (full seed/geo/Sunbiz + sampled per-parcel).
- Canonical entity & relationship modeling → Task 7.
- Source provenance → Tasks 2, 6, 7 (provenance columns + manifest).
- Retrieval-grounded, source-backed answers → Tasks 11, 12.
- Exploration UI → Task 12.
- Six inquiry workflows over real records → Tasks 8 (facts) + 12 (answering).
- IPFS / DuckDB / MCP → Tasks 9, 10 (dry-run publish + coverage + deployed MCP).
- Contractor category → Task 6 (`bbb-harvest`).
- Deployed runtime + credentials + demo → Task 14.
