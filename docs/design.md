# Oracle Property Intelligence Platform — Duval County, FL — Design

**Assignment:** Oracle Property Intelligence Platform Pipeline — Duval County, FL

## 0. Design principle — trace every decision to the acceptance criteria

Every decision below traces to an explicit assignment requirement. The design centers on six
outcomes the acceptance criteria and demo call for:

1. **Loaded dataset coverage at realistic scale** — real records, run "until all available county
   data is uploaded" and "pass the demo using real uploaded county records" (README L12, L42).
2. **Canonical entity & relationship modeling** across sources — "reconcile duplicate entities across
   all uploaded datasets" (README L20).
3. **Source provenance** for ingested records — "preserve source provenance" (README L21).
4. **Retrieval-grounded, source-backed answers** — "enable agent access to query", "return
   source-backed answers", "demonstrate through an agent query" (README L29, L37, L39).
5. **Exploration UI** — "provide a UI for exploring the uploaded data" (README L30).
6. **Required inquiry workflows over real records** — the six property-intelligence questions
   answered on real data, not mocked (README L31-36, L42).

Each section names the criteria it satisfies.

## 1. Business intent (one sentence)

Ingest real Duval County property/permit/ownership/business/contractor/coordinate records into
canonical, provenance-tracked entities in a hosted query DB, and let a UI and a RAG-backed agent
inquire over them — roof age, water view, ownership age, regional owners, walking distance — with
source-backed evidence, while minimizing Oracle's ongoing infrastructure cost (free-tier hosted
layer).

## 2. Approach — native elephant pipeline, hosted serving, dry-run publication

Clone the public elephant repos, deploy our OWN AWS infra (us-east-1, per the skills), run the county
pipeline for Duval into a hosted query DB, and serve the platform from an **authenticated hosted
layer** (Neon full data + a hosted UI + a retrieval-grounded + SQL agent). The IPFS / DuckDB / MCP
publication path is built and **dry-run validated**; owner PII is **not** uploaded to public IPFS
(rationale in `docs/decisions/ipfs-publication.md`).

```
public elephant repos: oracle-node, elephant-query-db, Counties-trasform-scripts, lexicon, elephant-mcp
        │  [bootstrap-oracle-infra] own AWS account, us-east-1  [§7 shared-resource caveats]
        ▼
Duval sources: roll/NAL · FDOR cadastral geo · Sunbiz · BBB · JaxEPICS/Click2Gov permits · appraiser · deeds · JTA GTFS · OSM POI
        │  [county-discovery → county-seed-data → county-appraisal-onboarding → transform-v2-builder
        │   → validate-county-transform (GATE) → county-ingest-run → query-db-loading-matching]
        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  HOSTED QUERY LAYER — Neon, behind auth (deployed, free tier) │  enrichment computes HERE:
   │  canonical entities (property/owner/permit/company/contractor/│  walking-distance, water-view,
   │  coordinate) + relationships + provenance + coordinates + POI │  roof-age, regional-owner
   └──────────────────────────────────────────────────────────────┘
        │                                              │
        │ hosted UI + agent (behind auth) read Neon    │ publication path — BUILT, DRY-RUN (no PII published)
        │  • SQL: exact filters over canonical entities│  [county-query-table-publish] export → validate → --dry-run (CID)
        │  • retrieval: grounded source-backed answers │  [deploy-open-data-mcp] deploy stateless MCP, wire IPNS
        │  • "distance calculation basis"              │  (donphan/MCP path wired; not populated with PII)
        ▼
  ┌───────────────────────────┐   ← the deployed runtime; answers every required inquiry workflow
  │ HOSTED UI + AGENT (auth)  │     over full real data. Credentials provided in the PR.
  │ full data; creds in PR    │
  └───────────────────────────┘
```

**Serving model.** The deployed, authenticated hosted layer (Neon + UI + agent) answers every
required inquiry workflow over the full real data. The IPFS / DuckDB / MCP path is implemented and
exercised as a **dry-run** — the export produces the artifact and its content identifier (CID), the
validation gate passes, and the MCP is wired — to demonstrate decentralized-storage and MCP
readiness, but no property-owner PII is uploaded to public IPFS. The **non-PII dataset-coverage
artifact IS published**, so the MCP's `getOracleDatasetInfo` returns the county's real coverage
(record counts, sources); only the PII query-table is deferred, so `queryProperties` returns no rows.
Geo/derived facts are computed in the hosted layer, not injected into the kit's fixed query-table
schema, so the kit exporter stays untouched (zero fork). The publication-deferral rationale (Florida
address-exemption statutes, unbounded irreversibility risk, aggregation, data minimization) is
recorded in `docs/decisions/ipfs-publication.md`.

