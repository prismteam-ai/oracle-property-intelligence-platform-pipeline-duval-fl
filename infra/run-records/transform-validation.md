# Duval County — transform coverage-gate validation

Run-record for the `validate-county-transform` gate: prove the Duval appraiser transform
extracts 100% of the data available on the appraiser detail page across property-type
variability, **before** any full-county ingestion run. This is a hard gate — the pipeline
must not scale until it passes.

## Verdict

**GATE PASSED — after handler extension. Cleared to scale.**

This gate ran in two rounds. The **initial run** correctly caught class-(a) coverage gaps: the
transform validated cleanly (22/22, 0 errors, `county_jurisdiction`=Duval, folio=seed RE# on
every parcel) but was **incomplete** — the handler emitted only 6 of the County data-group
entity types the appraiser detail page carries, dropping the rest (structure, utility, layout,
lot, deed, file/improvements, per-authority tax). The handler was then **extended** to emit the
full County data group, and the **re-gate** on the same 22 diverse parcels passed with **0
validation errors and 0 class-(a) coverage gaps** (see "Re-gate — extended handler" below for
the per-parcel table).

The initial-gap analysis is retained below as the record of exactly what the gate caught and
why the handler was extended — this is the value of running the gate before scaling to ~398k
parcels, not after.

## Method

- **Sample:** 22 parcels selected from the seed for usage-type spread (not random) using the
  seed `dor_uc` column, then verified against the live page's actual DOR use code. 22 distinct
  DOR use codes spanning residential (single-family, condo, mobile/manufactured, multi-family
  10+, multi-family 3-9, common area, vacant), commercial (retail, office, medical office,
  mixed-use, vacant, auto/service), industrial (warehouse, vacant), agricultural (timber),
  institutional (church, county, vacant government, vacant institutional), and edge cases
  (right-of-way, waste land). 12 of the 22 are improved structures; the rest are land/vacant.
- **Capture:** each detail page fetched as a plain server-rendered `GET` from a throwaway
  US-region function (the appraiser front geo-restricts non-US egress); the function and its
  reused role were deleted immediately after use. One additional candidate returned a `302`
  redirect (record retired/merged) and was dropped from the sample.
- **Transform + validate:** each capture packaged into the transform-v2 input shape
  (`parcel.json` + `address.json` + `captures.json` + `captures/*.html`), run through
  `elephant-cli transform --transform-version 2` with the Duval handler, then
  `elephant-cli validate` on the output. The CLI used is the pipeline's transform-v2 runtime
  (transform v2 is not in the published npm build).
- **Coverage diff:** for each parcel, every populated data section on the page was enumerated
  and matched against the transformed `data/*.json`. Each unmatched populated field was
  classified (a) extractor gap, (b) page section not captured, or (c) no lexicon home.

## Sample parcels (RE# + live DOR use code)

