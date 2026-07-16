# Duval County — publish record (query-table dry-run + coverage publish)

Run-record for the indexing/publish stage (Task 9): export the columnar query table from the
Neon query DB, pass the folio-cardinality gate, dry-run the query-table publish (produces the
CID + MCP wiring target but uploads no owner PII), and **really** publish the non-PII
dataset-coverage artifact to public IPFS. Driven through the `county-query-table-publish` skill
(the `elephant-query-db` export/validate/publish scripts) plus the shipped dataset-coverage
tooling. County slug used end-to-end: **`duval`**.

Publication policy for this deliverable: the query-table (owner PII) publish is **dry-run only**;
the dataset-coverage artifact (aggregate, non-PII) is a **real** upload. Rationale:
`docs/decisions/ipfs-publication.md`.

## 1. Query-table export (Neon → Parquet)

`export:query-table --county duval` — one flat row per folio, ~37 scalar columns.

- **Rows: 373** (one per distinct folio `request_identifier`); `rowsWithCid: 0`.
- `property_cid` is null for every row: the consolidation manifest
  (`county-open-data-publish`) is a separate story and was not run, so there is no
  `propertyId → CID` map to left-join. The export still succeeds; documented in the coverage
  snapshot.
- Situs address resolves from the structured address rows (Duval loaded no
  `unnormalized_addresses`, so the free-text situs path is empty and the export uses its
  structured-column fallback — correct here, since the loaded addresses are situs, not mailing).
- The Parquet is written to a working directory outside the repo. **It carries owner PII and is
  never committed** (`.gitignore` guards `.query-table-export/` and `*.parquet`).

## 2. Validation gate (folio cardinality + Neon reconcile) — PASSED

`validate:query-table --county duval` — `query_table_validation_passed`:

- Parquet-internal: `rowCount = 373`, `distinctRequestIdentifiers = 373`,
  `nullRequestIdentifiers = 0` (folio unique, no dupes, no nulls).
- Reconcile vs Neon (**not** skipped): Neon distinct folio for `duval_appraiser` = **373** ==
  parquet rowCount 373.

## 3. Query-table publish — DRY-RUN (no PII upload)

`publish:query-table --county duval --dry-run` — `query_table_publish_dry_run`, no S3 PUT, no
IPNS write:

- **Local CID (dry-run): `QmY5RjCq1ZPfPSa9qfbmtn5uC2QYLYamKFse4NT8yE34Le`**
  (content-addressed, computed locally; 171,630 bytes).
- Would PUT: `s3://oracle-duval-jz/query-tables/duval/query-table.parquet`.
- IPNS label (would upsert on a real publish): `oracle-query-table-duval`.
- MCP wiring target (resolved on a real publish):
  `PROPERTY_QUERY_TABLE_MAP={"duval":"https://ipfs.filebase.io/ipns/<network_key>"}`.
- **No owner PII was uploaded to public IPFS.** Consequently `queryProperties` returns no rows
  for Duval over the MCP — the expected result of the publication deferral, not a defect. The
  full owner-level data is served only from the authenticated hosted layer.

## 4. Dataset coverage — REAL publish (non-PII aggregate metadata)

Coverage table populated in Neon (`oracle_dataset_coverage`, created from migration 0006 which
had not materialised in this environment), then driven through the kit backfill and corrected to
honest per-source figures:

| county | source | ingested_count | expected_count |
|---|---|---:|---:|
| duval | appraisal | 373 | 398,315 |
| duval | permits | 1,604 | — |
| duval | bbb | 14 | — |
| duval | sunbiz | 0 | — |

- The kit's generic `^duval_` permit counter returns 2,959 because it also sweeps in 1,355
  appraiser building-improvement rows; the coverage row is corrected to the 1,604 actual JaxEPICS
  permits. BBB (14) is upserted explicitly (the kit's global-source attribution needs a
  `source_artifact_uri` to parse a county from, which the Duval BBB rows do not carry). Sunbiz is
  recorded as 0 to represent the blocked source transparently. See `docs/coverage-snapshot.md`.

Snapshot written and **really uploaded** to Filebase → public IPFS:

- Artifact: `.dataset-coverage/duval/dataset-coverage.json` (849 bytes, 4 datasets, no owner PII).
- **Object CID: `QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H`** — Filebase's returned
  `x-amz-meta-cid` matches the locally-computed CID (the pin is confirmed).
- Object key: `s3://oracle-duval-jz/dataset-coverage/duval/dataset-coverage.json`.
- **Resolves over the public gateway** (verified HTTP 200):
  `https://ipfs.filebase.io/ipfs/QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H`.
- The committed `.dataset-coverage/duval/dataset-coverage.json` is byte-identical to the published
  object (same CID).
- MCP wiring (direct-CID form, ready for the MCP deploy story):
  `DATASET_COVERAGE_MAP={"duval":"https://ipfs.filebase.io/ipfs/QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H"}`.

### IPNS pointer — deferred (environment gap, documented)

The mutable IPNS pointer `oracle-dataset-coverage-duval` was **not** created: the Filebase IPNS
REST API needs `FILEBASE_API_TOKEN`, which is not provisioned in this environment (only the S3
keys are). The upload still completes and the artifact is fully resolvable at its immutable CID
above, so coverage is genuinely published. When the IPNS token is available, the shipped
`upload-coverage-to-filebase.ts` upserts `oracle-dataset-coverage-duval → <cid>` and prints the
`k51…` network key for the IPNS-form `DATASET_COVERAGE_MAP`; nothing else changes.

## 5. DuckDB query layer (over the exported Parquet)

DuckDB reads the query-table Parquet directly (the same mechanism the MCP's embedded DuckDB
uses). Sample results over `CREATE VIEW properties AS SELECT * FROM read_parquet(<query-table>)`:

- `SELECT count(*), count(DISTINCT request_identifier)` → **373, 373** (matches the gate).
- Top usage types → Commercial 98, OfficeBuilding 52, RetailStore 45, AutoSalesRepair 34,
  OpenStorage 28, Industrial 27 (commercial-first sample confirmed).
- `count(*) FILTER (WHERE has_permits)`, `sum(permit_count)` → **78 parcels, 1,604 linked
  permits** (cross-confirms the corrected permit coverage figure).
- Column non-null coverage → `address_zip` 373, `latitude` 169, `assessed_value` 373,
  `exterior_wall_material` 161, `property_cid` 0 (documented in the coverage snapshot).

## Method / hygiene

- Driven through the `county-query-table-publish` skill's scripts in the `elephant-query-db`
  checkout (`export:` / `validate:` / `publish:` and the dataset-coverage tooling). No kit fork:
  the geo/derived enrichment stays in our own Neon layer and is not injected into the fixed
  query-table schema.
- No secrets, connection strings, or owner PII appear in this record. The query-table Parquet
  (PII) never leaves the working directory and is git-ignored.

## Remaining (separate stories)

- Property-consolidation open-data publish (produces the `property_cid` manifest).
- MCP deploy + wiring (`PROPERTY_QUERY_TABLE_MAP` / `DATASET_COVERAGE_MAP`) — Task 10.
- IPNS mutable pointers once `FILEBASE_API_TOKEN` is provisioned.