## 3. Answering layer — retrieval-grounded + SQL (README L29, L37, L39)

The assignment requires an agent that queries the data and returns **source-backed answers** to
natural-language questions (README L29/L37/L39). SQL alone is brittle for exploratory/semantic
questions and for grounding a narrative answer in evidence. So the agent is a **hybrid**:

- **SQL path** (README L27/L50 requires a DuckDB query layer; exact predicates need it): DuckDB/SQL
  over the canonical entities for precise structured filters ("roof >15y AND ownership >10y"). Primary
  surface: the hosted agent's SQL over Neon (full data, behind auth); the kit
  `donphan`/`queryProperties` MCP surface is also wired (dry-run). SQL is right for exact
  numeric/boolean filters.
- **Retrieval path:** a real retrieval layer (`build-rag-systems` / `alakazam` — OpenSearch +
  Bedrock embeddings) over the real records, for semantic/exploratory questions and for grounding
  narrative answers in retrieved records with source-backed evidence ("strong candidates for further
  review based on ownership age, roof age, and location signals").

The two are complementary: SQL answers "which properties match these exact criteria," RAG retrieves
relevant records and grounds the reasoned answer. Both the structured DuckDB query layer and
source-backed retrieval are satisfied.

## 4. Canonical entity & relationship model (README L20)

First-class, because the assignment requires reconciling duplicate entities across all uploaded
datasets (README L20). Entities and cross-source links, keyed on folio
(`request_identifier`) + normalized address hash:

- **Property** (folio) ← the spine; **Owner** (name + mailing) ; **Permit** (permit# + source) ;
  **Company** (Sunbiz document#) ; **Contractor** (BBB, keyed off permit contractors) ;
  **Coordinate** (parcel centroid from FDOR cadastral).
- **Relationships:** owner→property, permit→property, company↔owner (name/address match),
  contractor↔permit (contractor name), coordinate→property.
- **Provenance:** every record carries `source`, `source_uri`, `page_sha256`, `collected_at`
  via a per-page provenance manifest (source URI, page hash, fetched-at).

`query-db-loading-matching` does the load + cross-source matching; the UI and RAG both traverse these
entities/relationships.

## 5. Pipeline stages & agent orchestration

The assignment values practical use of agentic AI and the kit. So the build is driven by the kit
**agents**, each stage by its skill. Full onboard-county sequence:

| # | Stage | Skill(s) | Agent | Output |
|---|---|---|---|---|
| 0 | Bootstrap infra | `bootstrap-oracle-infra` | `oracle` | AWS stacks, seeds bucket, secrets; Neon out-of-band |
| 1 | Discovery | `county-discovery` | `oracle` | `duval-county-findings.md` (appraiser/permit/GIS sources, parcel-id format, anti-bot posture) |
| 2 | Seed | `county-seed-data` | `oracle` | `s3://<own-bucket>/duval.csv` parcel list (full 406k) |
| 3 | Appraisal onboarding | `county-appraisal-onboarding` | `oracle` | Duval browser-flow / fetcher |
| 4 | Transform | `transform-v2-builder` | `oracle` | Duval handler.js (if not already in Counties-trasform-scripts) |
| 5 | **Validate (GATE)** | `validate-county-transform` | `oracle` | 100% field-coverage proof on 10-20 diverse parcels — **gate before scaling** |
| 6 | Ingest run | `county-ingest-run` | `oracle` | pilot → full backpressure run → Neon |
| 7 | Load + match | `query-db-loading-matching` | `oracle` | canonical entities + relationships in Neon |
| 8 | Enrich | (custom, in Neon) | `oracle` | walking-distance/water-view/roof-age/regional-owner facts |
| 9 | Publish | `county-query-table-publish` | — | query-table: `--dry-run` (CID, no PII); non-PII dataset-coverage published (`getOracleDatasetInfo`). See decision record. |
| 10 | **Deploy MCP** | `deploy-open-data-mcp` | — | clone `elephant-mcp`, `build:vercel`, deploy → stable alias; wire IPNS |
| 11 | RAG layer | `build-rag-systems` / `alakazam` | `alakazam` | OpenSearch+Bedrock retrieval over real records |
| 12 | Hosted UI + agent | `build-frontend-backends`, `build-ai-agents` | `metagross` | Next.js UI + agent behind auth |
| 13 | Monitor | `monitoring-county-ingestion` | `oracle` | run summary (feeds UI pipeline-run view) |
| 14 | Self-assess | — | `slowking` | self-assessment before submission (per the assignment) |

`arceus` (router) plans the agent lineup; `use-oracle`, `use-elephant-query-db`, `use-elephant-mcp`
are the operating guides for driving `oracle`, reading Neon, and the MCP respectively.

## 6. Components (one responsibility each)

1. **infra/** — `bootstrap-oracle-infra` (own AWS, us-east-1). Neon created separately by you (§7).
2. **ingest/** — Duval source adapters (letter adapted, pattern kept): seed (DCPA roll/NAL, full
   406k), geo (FDOR cadastral CO_NO=26, full), Sunbiz (SFTP, 322xx), **BBB (`bbb-harvest`, contractor
   — verify Duval reachability)**, permits (JaxEPICS + Click2Gov), appraiser detail, deeds, POI (JTA
   GTFS + OSM).
3. **entities/** — canonical entity + relationship model + provenance (§4).
4. **enrich/** — geo/derived facts computed in our own layer in Neon, NOT added to the kit's fixed
   query-table schema — so we never modify ("fork") the kit's exporter; it is used exactly as shipped.
5. **hosted-layer/** — Neon (full data), behind auth, deployed (free tier). Server-only Neon access
   (raw parameterized SQL via `pg` over the kit loader's schema — no ORM); PII-redacting structured
   logs. The serving layer (tRPC API Lambda + Amplify web) runs in **us-east-2**, distinct from the
   us-east-1 ingest pipeline above.
6. **rag/** — `build-rag-systems`/`alakazam`: OpenSearch + Bedrock embeddings over real records.
7. **publish path (dry-run)** — `county-query-table-publish` export → validate → `--dry-run`; no PII
   uploaded to public IPFS (see `docs/decisions/ipfs-publication.md`).
8. **mcp/** — `deploy-open-data-mcp`: deploy stateless elephant MCP, wire IPNS; donphan SQL surface
   (wired; dry-run).
9. **ui/** — `metagross`/`build-frontend-backends`: pipeline-run summary, records-by-source (all 6
   categories incl. contractor), entity/relationship exploration, per-criterion query views. Reads
   Neon behind auth.
10. **agent/** — hosted retrieval-grounded + SQL agent (`build-ai-agents`) over Neon with source-backed
    evidence + "distance basis".

## 7. Risks & operational constraints

- **County-portal geo-blocking:** Jacksonville/Duval `*.coj.net` portals reject non-US connections at
  the network layer. This is handled by the kit's architecture: **scraping and transform run in AWS
  Lambda (us-east-1, a US IP) — not on the operator's laptop** (`county-ingest-run`). So the
  production ingestion is not geo-blocked, and the operator drives AWS over the API **without a VPN**
  (avoiding AWS-side IP re-verification). Fetched data lands in **S3** (raw artifacts) → transform →
  **Neon** (query DB) — never in the repo. A US-egress VPN is only needed for optional laptop-side
  recon/probing, not for the run.
- **AWS region:** run in `us-east-1`, matching the elephant skills (they reference a us-east-1-pinned
  AMI and a us-east-1 code fallback). Keep the region consistent with the skills rather than diverging.
- **Neon provisioning:** you create the Neon database yourself (via Vercel's Neon integration or
  neon.tech directly) and provide its `DATABASE_URL`; the AWS infra bootstrap does **not** create the
  database — it only stores that URL as a secret for the Lambdas. So Neon is a separate manual
  provisioning step, not part of the CloudFormation stack. Free tier fits the dataset.
- **Fresh-account shared-resource caveats** (the infra bootstrap verifies but does not create these):
  a seeds bucket with a globally-unique name (the default name cannot be owned on a new account —
  create and pass your own); a GitHub token secret for the transform-scripts repo; the placeholder
  blockchain secrets the CloudFormation template requires even for archive-only ingestion.
- **AWS vCPU quota — not on the critical path for this scope.** Ingestion and transform run in Lambda
  (unaffected by the EC2 vCPU quota). The `c7g.2xlarge` (8 vCPU) that a new account's default limit (1)
  would block is only for a **big-county consolidation publish** — which this scope does not do
  (dry-run + sampled per-parcel sources). The lighter query-table export runs on the laptop or a small
  in-region instance within default quotas. So no quota-increase request or wait is required; it would
  only matter for a future full-county real publish.
- **Scale:** the assignment requires all available data at realistic scale; toy/sparse data does not
  demonstrate the outcome. Seed/geo/Sunbiz full 406k; expensive per-parcel sources (appraiser/permit)
  to **as much as time allows** (target several–tens of thousands), commercial-first, with an honest
  coverage snapshot. Measure appraiser/permit throughput (p50/p95) on a US-based runner to set the max.
- **RE# leading-zero trap:** load parcel id as TEXT, pad to 10; assert non-empty lookups before any
  full run.
- **Appraiser portal transition (Mar 2026):** legacy `paopropertysearch` vs new
  `duvalcountypropertyappraiser.org` — pin which the pipeline targets.
- **Permit fragmentation:** ≥3 vendors (JaxEPICS + Click2Gov + beach cities). One adapter per vendor.
- **Deployed-runtime gate:** the hosted UI + agent (and the deployed MCP) must be reachable, not
  local; they stay up for the demo. **Working credentials in the PR** — the assignment requires clear
  access to a working runtime, so the PR must include credentials the reviewer can use to reach it.

## 8. PII & the publication boundary

The pipeline's IPFS artifacts (`county-query-table-publish`, `county-open-data-publish`) carry
per-property owner PII (owner names + addresses). This platform does **not** publish that PII to
public IPFS: the publication path is built and exercised as a **dry-run** (artifact + CID + MCP
wiring), and full data is served only from the authenticated hosted layer. The rationale — Florida
address-exemption statutes (§119.071(4)(d); §§741.401–741.409, §741.465), the unbounded and
imperfectly reversible persistence risk of content-addressed storage, aggregation vs. practical
obscurity, and data minimization — is recorded in `docs/decisions/ipfs-publication.md`.

**The deployed MCP is not empty.** The non-PII **dataset-coverage** artifact (per-source record
counts, no owner data) IS published, so the MCP's `getOracleDatasetInfo` returns the county's real
coverage; only the PII query-table is deferred, so `queryProperties` returns no rows for the county.
This is explained at the point of use in the decision record (§5 there).

Geo/derived facts (walking-distance, water-view) are computed in the hosted layer from raw
coordinates + POI and answered by the hosted UI/agent with a "distance calculation basis"; they are
not injected into the kit's fixed query-table schema, so the kit exporter is untouched (zero fork).
The README (L63/L70) requires the *system/agent* to answer using coordinates — not the artifact to
carry them.

## 9. Engineering standards

Per `apply-engineering-guidelines` + `integrate-ci-cd`: TypeScript throughout; a Zod-validated
boundary pattern (Zod-validate before any SQL/export; queries throw on failure and the tRPC layer
surfaces typed errors); deterministic
hashing for record ids; coverage always derived live from the DB, never hardcoded; server-only DB
access (DATABASE_URL never in the client bundle); PII-redacting structured logs (drop owner
names/addresses, keep shape); a per-page provenance manifest (source URI, page hash, fetched-at)
threaded loader→DB→UI; CI green-gate (typecheck + tests, offline); responsive design tests
(`responsive-design-tests`).

## 10. Deliverables

- PR to the assignment repo, including `docs/decisions/ipfs-publication.md` (the PII-publication decision).
- Demo video: the hosted UI + agent answering the six inquiry workflows on real Duval records; the
  DuckDB query layer; the publication path exercised as a dry-run (artifact + CIDs, MCP wired).
- Hosted runtime: hosted UI + agent behind auth (and the deployed MCP), **with working credentials in
  the PR**.
- Coverage snapshot: per-source completeness + speed limitations (documents the honest scale).
- Self-assessed with `slowking` before submission.
