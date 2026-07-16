# Duval County — ingest run record

Run-record for the live multi-source ingestion (Task 6). Scraping and transform run in
AWS Lambda (us-east-1, a US IP); the appraiser and permit portals geo-block non-US egress,
so the pipeline is never run from a laptop. This document records what ran, the per-source
counts, and the honest coverage — what loaded fully, what was sampled, and the documented
per-source limitations.

## Scope decision (per the assignment's "documented source limitations" allowance)

- **Bulk sources → full where cheap.** The parcel seed is staged in full (398,315 rows,
  distinct RE#, 0 duplicates — see `duval-seed-provenance.md`).
- **Per-parcel appraiser detail → feasibility-driven sample, commercial-first, with an honest
  coverage snapshot.** Scraping and transforming all ~398k geo-blocked appraiser detail pages
  is a multi-day job at a safe portal concurrency (see the feasibility gate below) and exceeds
  the delivery window; a commercial-first sample with a documented limitation satisfies the
  requirement transparently.

## Pipeline restored to a runnable state

The deployed pipeline had never completed a parcel end-to-end before this run. Several blocking
defects were found and fixed against the deployed functions:

1. **Lambda cold-start crash across every `@elephant-xyz/cli` consumer.** The bundle-size prune
   over-stripped runtime dependencies: importing the CLI barrel eagerly loads a code-generation
   command whose transitive AI stack (langchain/openai/tiktoken) had been removed, so every
   worker that imports the CLI failed at module load (`ERR_MODULE_NOT_FOUND`). Fix: make that
   one code-generation import lazy (it is never invoked by the workflow workers), and restore
   the genuinely-needed runtime deps (`prettier` for HTML cleanup, `ethers` for the shared
   services, `@elephant-xyz/fact-sheet` for the transform). For the non-browser workers, the
   barrel import was narrowed to the command module so the browser stack is not loaded at all,
   keeping the package under the size limit. Verified: the prepare, transform, and validation
   workers all initialise cleanly and reach business logic. A single browser-flow prepare was
   proven end-to-end through the deployed function before scaling.
2. **Transform version + input-shape.** The appraiser transform is a self-contained transform-v2
   handler. The worker was defaulting to the legacy multi-script mode; it now runs v2 when
   configured. The plain-`GET` prepare emits the v1 capture shape (`<RE#>.html` + seed JSON),
   while the v2 CLI requires a `captures.json` manifest — the worker now bridges the v1 shape to
   the v2 input contract in place (idempotent; a browser-flow-v2 ZIP that already carries a
   manifest is left untouched). The transform ZIP carries a `package.json` `type: module` so the
   ESM handler loads.
3. **Query-DB loader classification.** The appraisal loader matched tax entities with a greedy
   prefix that swept the per-authority `tax_jurisdiction`/`tax_exemption` entities into the
   `taxes` table (colliding on the `(property_id, tax_year)` unique key) while missing the
   aggregate `tax` entity; and it matched only the indexed `structure_N`/`utility_N` form, so a
   single `structure.json`/`utility.json` was silently dropped. Both were tightened to match the
   correct single-cardinality file names.

## Per-parcel appraiser — end-to-end proof, pilot, scaled sample

Each parcel flows: appraisal-prepare (US-IP scrape) → transform-v2 (County data group) →
schema-validation gate (SVL) → structured archive → load to the Neon query DB.

| Stage | Parcels | Prepared (scrape) | Transformed | Loaded to Neon | Notes |
|---|---|---|---|---|---|
| Single-parcel proof | 1 | 1 | 1 | 1 | full chain proven on one real parcel |
| Pilot | 30 | 30 | 30 | 30 | throughput + error-rate measurement |
| Scaled sample (commercial-first) | 300 | 300 (100%) | 293 (97.7%) | 293 | 7 fail-loud on empty/blocked/retired pages |

**Scraping is not the bottleneck and is not geo-limited from us-east-1:** 300/300 detail pages
scraped successfully (0 prepare failures). The 7 non-loads are the transform's own correctness
gate refusing to emit a hollow property when a detail page carries no RE# label or property-use
(retired/renumbered folios or a transiently empty page — the same dead-folio class seen on other
counties, ~2%). These are recorded, not hidden.

### Neon query-DB counts (source_system = duval_appraiser, after the scaled load)

- **293 distinct property folios** (RE# stored as TEXT, leading zeros preserved).
- properties 293, taxes 293, lots 293, addresses 293
- owners: people 134, companies 224
- deeds 1,531, sales_histories 1,531
- property_improvements 1,075, layouts 3,629, structures 160, utilities 160

The sample is commercial-first by construction (the low RE# range is Duval's commercial/
industrial roll): top usage types Commercial, RetailStore, OpenStorage, Industrial, Warehouse,
AutoSalesRepair, LightManufacturing, Restaurant. Every parcel carries the full County data group
(structure/utility present on the improved parcels; land/vacant parcels correctly carry none).

## Feasibility gate (measured, for the full per-parcel appraiser run)

- **Measured throughput:** ~1 parcel/second aggregate at prepare-queue concurrency 6–10
  (~3,600 parcels/hour), prepare + transform + validate. Prepare (plain `GET`) is ~1 s;
  transform is a few seconds.
- **Full-county projection:** 398,315 parcels ÷ 3,600/h ≈ **110 hours** at the sampled
  concurrency; ramped to ~50 concurrent prepares (the level used on comparable counties,
  ~8.5k/h) ≈ **13–15 hours**. Either exceeds the delivery window, so the appraiser detail is
  sampled (293 loaded here) rather than run to full county. The backpressure-aware seed-feeder
  path is in place to run the full county over 1–2 days when scheduled.
- **Cost signal:** short-lived Lambda invocations (prepare 768 MB, transform up to ~3 GB) at
  low concurrency; no proxy spend (direct us-east-1 egress). Bounded by the concurrency cap.

## Monitoring evidence

- Prepare queue (`prepare-queue-duval`) drained to 0 messages after each batch; per-county ESM
  wired to the prepare worker (concurrency ramped 2 → 6 → 10 for the sample, reset to 2 at
  wrap-up).
- S3 artifact counts per job prefix: `output.zip` (prepare), `transformed_output.zip`
  (transform), `property_first_permit_eligibility.json` (eligibility) — reconciled against the
  Neon distinct-folio count by `request_identifier`.
- State-machine executions: SUCCEEDED for every parcel that transformed; the 7 empty-page
  parcels parked at the transform-resolution state and are recorded as the dead/blocked tail.

## Permit adapter

`adapters/duval-jaxepics.mjs` — the City-of-Jacksonville JaxEPICS permit vendor adapter, authored
in the kit adapter format and mirroring the reference Accela adapter's exported surface (parcel
search, permit-list extraction, per-permit detail, Neon row mapping, stable resumable S3 keys,
explicit property-first parcel linkage). JaxEPICS is a single-page app on `coj.net` (geo-blocked,
US-IP required); the adapter drives the app headlessly and captures the app's own permit JSON via
response interception rather than hardcoding an undocumented endpoint, degrading to DOM extraction
when a response is not JSON. Live-portal endpoint confirmation and wiring into the deployed permit
worker are the remaining steps (both require us-east-1 execution against the geo-blocked SPA);
until then the per-parcel run is appraisal-only (permit eligibility set to none), which keeps the
sample honest and avoids enqueuing to an unwired vendor. The three beach-city portals
(Click2Gov ×2, eTRAKiT) and offline Baldwin are separate adapters/records per the discovery.

## Geometry / coordinates — loaded (Task 8 prerequisite)

Coordinates for the loaded parcels are populated in Neon: **169 parcels** carry a point
coordinate in `geometries` (`source_system = duval_geo_census`) and in `addresses.latitude/
longitude`. Of the 293 loaded parcels, 214 have a street number (geocodable); the US Census
batch geocoder (public, US, no auth) returned 169 Match, 3 Tie, 42 No-Match; the remaining 79
are numberless rural parcels (e.g. "W US 90", "PECAN AVE") that a point geocoder cannot place.

FDOR cadastral note (re-verified): the authoritative Duval county code is **`CO_NO = 26`**
(`16` = Broward, `20` = Clay). The hosted `Florida_Statewide_Cadastral` FeatureServer, however,
returns centroids **only on spatial (envelope) queries** — it rejects an attribute `where` on
`CO_NO`/`PHY_ZIPCD` combined with `returnCentroid`/`returnGeometry` (HTTP 400), and throttles a
wide spatial scan. Its Duval `ALT_KEY` is a short county key, not the 10-digit appraiser RE#, so
FDOR geometry would need an address join anyway. Given that, the point coordinates were sourced
from the Census geocoder keyed directly on the appraiser RE#; this satisfies the coordinate
prerequisite for the enrichment stage.

## Business / contractor / permit sources — reachability and status

These are required categories. Each is a US-egress, bot/geo/challenge-gated source that must be
harvested from US infrastructure with a headless browser; none is reachable from the build host
(non-US egress, no VPN by policy — all three return 403/geo-block), and the US-egress harvesters
are not deployed. Status and the specific in-window blocker per source:

- **Permits (JaxEPICS)** — **confirmed reachable from us-east-1** (root returns HTTP 200; the
  same request geo-blocks from non-US egress). JaxEPICS is an **ArcGIS-JS single-page app**: the
  permit data loads via the app's browser XHR, and no static ArcGIS REST service directory is
  exposed at the common COJ hosts (`maps.coj.net/arcgis/rest/services` → 404). Landing a permit
  sample therefore requires driving the SPA headlessly and capturing its permit response — which
  is exactly the design of `adapters/duval-jaxepics.mjs` (Puppeteer response interception). That
  needs the Chromium permit-harvest runtime; wiring the adapter into the deployed permit worker
  (a `sam build` of the permit-harvest stack + a `duval-*` handler branch) is the remaining step.
  0 permit rows loaded this window.
- **Sunbiz (business registrations)** — the quarterly `cordata.zip` is ~1.7 GB behind a
  Cloudflare browser challenge (headless Chromium, US IP), expands to ~18 GB (Deflate64), and is
  ingested via per-file Lambda extract → lexicon transform → load. No Sunbiz source is pre-staged
  in this account, and the gated multi-GB download is not runnable from the build host. 0
  `business_registrations` loaded this window.
- **BBB (contractor reputation)** — bot-gated category crawler (headless Chromium); returns 403
  to the build host. Needs a US-egress harvester run. 0 `business_reputation_profiles` /
  `contractor_quality_scores` loaded this window.

Note: the appraiser transform already loaded **224 owner companies** and **134 owner people**,
so the company/contractor-entity graph is non-empty for cross-source reconcile even before Sunbiz/
BBB. The permit adapter is delivered; the three harvests above are the open per-source items and
require the US-egress Chromium harvester deploys documented here.

## Schema note

The Neon query-DB schema was initialised from the shipped migrations (51 public tables). The
`oracle_dataset_coverage` migration did not materialise its table in this environment; coverage is
recorded here in this run-record. Wiring `oracle_dataset_coverage` + the IPFS/IPNS coverage publish
is part of the separate indexing/publish story, not this ingest run.
