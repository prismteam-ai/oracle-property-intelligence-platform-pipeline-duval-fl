# Duval County — dataset coverage snapshot

Honest, non-PII coverage of what is loaded in the Neon query DB and published as public
coverage metadata. Aggregate counts and sources only — no owner-level data. This is the
snapshot the MCP `getOracleDatasetInfo` tool reports (via `DATASET_COVERAGE_MAP`) so a
consumer can qualify any answer by how complete the underlying data is.

Published artifact: `.dataset-coverage/duval/dataset-coverage.json`
(public IPFS CID `QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H`; see
`infra/run-records/publish.md`).

## Per-source completeness

| Source | Ingested | Expected (denominator) | Completeness | Status |
|---|---:|---:|---:|---|
| appraisal (property records) | 373 | 398,315 | 0.09% | sampled, commercial-first |
| permits (JaxEPICS) | 1,604 | — | n/a | sampled (linked to the loaded parcels) |
| bbb (contractor reputation) | 14 | — | n/a | category sample |
| sunbiz (business registrations) | 0 | — | 0% | blocked at source (documented below) |

- **`expected_count` is set only where a real denominator exists.** The appraisal denominator
  is the full 2025 Duval real-property roll (398,315 parcels — staged in full as the seed).
  Permits and BBB have no published county-wide total to divide by, so their `expected_count`
  is left null (the MCP reports the ingested count without a percentage rather than implying a
  false denominator).
- The load is a **commercial-first sample by construction** — the low RE# range is Duval's
  commercial/industrial roll. Top usage types in the loaded set: Commercial, OfficeBuilding,
  RetailStore, AutoSalesRepair, OpenStorage, Industrial.

### A note on the permits count (honest bookkeeping)

The kit's generic coverage counter attributes every `property_improvements` row whose
`source_system` begins `duval_` to "permits", which yields **2,959** — because it also sweeps
in **1,355 appraiser building-improvement records** (renovations/additions recorded by the
appraiser, which are part of the *appraisal* dataset, not a permit harvest). The coverage row
is corrected to the **1,604** rows that are the actual JaxEPICS permit harvest
(`source_system = 'duval_jaxepics'`). A DuckDB aggregate over the query table independently
sums 1,604 linked permits across 78 permit-active parcels, cross-confirming the figure.

## Query-table column coverage (the published columnar index)

The query-table schema is stable across counties, but **column population varies by county** —
these are the non-null counts over the 373-row Duval query table (measured with DuckDB):

| Column | Non-null | Note |
|---|---:|---|
| `request_identifier` (folio) | 373 / 373 | 1:1 spine; the validation gate key |
| `address_zip` / `address_city` / `address_street` | 373 / 373 | situs from the structured address rows |
| `assessed_value` / `market_value` | 373 / 373 | from the appraiser tax roll |
| `latitude` / `longitude` | 240 / 373 | geocoded subset — expanded from 169 by the pre-demo permit-parcel geocode (see below) |
| `exterior_wall_material` | 161 / 373 | structures exist only on improved parcels |
| `has_permits` / `permit_count` | 373 / 373 | 78 parcels carry ≥1 linked permit |
| `property_cid` | 0 / 373 | no consolidation manifest this milestone (see below) |
| `hoa_flag` | 0 / 373 | reserved placeholder null for every county (no HOA source ingested) |

- **`property_cid` is null for every row** because the property-consolidation export
  (`county-open-data-publish`) — which produces the `propertyId → CID` manifest the query-table
  export left-joins — is a separate story and was not run. The export still succeeds; rows just
  do not carry a link back to a consolidated property CID.

## Enrichment fact coverage (derived facts, computed in the Neon layer)

Enrichment facts are computed over the geocoded parcels and the permit-linked parcels — one
`property_enrichment` row per parcel, each fact carrying an inspectable `*_basis`. Current
non-null coverage:

| Fact | Populated | Positive | Basis |
|---|---:|---:|---|
| `roof_age_years` | 51 | — | linked JaxEPICS re-roof permit date vs. now |
| `water_view` | 240 | 86 true | distance to nearest OSM water feature (≤150 m) |
| `near_transit` / `dist_band` (walking) | 240 | 110 near-transit | distance to nearest JTA GTFS stop + OSM Starbucks |
| `regional_owner` | 372 | in_county 241 / in_state 62 / out_of_state 69 | owner mailing locality vs. Duval situs |

**Full-fact parcels: 50.** Fifty parcels carry roof age **and** water proximity **and** walking
distance **and** a regional-owner band together (41 in_county / 5 in_state / 4 out_of_state). Before
the pre-demo fix this set was **empty**: the first geocoded set (169) and the JaxEPICS roofing-permit
set were disjoint, so no single parcel answered every geo/permit workflow. The compound "near
transit **and** regional owner" query now returns real parcels — 110 near-transit parcels carry an
owner-locality band (32 with a non-local in-state/out-of-state owner), e.g. RE# `0138590100`
(waterfront commercial, ~87 m to a JTA stop, owner mailing in **AZ** — out-of-state).

