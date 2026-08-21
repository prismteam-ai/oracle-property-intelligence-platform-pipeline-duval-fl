# Duval County, FL — Source Discovery Findings

Source-reconnaissance profile for Duval County (Jacksonville), produced by the
`county-discovery` stage before onboarding to the Oracle ingestion pipeline. This document
is the single index that feeds every later stage (seed data, browser/HTTP flow, transform
scripts, permit adapter, eligibility mapping).

**How sources were probed.** Duval's `*.coj.net` and `*.duvalclerk.com` portals refuse
connections from non-US network egress, so each of those was characterized by fetching the
live URL from a **us-east-1 (US-region) Lambda** and inspecting status, headers, and rendered
body. Non-geo-blocked endpoints (FDOR ArcGIS, OpenStreetMap/Overpass, Sunbiz hosts, JTA,
BBB) were probed directly. Every claim below is grounded in an actual probe; the method is
noted per source. Prior art also exists: an appraisal transform package already ships in
`Counties-trasform-scripts/duval/scripts/` and targets the legacy appraiser front (its DOM
selectors are the `ctl00_cphBody_*` WebForms ids described in §1), so the appraisal side has
been partially solved before and should be reused, not rebuilt.

All four Oracle source categories (property, permits, Sunbiz, BBB) are reachable and
characterized for Duval, plus geometry, deeds, transit, and POI enrichment sources.

---

## 1. Appraiser portal (property)

- **Source:** Duval County Property Appraiser (DCPA).
- **Front resolution (flagged open item — RESOLVED).** Two fronts exist after a ~2026
  redesign; the pipeline targets the **legacy** one:
  - **Legacy `paopropertysearch.coj.net` — PIN THIS.** Live ASP.NET WebForms on
    Microsoft-IIS/10.0. Root `302 → /Basic/Search.aspx`. Per-parcel detail is a plain
    HTTP `GET`:
    `https://paopropertysearch.coj.net/Basic/Detail.aspx?RE=<10-digit RE#>`
    (probed via US Lambda with a real parcel: `?RE=0224370000` → `200`, 67 KB, ~1.1 s cold;
    body carries `#ctl00_cphBody_lblRealEstateNumber` = `022437-0000`,
    `#ctl00_cphBody_lblPropertyUse` = `0100 Single Family`, a sales-history grid, and a
    value summary). No CAPTCHA, no Cloudflare, no JS required — server-rendered HTML. The
    shipped `duval` transform already parses exactly this DOM.
    Other useful legacy endpoints (all `200`): `/Basic/Search.aspx`, `/Sales/Search.aspx`,
    `/Tangible/Search.aspx`, and `/Codes.aspx` (the property-use code table).
  - **New `duvalcountypropertyappraiser.org` — DO NOT target yet; monitor.** A WordPress
    site on LiteSpeed (probed `200`, 137 KB) with a JS "Property Search Pro" plugin and a
    `wp-json/property-search/v1/submit` REST endpoint plus a `/property-search/` page. It is
    a public-facing redesign over the same authoritative CAMA data, JS-rendered and
    undocumented. It is *not* geo-blocked, but it is browser-dependent and unstable as a
    scrape target compared with the legacy WebForms detail page. Treat it as a fallback to
    revisit only if the legacy front is retired.
- **Access mode:** plain HTTP `GET` per RE# (no browser flow needed for detail pages), but
  **requires a US egress IP** — `*.coj.net` geo-blocks non-US traffic at the network layer.
- **Anti-bot posture:** none observed (no challenge, no rate friction on single probes).
  The only gate is geo-fencing, mitigated by running the fetch from US infrastructure.

## 2. Parcel identifier (RE#)

- **Official name:** Real Estate Number ("RE#").
- **Format:** 10-digit numeric, **leading zeros are significant** (probed example
  `0224370000`). Displayed on the detail page hyphenated as `022437-0000` (6+4) but passed
  to the URL and stored un-hyphenated as 10 digits.
- **Leading-zero trap:** the RE# **must be loaded/stored as TEXT and left-padded to 10
  digits**. Parsing it as an integer drops the leading zero and breaks joins to permits and
  seed rolls. The shipped transform extracts it from `#ctl00_cphBody_lblRealEstateNumber`,
  a `RE #` table row, or the `?RE=` query parameter.