| DOR use (page) | RE# | property_type | property_usage_type | validate | structure grid |
|---|---|---|---|---|---|
| 0000 Vacant Res | 0000160100 | LandParcel | Residential | 0 errors | land |
| 0100 Single Family | 0000060030 | Building | Residential | 0 errors | present |
| 0200 Mobile Home | 0000060040 | ManufacturedHome | Residential | 0 errors | present |
| 0300 Multi-Family 10+ | 0004880020 | Building | Residential | 0 errors | present |
| 0400 Residential Condo | 0114440150 | Unit | Residential | 0 errors | at master parcel |
| 0810 Residential Mixed 3-9 | 0000320020 | Building | Residential | 0 errors | present |
| 0991 Res Common Area | 0006060050 | LandParcel | ResidentialCommonElementsAreas | 0 errors | land |
| 1000 Vacant Comm | 0000500030 | LandParcel | Commercial | 0 errors | land |
| 1191 Store Retail | 0000500020 | Building | RetailStore | 0 errors | present |
| 1200 Mixed Use Res/Store/Off | 0003690000 | Building | Commercial | 0 errors | present |
| 1700 Office 1-2 Story | 0001410000 | Building | OfficeBuilding | 0 errors | present |
| 1991 Office Medical | 0005880010 | Building | MedicalOffice | 0 errors | present |
| 2792 Service Garage/Vehicle | 0000790000 | Building | AutoSalesRepair | 0 errors | present |
| 4000 Vacant Industrial | 0000900100 | LandParcel | Industrial | 0 errors | land |
| 4897 Warehouse/Prefab | 0000940000 | Building | Warehouse | 0 errors | present |
| 5600 Timber | 0000010010 | LandParcel | TimberLand | 0 errors | land |
| 7000 Vacant Institute | 0000700000 | LandParcel | GovernmentProperty | 0 errors | land |
| 7100 Church | 0000820200 | Building | Church | 0 errors | present |
| 8000 Vacant Governmental | 0000100015 | LandParcel | GovernmentProperty | 0 errors | land |
| 8600 County | 0004290000 | Building | GovernmentProperty | 0 errors | present |
| 9400 Right-Of-Way | 0000280510 | LandParcel | TransportationTerminal | 0 errors | land |
| 9600 Waste Land | 0000100010 | LandParcel | TransitionalProperty | 0 errors | land |

(No owner identity is reproduced here; owner name and mailing are present in every capture and
map into `person`/`company` + mailing entities — verified generically, not transcribed.)

## What passed

- **Schema validity:** 22 / 22 transforms returned success and passed `elephant-cli validate`
  with **0 errors** across all emitted files, including the assembled `County` data-group root.
- **`county_jurisdiction`:** the address entity carries `county_name = "Duval"` on **22 / 22**
  parcels. No wrong-county label.
- **Folio integrity:** the property entity's `request_identifier` equals the seed RE#
  (10-digit, leading zeros preserved) on **22 / 22** parcels; the leading-zero-heavy keys
  (e.g. `0000060030`, `0000010010`) round-trip intact.
- **Classification branch coverage:** the DOR use-code map produced the expected
  `property_type` / `property_usage_type` / `structure_form` / `ownership_estate_type` /
  `build_status` for every one of the 22 distinct codes (Building / LandParcel / Unit /
  ManufacturedHome all exercised; VacantLand vs Improved derived correctly).

## The coverage gap (why the gate does not pass)

The handler emits six entity types — `property`, `address`, `tax`, owner (`person` / `company`),
owner mailing address, and `sales_history`. The appraiser detail page also carries the data
below, each of which has a valid home in the **County** data group (confirmed against the
lexicon `data_groups` "County" relationship set, and against the shipped Duval reference
scripts which emit exactly these). The handler extracts **none** of them:

| Missing County entity | Page source (populated on…) | Extracted |
|---|---|---|
| `structure` (exterior wall, roof struct/cover, interior wall, flooring) | building elements grid — 12/22 parcels (5–8 rows each) | 0/22 |
| `utility` (heating fuel, heating type, air conditioning) | building elements grid — 12/22 parcels (3 rows each) | 0/22 |
| `layout` (stories, bedrooms, baths, rooms/units) | building attributes grid — 12/22 parcels (4–5 rows each) | 0/22 |
| `file` / `property_improvement` (extra features: porch, garage, pool…) + PRC record-card documents | extra-features grid — 15/22; PRC links — 22/22 | 0/22 |
| `lot` (land line: use description, front, depth, land units, land type, land value) | land grid — 21/22 (only the zoning column is read; the rest is dropped) | 0/22 |
| `deed` + richer `sales_history` (book/page, deed instrument type, qualified/unqualified, vacant/improved) | sales grid — 22/22 (only sale date + price are read) | 0/22 |
| `tax_jurisdiction` + `tax_exemption` (per-authority assessed/exemption/taxable + levy) | tax-details grid — 20/22 | 0/22 |

