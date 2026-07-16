# Duval County — load + reconcile record (canonical entities)

Cross-source entity reconciliation of the data already loaded into the Neon query DB
(`query-db-loading-matching`). This stage does **no scraping or re-loading** — it links the
canonical entities across the four source tracks and formalises each link so the join is
deterministic and inspectable. Keys: **folio (`request_identifier`) + normalized address hash**,
per the design's canonical entity model.

## Source row counts (by `source_system`)

| Table | Rows | `source_system` |
|---|---|---|
| `properties` | 373 | `duval_appraiser` |
| `addresses` | 373 | `duval_appraiser` |
| `ownerships` | 457 | `duval_appraiser` |
| `people` | 161 | `duval_appraiser` |
| `companies` | 296 | `duval_appraiser` |
| `property_improvements` (appraiser building improvements) | 1,355 | `duval_appraiser` |
| `property_improvements` (JaxEPICS permits) | 1,604 | `duval_jaxepics` |
| `business_reputation_profiles` (BBB) | 14 | `duval_bbb` |
| `contractor_quality_scores` (BBB) | 14 | `duval_bbb` |
| `geometries` (coordinates) | 169 | `duval_geo_census` |
| `business_registrations` (Sunbiz) | 0 | — (accepted gap, IP-reputation block) |

## Folio integrity (the spine)

`properties` is keyed 1:1 on the folio (`request_identifier`, stored as TEXT with leading zeros
preserved). Verified: **373 rows, 373 distinct folios, 0 NULL folios, 0 duplicate folios.** Duval
loaded the property spine only (no `parcels` rows), so folio integrity is asserted on
`properties.request_identifier`, which is the true 1:1 key.

## Reconciliation results (per relationship)

### 1. owner → property
Already linked at load and verified: **457 / 457 ownerships carry `property_id`**, covering all
**373 distinct properties** (161 person owners + 296 company owners = 457, i.e. every ownership
resolves to exactly one owner entity). 0 dangling FKs.

### 2. permit → property (formalised via normalized address hash) — CRITICAL
The JaxEPICS permit "RE Number" is **not** the appraiser 10-digit RE#, so permits are matched to
the appraiser property by **situs address**. The Task 6 loader linked all 1,604 permits by
street-number only, which over-links (a single street number returns permits from several distinct
streets). This stage rebuilds the linkage from a **deterministic normalized situs-address hash** so
it is inspectable and precise, and stamps `property_match_method` / `property_match_confidence`:

| Confidence | Permits | `property_id` | Meaning |
|---|---:|---|---|
| `high` | **1,472** (91.8%) | set | situs key matches exactly one loaded property |
| `no_match` | 91 (5.7%) | NULL | situs address is not among the 373 loaded parcels |
| `ambiguous` | 41 (2.6%) | NULL | situs street key matches ≥2 loaded parcels (multi-suite buildings) |

- `property_match_method = 'situs_address_hash'` stamped on **100 % (1,604)** of the permits.
- The 1,472 high-confidence permits also carry `address_id` (permit → address → property is explicit).
- **72 distinct properties** carry ≥1 confirmed permit; **265 roofing permits** total, **220 linked**
  to a property (these feed the roof-age enrichment).
- Unlinking the 132 low-confidence rows follows the kit's own matching principle — *write FK links
  only at high confidence; otherwise leave candidates unlinked for review* — and raises precision
  over the loader's street-number-only join.

**Normalized situs-address hash (deterministic, reproducible).** From `work_location` (permit) and
`addresses.normalized_address_key` (property): lowercase → drop text after the first comma (unit
tail) → non-alphanumeric to space → strip the trailing `<city> fl <zip>` (city set:
Jacksonville / Jacksonville Beach / Atlantic Beach / Neptune Beach / Baldwin) → key =
`<house-number> ` + street-core tokens **sorted alphabetically** with directionals (`n/s/e/w/…`),
street-type suffixes (`st/rd/ave/blvd/…` and long forms), single-character tokens, and pure-numeric
unit tokens removed. Sorting neutralises directional position (`old kings rd s` = `s old kings rd`);
suffix/abbreviation folding neutralises `blvd`↔`boulevard`. The key is a pure function of the source
address, so the join is re-derivable by anyone from the loaded columns.

