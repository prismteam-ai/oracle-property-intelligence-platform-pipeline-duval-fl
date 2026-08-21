# Duval County — parcel seed provenance

Record of the parcel seed produced for the Oracle property-first ingestion pipeline
(`county-seed-data` stage). The seed is the single CSV that drives the whole county run:
one row per parcel, keyed by the appraiser Real Estate Number (RE#). The raw seed is staged
to the private S3 seeds bucket and is **not** committed to this repository; this note is the
committed artifact.

## Source selected

**Florida Department of Revenue (FDOR) — Final NAL (Name-Address-Legal) real-property
assessment roll, 2025, Duval County.**

- Preference order for a Florida county seed is: (1) county appraiser bulk roll, then
  (2) FDOR NAL statewide per-county roll, then (3) county GIS export.
- The Duval County Property Appraiser (DCPA) does publish bulk roll offerings, but the
  concrete download links are served from a JavaScript portal sub-page rather than as static
  URLs, and the legacy appraiser bulk endpoints are network-restricted to US egress. The
  FDOR NAL is the same authoritative CAMA data the appraiser submits to the state, is a
  single per-county file, is directly and programmatically downloadable, is not
  network-restricted, and carries the RE# needed to drive the appraiser detail pages.
- The FDOR NAL was therefore chosen as the seed source for this milestone. The DCPA bulk
  offering remains a documented alternative if a future refresh needs appraiser-native fields
  the NAL does not carry.

## Retrieval method

- Direct HTTPS download of the per-county Final NAL archive from the FDOR Property Tax Data
  Portal (Tax Roll Data Files → NAL → 2025 Final). The file is identified by **county name**
  (`Duval`) to avoid a county-number ambiguity described below.
- The archive expands to a single delimited roll file of ~398k rows and 165 columns
  (the standard FDOR NAL layout: `PARCEL_ID`, `DOR_UC`, situs address fields
  `PHY_ADDR1/2` / `PHY_CITY` / `PHY_ZIPCD`, value and sales columns, owner columns, etc.).
- No geo-restricted source was contacted to build the seed; the FDOR portal is reachable
  directly.

## RE# derivation and the leading-zero trap

- The appraiser detail page expects a **10-digit RE#, leading zeros significant**, e.g.
  `paopropertysearch.coj.net/Basic/Detail.aspx?RE=0224370000`.
- In the NAL, the parcel key `PARCEL_ID` is stored as `<10 digits>` + a trailing `R`
  real-property suffix (e.g. `0224370000R`). **Every** row (398,315 / 398,315) matches
  `^\d{10}R$`; the NAL `ALT_KEY` column is empty for the whole county.
- The seed RE# is derived by stripping the trailing `R`, yielding exactly 10 digits with
  leading zeros preserved. The RE# is stored and staged as **TEXT**; it is never parsed as an
  integer at any point.
- **Leading-zero prevalence:** 165,618 of 398,315 seed rows (41.6%) have an RE# that begins
  with `0`. Loading the key as a number would silently corrupt ~42% of the county, so the
  TEXT/zero-pad contract is load-bearing, not cosmetic.

## Seed schema

Columns, matching what the seed pre-processor and the CLI seed transform consume:

`parcel_id, source_identifier, county, method, url, multiValueQueryString, address, dor_uc`

- `parcel_id` / `source_identifier` — the 10-digit RE# (identical; TEXT).
- `county` — `Duval` (no "County" suffix, per the address-jurisdiction schema).
- `method` / `url` / `multiValueQueryString` — the per-parcel source request to the pinned
  legacy appraiser detail page (a plain `GET`; the RE# travels in `multiValueQueryString`
  because the request-URL schema disallows an inline query string).
- `address` — the situs (property-location) address assembled from the NAL physical-address
  columns. Situs location is public, non-owner data.
- `dor_uc` — the NAL DOR use code, carried through to let a later stage select a
  commercial-first pilot without re-joining the roll.

A two-row and a 500-row random sample of generated rows were validated against the Elephant
`property_seed` and `unnormalized_address` JSON schemas (draft-07): **0 schema errors**.

## Ordering

Rows are ordered **commercial/industrial-eligible first** (NAL DOR use code 10–49:
21,479 rows), then all remaining parcels (376,836 rows), each group preserving source-roll
order. This makes the appraisal scrape itself commercial-first, matching the reference-county
strategy; it does not drop any parcel.

## Row count and reconciliation

| Measure | Value |
|---|---|
| NAL Final 2025 data rows (source) | 398,315 |
| Seed rows written | 398,315 |
| Malformed RE# (not `^\d{10}$` after suffix strip) | 0 |
| Duplicate RE# | 0 |
| Distinct RE# | 398,315 |
| Discovery reference parcel figure | ~406,073 |

The seed reconciles 1:1 with the NAL source (398,315 = 398,315, no rows dropped). It sits
~1.9% below the ~406,073 figure recorded at discovery. The gap is expected: the NAL is the
**real-property** roll only and excludes tangible personal property (a separate NAP roll),
and parcel counts also differ by roll date and by whether non-assessed GIS polygons are
included. This is within the "a few percent" tolerance for a seed.

## Sample appraiser-lookup assertion (leading-zero-trap gate)

Before any full run, five real RE#s spanning the roll (including leading-zero-heavy keys)
were looked up against the live legacy appraiser detail page from a **us-east-1 Lambda**
(US egress, required because the appraiser network-restricts non-US traffic). The throwaway
Lambda and its role were deleted immediately after the check.

- **5 / 5 real RE#s returned non-empty** parcel detail — HTTP 200, ~60–80 KB, with the
  real-estate-number label and property-use fields present.
- **Negative controls proved the trap:** the same RE#s with the leading zero dropped
  (integer-style, 9 or fewer digits) returned HTTP 200 but a ~15 KB page with **no** parcel
  data — a silent empty result that masquerades as success. This is exactly the failure mode
  the seed's TEXT/zero-pad handling prevents.

## Staging location

Staged to the project's private seeds bucket as `s3://<duval-seeds-bucket>/duval.csv`
(server-side encrypted; bucket public access fully blocked). Uploaded size matches the local
build byte-for-byte. The default shared `counties-seeds` bucket is intentionally not used.

## County-number note (for FDOR-consuming stages)

Duval's FDOR county code is **26**. This is the authoritative value: the FDOR NAL Final 2025
roll for Duval carries `CO_NO = 26`, and it matches the Florida DOR County Number Map. In the
standard DOR numbering `16 = Broward` and `20 = Clay` — an earlier discovery probe that read
`CO_NO = 20` for Duval on the statewide cadastral FeatureServer was **wrong** (that is Clay),
not a separate numbering system. The seed itself is built from the NAL identified by county
**name**, so it is unaffected either way; but any stage that queries the cadastral
FeatureServer by `CO_NO` MUST use `26` and should re-verify against a known Jacksonville
parcel's geometry/situs ZIP (`322xx`) before a full pull, since the hosted service throttles
attribute scans and an ad-hoc probe can mislead.

## Refresh cadence

The 2025 Final roll was certified in October 2025. FDOR publishes preliminary and final NAL
files yearly; refresh the seed from the then-current Final NAL and re-run the format and
sample-lookup checks above.