For the 12 improved parcels this dropped per-building content is the **majority** of the page's
data. The shipped reference Duval transform emits these same entities in volume (hundreds of
`layout` / `structure` / `utility` references across a county), which both confirms the lexicon
homes and shows the target coverage.

### Gap classification

- **Class (a) — extractor gaps, must fix:** `structure`, `utility`, `layout`, `lot`, `file` /
  `property_improvement`, `deed` + richer `sales_history`, `tax_jurisdiction` / `tax_exemption`.
  All are present on the page, captured by the single GET, and have County data-group homes.
- **Class (b) — page not captured:** none. The whole detail page is a single server-rendered
  GET; every section above is already in the capture.
- **Class (c) — no lexicon home (legitimately droppable, keep in provenance):** internal GIS
  tile number; building sketch/traversing vector string; the CAMA value-method label. These
  have no County entity and are correctly out of scope.

### Explained (intentional, not gaps)

- **`*InProgress` values** — the page shows a second, uncertified preliminary-year snapshot
  alongside the certified values. The handler deliberately takes the **certified** (final)
  values; the In-Progress column is an intentional drop, not a gap.
- **TRIM current-year block** duplicates the certified value summary; **TRIM last-year block**
  is prior-year values (a candidate second `tax` entity, noted as available-but-deferred).
- **`sale_type`** is set to the arms-length default because the sales grid does not classify
  distress (documented compromise). Note the grid **does** expose qualified/unqualified, which
  a richer `sales_history` should carry — folded into the class-(a) sales gap above.

## Folio reconcile vs seed

- Seed: **398,315** rows, **398,315** distinct RE#, **0** duplicates, **0** malformed
  (per the seed provenance record).
- Validation sample: **22** distinct folios, each equal to its seed RE# and to the RE# label
  on the corresponding transformed `property` entity — no collisions, no integer-coercion loss.
- The full prefix-level reconcile (distinct transformed folios == achievable seed folios) is a
  load-time check for the ingest/load stage, run against the exact S3 output prefix before the
  Fargate load — not part of this transform-coverage gate.

## Required before scaling

1. Extend the Duval handler to emit `structure`, `utility`, and `layout` from the building
   elements / attributes grids; `lot` from the land grid; `file` / `property_improvement` from
   the extra-features grid and PRC record cards; `deed` + full `sales_history` columns from the
   sales grid; and `tax_jurisdiction` / `tax_exemption` from the tax-details grid — reusing the
   shipped reference mappings (`structureMapping` / `layoutMapping` / `utilityMapping` /
   owner + deed logic), re-expressed for the self-contained transform-v2 contract.
   **Or** record an explicit decision to ship the reduced County data group for this milestone.
2. Re-run this gate on the same diverse sample; require class-(a) gaps == 0 before proceeding to
   the ingest run.

## Secondary finding (not gate-blocking)

The handler links owners with `person_has_property` / `company_has_property`. Both are listed
under `deprecated_relationships` for the County data group (current modeling links owners
through the sale via `sales_history_has_person` / `sales_history_has_company`). They still
validate today, but the ownership relationship should be migrated when the handler is extended.

---

## Re-gate — extended handler (class-(a) == 0)

The Duval handler was extended to emit the previously-missing County entities, then this
gate was re-run on the **same 22-parcel diverse sample**. Each detail page was re-captured
as a plain server-rendered GET from a throwaway US-region function (reused role, deleted
immediately after), packaged into the transform-v2 input shape, run through
`elephant-cli transform --transform-version 2` with the extended handler, then
`elephant-cli validate`. Coverage was recomputed by enumerating every populated page
section per parcel and confirming an emitted entity of the matching type.

**VERDICT: GATE PASSED — 22/22 parcels, 0 validation errors AND 0 class-(a) coverage gaps.**