### 3. company ↔ owner
The 296 owner-companies are the appraiser owner entities. Verified: **296 / 296 companies are
referenced by an ownership** (`owner_company_id`), **0 orphan companies, 0 dangling FKs**. Note: 296
company rows resolve to 261 distinct normalized names — 35 rows are the same company owning multiple
parcels, loaded as per-parcel source records. These are **not** destructively merged (each row
preserves its own per-parcel provenance / `source_record_key`); the normalized-name link is available
for deduplicated views without discarding provenance.

### 4. contractor ↔ permit — documented source gap
**0 links, and the gap is in the source, not the match.** The JaxEPICS public permit payload carries
only `{address, date_issued, jaxepics_key, permit_number, permit_type, proposed_use, status,
structure_type, work_type}` — **no contractor / licensed-professional field** (`licensed_professional`
and `applicant` are NULL on all 1,604 permits; `permit_contacts` = 0 for JaxEPICS). With no permit-side
contractor name there is nothing to match the 14 BBB contractor profiles against; the BBB firms
(roofers / general contractors) are also disjoint from the 296 appraiser owner-companies (0 overlap by
normalized name). The BBB contractor entities and their quality scores remain first-class and keyed by
normalized name, ready to link the moment a permit source that exposes the contractor is added.

### 5. coordinate → property
Linked deterministically by folio: `geometries.request_identifier = properties.request_identifier`.
**169 / 169 geometries now carry `property_id`** (0 before this stage), covering 169 distinct
properties.

## Provenance coverage

Every reconciled record preserves its provenance; no provenance was dropped during matching (the
writes only set link FKs and match method/confidence).

- **Universal columns present on 100 % of every reconciled record**: `source_system`,
  `source_record_key`, `source_payload`, `loaded_at`.
- **`source_uri` / `source_http_request` pair**: appraisal tables carry `source_artifact_uri` (100 %);
  BBB carries `profile_url` + `source_retrieved_at` (100 %); permits carry `source` + `retrieved_at`
  (100 %) plus the `jaxepics_key` in the payload.
- **`page_sha256` / `source_record_hash` pair**: present on the appraisal tables (properties,
  ownerships, companies, people, addresses, appraiser improvements — 100 %); **absent on BBB,
  contractor scores, geometries, and JaxEPICS permits** — those sources did not retain a page hash.
  Records stay fully traceable via `source_system` + `source_record_key` + `loaded_at` + payload.
- **Minimal-provenance note**: `geometries` (US Census batch geocoder) carry `source_system`,
  `source_record_key`, folio, and `loaded_at` only — the geocoder response body was not retained
  (`source_payload` empty). Sufficient to trace, not to re-derive the geocode.

## Honest gaps

- **Sunbiz** business registrations remain 0 (accepted upstream IP-reputation block; documented in the
  ingest record). The owner-company graph is non-empty from the appraiser, so reconciliation is not
  blocked.
- **contractor ↔ permit** cannot be established from the current sources (no contractor field in the
  JaxEPICS permit record).
- **132 permits** (91 no-match + 41 ambiguous) are deliberately left unlinked rather than asserted at
  low confidence.
- `page_sha256` / `source_record_hash` is not carried by the BBB, geometry, or JaxEPICS-permit sources.

## Method

Driven through `query-db-loading-matching` against the Neon query DB (`elephant-query-db`,
us-east-1). Deterministic keys (folio + normalized address hash), idempotent updates (each write is
safely re-runnable and only sets link FKs / match metadata), `source_payload` and all provenance
columns preserved. No scraping, no re-load, no schema migration.
