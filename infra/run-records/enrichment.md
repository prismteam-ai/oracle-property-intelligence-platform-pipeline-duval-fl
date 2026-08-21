# Duval County — enrichment record (geo/derived facts)

Run-record for the enrichment stage (Task 8): compute per-property geo/derived facts and write
them to our **own** Neon layer — a dedicated `property_enrichment` table — **not** by extending
the kit's fixed query-table schema, so the kit exporter is never forked (design §4). Every fact
carries an inspectable `*_basis` JSON so its derivation (which POI, what distance, which permit)
is auditable per property.

Scripts (TypeScript, run with `npx tsx`, server-only DB access via `DATABASE_URL`):
`enrich/walking-distance.ts`, `enrich/water-view.ts`, `enrich/roof-age.ts`,
`enrich/regional-owner.ts` (+ shared `enrich/lib.ts`).

## Inputs (already in Neon, from Tasks 6–7)

- `geometries`: **169** parcels with real lat/long (US Census geocode keyed on appraiser RE#) +
  `property_id`. These are the parcel points for the distance/adjacency facts.
- `property_improvements` (`source_system='duval_jaxepics'`): permits, incl. **265 roofing
  permits (220 linked to a property)** — the roof-age input.
- `properties`: **373** folio spine (RE# TEXT).
- `ownerships`/`people`/`companies`: owner entities (see the regional-owner gap below).

## External POI sources (public, VPN OFF — not geo-blocked)

- **JTA GTFS** `stops.txt` — `https://ride.jtafla.com/gtfs-archive/gtfs.zip` (2,501 boarding stops).
- **OSM / Overpass** — Starbucks POIs (`brand=Starbucks`) and the water layer
  (`natural=water` / `natural=coastline` / `waterway=riverbank|river|stream|canal`), scoped to the
  parcels' bounding box. Overpass responses + the GTFS zip are cached under the OS temp dir
  (never committed) so the four scripts don't re-hammer the public endpoints.

## Facts computed (write to `property_enrichment`)

| Fact (columns) | Method | Populated |
|---|---|---|
| **near_transit / dist_band** (`near_transit`, `nearest_transit_*`, `dist_band`, `distance_basis`) | Haversine parcel point → nearest JTA stop; `near_transit` = ≤ 800 m (½-mile transit walkshed). `dist_band` = walkability band of the nearest amenity (transit **or** Starbucks): very_close ≤400, close ≤800, moderate ≤1600, far >1600. | **169 / 169** |
| **near_starbucks** (`near_starbucks`, `nearest_starbucks_*`) | Haversine parcel point → nearest OSM Starbucks; `near_starbucks` = ≤ 800 m. | **169 / 169** |
| **water_view** (`water_view`, `nearest_water_*`, `water_basis`) | Min distance parcel point → nearest OSM water polyline segment; `water_view` = ≤ 150 m (proximity proxy — frontage/immediate view band, **not** a line-of-sight determination). | **169 / 169** |
| **roof_age_years** (`roof_age_years`, `roof_permit_*`, `roof_age_basis`) | Years since the most recent linked JaxEPICS re-roof permit (issue date, falling back to application-received / opened). | **51 / 373** (partial by design) |
| **regional_owner** (`regional_owner`, `owner_locality_basis`) | Owner mailing state + ZIP prefix vs the Duval, FL situs → in_county / in_state / out_of_state. | **0** (load-layer gap, below) |

### Results

- **near_transit**: 51 / 169 within 800 m of a JTA stop (min 14.8 m, median ≈ 2.0 km) — transit
  is dense in urban Duval.
- **near_starbucks**: 0 / 169 within 800 m. This is real, not a defect: the loaded parcels are a
  **commercial-first western-Duval sample**; the nearest Starbucks to *any* of them is **2.87 km**
  (median ≈ 11.7 km). The exact nearest-Starbucks distance is still stored for all 169.
- **dist_band** (nearest amenity): very_close 17, close 34, moderate 23, far 95.
- **water_view**: 54 / 169 within 150 m of water (waterfront ≤30 m: 5; water_view 30–150 m: 49;
  near_water 150–500 m: 73; inland >500 m: 42). Consistent with Duval's dense hydrography
  (river, creeks, retention/wetland water).
- **roof_age_years**: 51 distinct properties (13.7 % of 373) carry a dated linked roofing permit
  and got a roof age (min 0.2 y, avg 9.2 y, max 30.6 y). The independent distinct-property check
  (`count(distinct property_id)` of dated linked roofing permits) also returns **51**, matching.
  **Partial by design and honest:** the other 322 properties have no re-roof permit on record →
  `roof_age_years = NULL`. That NULL is the correct flag, not a failure. Future-dated permits: 0.

### `property_enrichment` shape

220 rows = the **169 geocoded** parcels (walking-distance + water-view facts) **∪** the **51
roofing-permit** properties (roof-age). In this sample those two populations are **disjoint** (the
geocoded western-commercial sample and the urban permit-active parcels are different parcels), so
each row carries the facts applicable to its parcel and NULL for the rest — expected, documented.

## Honest gap — regional_owner (0 populated)

`regional-owner.ts` is correct and ready, but the **owner mailing address is not present in the
current Neon load**, so the fact is left NULL (flagged) rather than fabricated:

- `ownerships.mailing_address_id` is **NULL on all 457** ownerships.
- `addresses` holds **only the 373 Duval situs** rows (all `state_code='FL'`, ZIP `322xx`,
  `county_name='Duval'`) — no owner mailing rows.
- `people` / `companies` `source_payload` carry **names only** — no mailing state/ZIP.
- `taxes` / `deeds` / `property_valuations` payloads carry no mailing address either.

Root cause: the appraiser transform emits `person_has_mailing_address` /
`company_has_mailing_address`, but the Task 6/7 load stage did **not** materialize those mailing
entities into `addresses` / `ownerships.mailing_address_id`. Re-deriving owner mailing needs the
**geo-blocked appraiser source** (US-egress Lambda), which is out of scope for this DB + public-API
enrichment stage (VPN off). The banding logic (state ≠ FL → out_of_state; Duval county/ZIP-322xx →
in_county; else in_state) and the mailing-address + payload read paths are implemented, so a mailing
backfill + a re-run populates `regional_owner` with **zero code change**.

## Reproduce

```
DATABASE_URL=<neon> npx tsx enrich/walking-distance.ts
DATABASE_URL=<neon> npx tsx enrich/water-view.ts
DATABASE_URL=<neon> npx tsx enrich/roof-age.ts
DATABASE_URL=<neon> npx tsx enrich/regional-owner.ts
```

All writes are idempotent upserts on `property_enrichment.property_id`; re-runs refresh in place.
Facts stay in our own Neon layer and are answered by the hosted UI/agent (with the stored
"distance calculation basis"); they are never injected into the kit's fixed query-table schema.