## Pre-demo data fixes (no re-scrape)

Two enrichment gaps were closed against data **already in Neon** — no portal was re-scraped:

- **Permit-parcel geocode (169 → 240).** The 72 permit-bearing parcels carried a situs address
  in Neon (`addresses.source_payload.unnormalized_address`) but no coordinate. Those addresses
  were geocoded via the same public **US Census batch geocoder** used for the first 169
  (`enrich/geocode-permit-parcels.ts`): 71 of 72 matched and were loaded into `geometries`; the
  walking-distance and water-view enrichments were re-run over the expanded set. This is what
  produced the 50 full-fact parcels above. (The earlier dry-run query-table export was built at
  the 169-coordinate state; a re-export would carry all 240.)
- **`regional_owner` — re-loaded from the transform output (372 / 373 banded).** The banding needs
  the owner **mailing** locality. The appraiser transform already extracts it
  (`transform/duval/handler.js`, `lblMailingAddressLine…`) and emits a `person_N_mailing_address` /
  `company_N_mailing_address` entity in every parcel's `transformed_output.zip`, but the query-DB
  load collapsed addresses to one **situs** row per folio, so the mailing never landed in Neon.
  `enrich/reload-owner-mailing.ts` re-loads those already-produced transform outputs (a **re-load,
  not a re-scrape**) and materializes the owner mailing locality into `addresses` +
  `ownerships.mailing_address_id`, mapped to each owner by the exact `source_record_key` stem
  (`duval_appraiser:<folio>:<person|company>:<stem>`). `enrich/regional-owner.ts` then bands each
  parcel against the Duval, FL situs: **372 / 373** banded — **241 in_county, 62 in_state, 69
  out_of_state**. Banding is city-first (Duval is the consolidated City of Jacksonville, so its
  municipalities are a complete in-county signal) with a curated Duval 5-digit ZIP fallback; a
  coarse 3-digit ZIP prefix is deliberately **not** used, because `320xx`/`321xx` also cover the
  neighbouring counties (e.g. Nassau 32009 Bryceville → correctly in_state, not in_county). The
  full mailing line is stored only in the hosted Neon layer (owner PII by design); the published
  enrichment fact keeps only owner state + ZIP3.

## Speed / feasibility limitations (why the per-parcel sources are sampled)

- **Portals geo-block non-US egress.** The Duval appraiser and permit portals reject non-US
  connections at the network layer, so scraping/transform run server-side from a US region, not
  from a workstation.
- **Appraiser detail is the throughput bottleneck, not the seed.** Measured throughput is
  ~1 parcel/second at a safe portal concurrency (~3,600/hour incl. prepare + transform +
  validate). The full 398,315-parcel roll projects to ~110 hours at that rate (~13–15 hours
  ramped to the concurrency used on comparable counties) — beyond the delivery window, hence the
  documented commercial-first sample. The backpressure-aware seed feeder is in place to run the
  full county when scheduled.
- **JaxEPICS permits require a real browser.** The permit backend is a public JSON API fronted
  by a datacenter-IP block: a plain server-side fetch is rejected (HTTP 403) while a real browser
  passes. The permit "RE Number" is not the appraiser RE#, so permits are joined to parcels by
  normalized situs address.
- **Sunbiz is blocked at source.** `search.sunbiz.org` sits behind a challenge that the
  available egress IP does not clear (HTTP 403 interstitial), i.e. an IP-reputation block, not an
  automation block. No data was fabricated or forced around it. Unblocking needs a residential-IP
  path or the quarterly bulk `cordata.zip` pipeline. The appraiser transform already loaded 296
  owner-companies, so the company-entity graph is non-empty even with Sunbiz pending.

## Cross-source linkage caveats (reflected in the query-table flags)

- **`has_bbb_contractor` is false for every row.** The JaxEPICS permit payload carries no
  contractor / licensed-professional field, so there is nothing to match the 14 BBB contractor
  profiles against on the permit side. The BBB entities remain first-class and keyed by
  normalized name, ready to link the moment a contractor-bearing permit source is added.
- **`has_sunbiz_tenant` is false for every row** — a direct consequence of the Sunbiz block (0
  business registrations loaded).

## What this snapshot is (and is not)

- It **is** aggregate metadata: per-source record counts, load-time bounds, and a real
  denominator where one exists.
- It **is not** owner data. The per-property query table (which carries owner PII) is prepared,
  validated, and dry-run only — it is not published to public IPFS. See
  `docs/decisions/ipfs-publication.md` and `infra/run-records/publish.md`.