The handler now emits, in addition to `property` / `address` / `tax` / owner / mailing:
`structure` (exterior wall, roof structure/cover, interior wall, flooring — roof fields
populated for the Task 8 roof-age enrichment), `utility` (heating system/fuel, cooling,
HVAC condensing), `layout` (building + per-bath/-bedroom spaces), `lot` (aggregated land
lines: area, acreage, front/depth, lot type), `property_improvement` (extra features),
`file` (Property Record Card), `deed` (book/page + instrument type per sale), richer
`sales_history`, and `tax_jurisdiction` + `tax_exemption` (per-authority taxable/exemption).
Owner ownership was migrated off the deprecated `person_has_property` /
`company_has_property` to `sales_history_has_person` / `sales_history_has_company`
(linked to the most recent sale); `person_has_mailing_address` /
`company_has_mailing_address` retained.

| DOR use (page) | RE# | validate errors | entity types | building? | class-(a) gaps |
|---|---|---|---|---|---|
| 1191 Store Retail | 0000500020 | 0 | 14 | yes | 0 |
| 1000 Vacant Comm | 0000500030 | 0 | 10 | land/unit | 0 |
| 2792 Service Garage/Vehicle RP | 0000790000 | 0 | 14 | yes | 0 |
| 4000 Vacant Industrial | 0000900100 | 0 | 10 | land/unit | 0 |
| 4897 Warehouse/Prefab | 0000940000 | 0 | 14 | yes | 0 |
| 1700 Office 1-2 Story | 0001410000 | 0 | 14 | yes | 0 |
| 1200 Mixed Use Res/Store/Off | 0003690000 | 0 | 14 | yes | 0 |
| 1991 Office Medical | 0005880010 | 0 | 14 | yes | 0 |
| 5600 Timber SI 70-79 | 0000010010 | 0 | 10 | land/unit | 0 |
| 0100 Single Family | 0000060030 | 0 | 14 | yes | 0 |
| 0200 Mobile Home | 0000060040 | 0 | 14 | yes | 0 |
| 9600 Waste Land | 0000100010 | 0 | 10 | land/unit | 0 |
| 8000 Vacant Governmental | 0000100015 | 0 | 9 | land/unit | 0 |
| 0000 Vacant Res | 0000160100 | 0 | 12 | land/unit | 0 |
| 9400 Right-Of-Way | 0000280510 | 0 | 11 | land/unit | 0 |
| 0810 Residential Mixed Units 3-9 | 0000320020 | 0 | 14 | yes | 0 |
| 7000 Vacant Institute | 0000700000 | 0 | 11 | land/unit | 0 |
| 7100 Church | 0000820200 | 0 | 14 | yes | 0 |
| 8600 County | 0004290000 | 0 | 12 | yes | 0 |
| 0300 Multi-Family Units 10 or More | 0004880020 | 0 | 14 | yes | 0 |
| 0991 Res Common Area | 0006060050 | 0 | 11 | land/unit | 0 |
| 0400 Residential Condo | 0114440150 | 0 | 9 | land/unit | 0 |

Improved parcels emit 14 entity types; land/vacant and condo-at-master parcels emit 9-12
(structure/utility/layout/lot are correctly **not** required where the page carries no
building-elements / land section — those are not gaps). The DOR use-code classification,
RE#-as-TEXT folio integrity, `county_jurisdiction = Duval`, money-→null parsing, and the
v1/v2 capture-shape handling from the prior gate all still hold.

### Class-(c) drops (no lexicon home; retained in provenance, not gaps)

- Internal GIS tile number; building sketch / traversing vector string; CAMA value-method
  label (as before).
- `roof_material_type`, `roof_design_type` where the appraiser element text does not name a
  design (e.g. "Wood Truss" carries no Gable/Hip) — left null (nullable), not fabricated.
- PRC document `original_url`: the record card is fetched via a JS `downloadPDF(year,type)`
  call with no static href, so the `file` entity carries the PRC name + year but a null URL.
