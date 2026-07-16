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
| `latitude` / `longitude` | 169 / 373 | geocoded subset (numbered situs parcels) |
| `exterior_wall_material` | 161 / 373 | structures exist only on improved parcels |
| `has_permits` / `permit_count` | 373 / 373 | 78 parcels carry ≥1 linked permit |
| `property_cid` | 0 / 373 | no consolidation manifest this milestone (see below) |
| `hoa_flag` | 0 / 373 | reserved placeholder null for every county (no HOA source ingested) |

- **`property_cid` is null for every row** because the property-consolidation export
  (`county-open-data-publish`) — which produces the `propertyId → CID` manifest the query-table
  export left-joins — is a separate story and was not run. The export still succeeds; rows just
  do not carry a link back to a consolidated property CID.

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