- **Cross-source note:** the FDOR statewide layer (§5) keys parcels by a 22-character
  Section-Township-Range string (e.g. `03-04-25-007864-002-00`), *not* the 10-digit RE#, so
  a seed built from FDOR needs an RE# derivation/join step. Permit portals reference permits
  by their own record numbers and by address, not consistently by RE# (see §3).

## 3. Permit portals (fragmented across ≥3 vendors)

Jacksonville is a consolidated city-county, so one system covers the bulk of the county, but
the three beach cities and the Town of Baldwin run their own portals — permit data is
fragmented across at least three distinct vendors. One harvester per vendor covers every
jurisdiction on that vendor.

| Jurisdiction | Portal | Vendor | Access / anti-bot | Geo-blocked |
|---|---|---|---|---|
| City of Jacksonville (+ unincorporated Duval) | `https://jaxepics.coj.net/` | **JaxEPICS** (COJ custom) | JS single-page app — root and `/Permit/View/<hexid>` return the *same* HTML shell (~73 KB); permit data loads via the app's API/XHR, so browser automation or the discovered JSON endpoint is required | **Yes** (coj.net) |
| Jacksonville Beach ("COAST") | `https://jakb-egov.aspgov.com/Click2GovBP/` | **Click2Gov** (CentralSquare, aspgov host) | server-rendered; reachable directly (`200`); searches by permit#/address/contractor | No |
| Neptune Beach | `https://npor-egov.aspgov.com/Click2GovBP/` | **Click2Gov** (same vendor as Jax Beach) | reachable directly (`200`); one adapter serves both beach Click2Gov sites | No |
| Atlantic Beach | `https://atlb-trk.aspgov.com/eTRAKiT/` | **eTRAKiT** (CentralSquare, aspgov host) | landing returns `403` to a bare client — needs a session/CSRF cookie (bot-gated, **not** geo); reachable from any IP once a session is established | No |
| Town of Baldwin | none found online | — | small town (~1.4k pop); no evident public permit portal — needs-review / likely offline records | — |

- **Record-number shapes (JaxEPICS):** `<TYPE>-<YY>-<NNNNNN>.000`, e.g. `B-23-658574.000`
  (Building), `L-16-785825.000`. The `TYPE` prefix classifies record type and is useful for
  permit-eligibility filtering. Detail pages are addressed by an opaque hex id
  (`/Permit/View/3d7a5f`), not by the record number directly.
- **Adapter leverage:** three vendor adapters — JaxEPICS (browser/API), Click2Gov (Jax Beach
  + Neptune Beach), eTRAKiT (Atlantic Beach) — cover 100% of Duval's online permit sources.

## 4. Bulk data sources (seed)

- **Preferred — DCPA Data Offerings / tax roll.** The appraiser publishes bulk roll files;
  the `duvalcountypropertyappraiser.org/tax-roll/` page (probed `200` directly; not
  geo-blocked) references NAL, GIS, preliminary and final-roll downloads. The concrete
  download links are behind a JS/portal sub-page rather than in the static HTML, so the
  exact file URLs are a `county-seed-data` follow-up. **2025 Final Tax Roll certified
  2025-10-13.**
- **Fallback — FDOR NAL / statewide cadastral (§5).** Programmatically accessible now, ships
  parcel geometry + DOR use code + owner + situs address, and is the robust seed if the DCPA
  offering proves awkward to automate. Requires the STR→RE# derivation noted in §2.
- **Scale:** **≈ 406,073 parcels** in Duval (authoritative roll figure) — the sizing input
  for feasibility.

## 5. FDOR cadastral FeatureServer (geometry / fallback seed)