- `tax_rate` (millage): the tax-details grid exposes per-authority dollar levies, not millage
  rates, so `tax_exemption.tax_rate` is omitted (taxable_value_amount + exemption_value carried).

---

## Field-level re-verify (value-correctness + graph connectivity)

The presence gate scores entity existence, not value-correctness or ownership connectivity.
After a deep review, the handler was hardened and re-verified on the same 22-parcel sample
with **field-level assertions** (not just 0-errors). All hold; verdict remains **PASSED**.

| Assertion | Result |
|---|---|
| A1 — 22/22 transform + validate, 0 errors | PASS |
| A2 — roof populated on improved parcels (Task 8 dependency) | PASS — `roof_covering_material` on 12/12 improved parcels; `roof_structure_material` + `roof_covering_material` both non-null on 8 (e.g. Wood Truss / Architectural Asphalt Shingle; Steel Truss / Metal Standing Seam) |
| A3 — `sale_type` varies with deed / qualification (no longer hardcoded) | PASS — across the sample: TypicallyMotivated ×104, TrusteeJudicialForeclosureSale ×4 (Certificate-of-Title deeds), CourtOrderedNonForeclosureSale ×1 (Tax Deed) |
| A4 — ownership never dropped on a no-sale parcel | PASS — on a sales-stripped capture (owner present, zero sale rows) the owner links via `company_has_property` (fallback) and validates 0 errors; all 22 sampled parcels had sales, so the fallback is proven deterministically |
| A5 — lot area sane for acre parcels | PASS — 15/15 acre parcels: `lot_area_sqft` ≈ acres×43560 (e.g. 100.12 ac → 4,361,227 sqft; 2.34 ac → 101,930 sqft). Front-Footage land lines are excluded from area |
| Coverage (class-(a)) still 0 | PASS — 22/22, 0 gaps |

### Value-correctness fixes applied

1. **Owner→property never dropped.** When a parcel has no recorded sale, ownership falls back
   to the schema-valid `person_has_property` / `company_has_property` link instead of being
   left mailing-only or orphaned; the non-deprecated `sales_history_has_person/company` is
   used whenever a sale exists.
2. **Roof label match loosened** (tolerates `Roof Struct`/`Roof Structure`,
   `Roofing Cover`/`Roof Cover`). Duval's "Roof Struct" column carries either a structural
   material (Wood Truss → `roof_structure_material`) or a roof design (Gable or Hip →
   `roof_design_type`); each maps to its correct lexicon field rather than forcing one.
3. **`sale_type` derived** from the DOR qualification + deed instrument (Certificate-of-Title →
   foreclosure, Tax Deed → court-ordered, probate/PR → probate, qualified → arms-length).
   Limitation (class-(c)): the enum has no non-market/family value, so unqualified non-distress
   transfers (quitclaim, agreement-for-deed, nominal) remain TypicallyMotivated.
4. **Lot area** uses an explicit land-method map (Square Footage → sqft, Acreage → acres);
   Front Footage / Lot / Unit lines are linear or counts and excluded from area (previously an
   'else → sqft' path summed front footage as area).
5. **Multi-building layouts:** layouts are emitted for **every** building's attributes grid
   (array cardinality). `structure`/`utility` describe the primary building — forced by the
   County group's single cardinality for `property_has_structure` / `property_has_utility`.
6/7. **Layout counts** use exact attribute-label matching (`Bedrooms`→Bedroom, `Baths`→Full
   Bathroom, `Restrooms`→Half Bathroom / Powder Room) instead of `.includes('bath')`;
   `improvement_type` map broadened (pool/screen/fence/wall/dock/light/paving/building);
   `improvement_type` confirmed nullable, so unmapped features stay null (no failure at scale).

Deed column index (sales grid col 3) verified against the live grids (6-column layout,
consistent across all 22); deed_type map covers WD/SW/QC/TD/AG/RW/PR/CT/MS/Unknown.
