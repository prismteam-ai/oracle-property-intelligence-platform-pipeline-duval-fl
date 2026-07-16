# Run record — provenance + polish fixes (post-review)

Applied after an independent runtime re-evaluation confirmed the four prior defects fixed and
flagged a set of smaller quality gaps. All changes are demo-safe or documentation-only; the ingest
data was not re-scraped.

## Provenance: where the citation nulls came from (verified against Neon, not assumed)

Fill-rate of the kit provenance columns per source table, at the time of review:

| Table (source)                     | rows | `source_artifact_uri` | `source_record_hash` |
|------------------------------------|-----:|----------------------:|---------------------:|
| properties (appraiser)             |  373 |                   373 |                  373 |
| deeds                              | 1939 |                  1939 |                 1939 |
| sales_histories                    | 1939 |                  1939 |                 1939 |
| geometries (US Census geocode)     |  240 |         0 → **240**   |                    0 |
| property_improvements (all)        | 2959 |                  1355 |                 1355 |
| &nbsp;&nbsp;— of which JaxEPICS permits | 1604 |                 0 |                    0 |

Two distinct causes — not one:

- **Deeds — data was fully present; the citation just didn't thread it.** `deeds` and
  `sales_histories` carry `source_artifact_uri` and `source_record_hash` at 100%. The ownership-age
  citation already selected the deed URI but hard-coded `page_sha256: null`. **Fix (A):** thread
  `deeds.source_record_hash` into the citation `page_sha256`. Pure citation-layer change; no data
  change.

- **Geo + permits — the provenance was never persisted at ingest.**
  - `geometries`: 0/240 URI and 0/240 hash. The geocode used the Census **addressbatch** endpoint
    and did not retain a per-parcel request/response. **Fix (B):** backfill
    `geometries.source_artifact_uri` with the equivalent **single-address** Census geocoder query URL
    (`/locations/onelineaddress`, same `Public_AR_Current` benchmark) — a reconstructed canonical URL
    that resolves to the same coordinate from the same authoritative source
    (`enrich/backfill-geo-source-uri.ts`, 240/240 updated). `page_sha256` stays **null** for geo — the
    batch response was not retained, so there is no honest page hash to publish.
  - JaxEPICS permits: 0/1604 URI and hash. The adapter emits a `source_url`, but this ingest run did
    not persist it and the stored payload is minimal (no URL), and Accela per-permit deep-links are
    not deterministically reconstructable from the permit number. **Decision:** do **not** fabricate a
    per-permit URL. The permit citation carries the permit number as `source_record_key`
    (`duval_jaxepics:<req>:permit:<no>`); the portal is `https://jaxepics.coj.net/`. Documented as a
    known limitation rather than back-filled with a misleading link.

## Other polish

- **(C) Constant-time token compare.** `apps/api/src/context.ts` compared the bearer token with a
  plain `===` (length-leaking, early-exit). Replaced with `safeTokenEqual` (`apps/api/src/auth.ts`):
  SHA-256 both sides, `crypto.timingSafeEqual`. Added offline unit tests for the compare
  (`apps/api/src/auth.test.ts`) and for PII redaction (`packages/shared/src/redact.test.ts`); the CI
  test glob now covers `apps/*/src` and `packages/*/src`.
- **(D) Near-transit count reconciliation.** The Overview tile counted `near_transit` (110) while the
  walking-distance workflow reports `near_transit OR near_starbucks` (111 — one Starbucks-only
  parcel). The Overview fact now uses the same walking-distance predicate (111) and the tile is
  relabeled "Near transit / Starbucks", so the two views never show two numbers.
- **(E) Doc/impl drift in `docs/design.md`.** Duval FDOR `CO_NO` corrected `16 → 26`; "Neon/Drizzle"
  corrected to raw parameterized SQL via `pg` over the kit loader schema (no ORM); added that the
  serving layer (tRPC API Lambda + Amplify) runs in us-east-2, distinct from the us-east-1 ingest
  pipeline; "never-throw discriminated results" corrected to "queries throw; the tRPC layer surfaces
  typed errors".

## Verification

- Green-gate: `pnpm -r --if-present typecheck` (5/5 projects) + root `typecheck` clean; `pnpm test`
  23/23 pass (offline, no DB/AWS).
- DB after backfill: `geometries.source_artifact_uri` 240/240; `deeds.source_record_hash` 1939/1939;
  walking-distance metric = 111.
- Redeployed the API Lambda (deed-hash citation + 111 fact + constant-time token) and the web export
  (Overview label); demo re-recorded against the updated runtime.