- **Endpoint:** `https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0` (layer name "FDOR Cadastral 2025"). Not geo-blocked; probed directly.
- **County selector — Duval is `CO_NO = 26`.** This is the authoritative FDOR county code
  (Florida DOR County Number Map; the NAL Final 2025 roll for Duval also carries `CO_NO = 26`).
  `CO_NO = 16` is **Broward** and `CO_NO = 20` is **Clay** — neither is Duval; both the plan's
  original `16` and an earlier probe reading of `20` are wrong and must not be used. Any
  cadastral extraction that filters by county code MUST use `26` and should re-verify against
  parcel geometry/situs ZIP (Duval situs ZIPs are `322xx`) before a full pull, because the
  hosted FeatureServer throttles attribute scans and an ad-hoc probe can mislead.
- **Geometry:** `esriGeometryPolygon`, spatial reference WKID **3086** (Florida Albers).
  Full parcel rings are returned (centroids derivable) — geometry is available for seeding.
- **Key fields:** `CO_NO`, `PARCEL_ID` / `PARCELNO` (22-char STR string), `DOR_UC` (use
  code), `OWN_NAME`, `PHY_ADDR1/2`, `PHY_CITY`, `PHY_ZIPCD`.
- **Query behavior:** `maxRecordCount = 2000` per page (paginate with `resultOffset`).
  `returnCountOnly` / `outStatistics` requests are rejected by this hosted service
  (`HTTP 400`), so counts come from the roll figure, not the service; attribute+geometry
  sampling and paginated extraction work normally.

## 6. Usage-type vocabulary (drives permit eligibility)

- **Scheme:** Florida DOR 4-digit land-use codes, surfaced on the detail page as
  `#ctl00_cphBody_lblPropertyUse` in `<code> <label>` form (probed: `0100 Single Family`)
  and listed on `paopropertysearch.coj.net/Codes.aspx`.
- **Coverage in prior art:** the shipped `duval` transform maps **155 distinct 4-digit
  codes** (`0000`–`9999`) into ~60 normalized usage types. Codes must be zero-padded to 4
  digits before lookup (the transform does `padStart(4,"0")`).
- **Commercial/industrial eligibility (permit-harvest targets):** the `1xxx` (commercial:
  stores, offices, restaurants, auto, hotels, shopping centers), `2xxx`–`4xxx`
  (industrial/warehouse/light+heavy manufacturing/utilities), and select institutional codes
  map to non-residential usage types (RetailStore, OfficeBuilding, Warehouse, Industrial,
  LightManufacturing, Hotel, etc.). Residential (`0000`–`08xx`) and agricultural/timber
  ranges are excluded from commercial permit eligibility. This mapping is the eligibility
  filter for the permit stage.

## 7. Additional data sources

- **Sunbiz (FL corporations, statewide).** Bulk channel is the SFTP host
  `sftp.floridados.gov` (responds on `443`; SFTP handshake owned by the seed stage). The
  public data-downloads page `dos.fl.gov/sunbiz/other-services/data-downloads/` and
  `search.sunbiz.org` return `403` to a bare client (Cloudflare bot challenge — **not** geo)
  and require a headless-browser session for live lookups. Sunbiz is statewide, so only the
  **Duval ZIP-prefix list is county-new**: all `322xx` ZIPs plus `32099` (observed Duval
  ZIPs include 32202/32204/32209/32234/32244/…). Reuse the existing Sunbiz toolchain; supply
  the Duval ZIP filter.
- **BBB (contractor reputation, national).** `bbb.org` returns `403` to bare clients and to a
  browser-UA client (bot protection — **not** geo); a headless-browser harvest is required.
  Reuse the Lee/Palm Beach BBB category harvest, filtered to the Jacksonville/Duval area.
- **Clerk of Court — Official Records (deeds/mortgages/liens).** `oncore.duvalclerk.com`
  `301 → https://or.duvalclerk.com/` ("Duval County Public Records Search", probed `200`,
  18 KB, via US Lambda). Geo-sensitive from non-US egress (direct connect timed out; US
  Lambda succeeds). The shipped transform already deep-links book/page records here.
- **JTA GTFS (transit).** Jacksonville Transportation Authority publishes GTFS at
  `https://ride.jtafla.com/gtfs-archive/` (download `https://schedules.jtafla.com/SchedulesGtfs/Download`);
  Transitland onestop `f-djmu-jacksonvilletransportationauthority`. Static ZIP, bulk-friendly.
- **OSM POI (Overpass).** `overpass-api.de` reachable and fast directly (sub-second count
  queries): a whole-Duval bounding box returns **~1,628** shop+office+restaurant nodes; a
  central-Jacksonville box returned 99 shop nodes. Bulk-friendly via area/bbox queries.
- **County GIS imagery.** `maps.coj.net` (referenced by the shipped transform for parcel
  imagery; coj.net → US egress required).

## 8. Source feasibility (throughput / mode)

| Source | Access / anti-bot | Throughput observed | Recommended mode |
|---|---|---|---|
| Appraiser detail (legacy WebForms) | plain `GET` per RE#; geo-blocked (US IP req) | ~0.1–1.1 s/parcel, no challenge | Runtime/queued per-parcel scrape from US infra, seed-driven; ~406k parcels |
| DCPA Data Offerings roll | download page not geo-blocked; links behind JS portal | n/a (bulk file) | Bulk artifact download (preferred seed) |
| FDOR cadastral FeatureServer | ArcGIS REST, not geo-blocked | 2000 rows/page, count queries disabled | Bulk paginated extraction (geometry seed / fallback) |
| JaxEPICS permits | JS SPA; geo-blocked | app shell only without JS/API | Browser session or discovered JSON API, from US infra |
| Click2Gov (Jax Bch, Neptune) | server-rendered; not geo-blocked | `200` direct | One shared Click2Gov adapter |
| eTRAKiT (Atlantic Beach) | session/CSRF-gated (`403` bare); not geo-blocked | needs session cookie | eTRAKiT adapter with session bootstrap |
| Sunbiz | SFTP bulk; live search Cloudflare-gated | bulk file | Bulk SFTP ingest + ZIP filter (statewide toolchain reuse) |
| BBB | bot-gated (`403`); not geo | n/a | Headless-browser category harvest (reuse) |
| Clerk Official Records | geo-sensitive; `200` from US | 18 KB search page | Runtime lookup from US infra |
| JTA GTFS | static ZIP; open | bulk file | Bulk download, periodic refresh |
| OSM Overpass | open; fast | sub-second counts, ~1.6k commercial POI | Bulk area/bbox extraction |

## 9. Risks

- **Geo-blocking (primary).** `*.coj.net` (appraiser, JaxEPICS, GIS imagery) and
  `*.duvalclerk.com` refuse non-US egress. All ingestion of these must originate from US
  infrastructure; local/non-US probing will time out — that is expected, not a source
  outage. Beach-city (aspgov), FDOR, Sunbiz hosts, BBB, JTA, and Overpass are not
  geo-blocked.
- **Appraiser-front drift.** The new WordPress front signals an in-progress redesign; the
  legacy WebForms front could be retired later. Pin the legacy front now and monitor for
  deprecation; keep the new `wp-json` search API as a documented fallback.
- **Permit fragmentation.** Three vendors (JaxEPICS SPA, Click2Gov, eTRAKiT) plus a
  likely-offline Baldwin. JaxEPICS requires API/browser reverse-engineering; eTRAKiT needs
  session bootstrap. Permits do not join to RE# uniformly (record# / address based).
- **Bot challenges (non-geo).** Sunbiz live search and BBB are Cloudflare/bot-gated and need
  headless sessions; these are distinct from geo-blocks and need browser automation, not a
  different egress.
- **Identifier mismatch.** Appraiser RE# (10-digit, TEXT, leading-zero) vs FDOR STR parcel
  string (22-char) vs permit record numbers — the load/matching stage must normalize and
  join carefully; mishandling the RE# as an integer is the highest-frequency data bug.

---

### Prior-art references (reuse, do not rebuild)

- Appraisal transform package: `Counties-trasform-scripts/duval/scripts/`
  (`data_extractor.js`, `ownerMapping.js`, `layoutMapping.js`, `structureMapping.js`,
  `utilityMapping.js`) — targets the legacy front; 155 DOR use-code mappings.
- Legacy DOM static parts: `source-html-static-parts/duval.csv`.
- Sunbiz + BBB toolchains from the Lee/Palm Beach reference implementations (statewide /
  national; supply the Duval ZIP + area filters).
