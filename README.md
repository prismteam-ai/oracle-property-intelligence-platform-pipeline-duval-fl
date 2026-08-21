# Oracle Property Intelligence Platform Pipeline - Duval County, FL

## Context

The Oracle ingestion pipeline has been started, but the full dataset has not been completely uploaded, reconciled, or demonstrated. The infrastructure must be designed so Oracle does not carry ongoing infrastructure cost by default. For this candidate, they are acting as both the Oracle and the builder, so they are responsible for completing the pipeline and proving the infrastructure approach.

The pipeline must be **continuous and incremental** (ongoing ingestion of new and changed records over time) and must **publish eligible data artifacts to Elephant IPFS** (the Elephant protocol’s decentralized storage layer, following Lexicon / elephant-cli / Filebase+IPNS conventions used by the Elephant oracle skills).

## Description

Complete the Oracle pipeline by continuously and incrementally loading all available county property, permit, ownership, business, contractor, location, and public-source data for Duval County, Florida into an MCP-ready database. Use DuckDB for local/portable analytical querying and **publish the data (and query-table artifacts) to Elephant IPFS** so that Oracle does not carry ongoing infrastructure cost by default, while still enabling UI and agent access to answer property intelligence questions.

The pipeline must demonstrate that data is ingested on an **ongoing basis** (not a one-shot bulk load): support incremental / windowed refreshes, preserve run history with record deltas and timestamps, and re-publish updated artifacts to Elephant IPFS.

## Acceptance Criteria

- Confirm the pipeline covers Duval County, Florida.
- Design and implement the pipeline as **continuous / incremental**:
  - Support ongoing ingestion of new and changed records (scheduled or on-demand refreshes, change detection or bounded windows, idempotent steps).
  - Maintain a visible history of pipeline runs (timestamps, source list, record counts, deltas, any source limitations).
  - Demonstrate that data continues to be ingested and published over time (multiple runs or simulated ongoing updates).
- Load available property, permit, ownership, contractor, business, and location/coordinate records into the database (and keep them current via the continuous pipeline).
- Reconcile duplicate entities across all uploaded datasets.
- Preserve source provenance for all uploaded records.
- Optimize pipeline performance where feasible; identify and document slow source sites or constrained contractor data sources.
- Design the infrastructure so Oracle does not carry ongoing infrastructure cost by default.
- **Publish the data to Elephant IPFS**:
  - Use Elephant protocol conventions (Lexicon-aware artifacts where applicable, content-addressed CIDs, preferably stable IPNS pointers suitable for MCP consumption).
  - Publish eligible dataset artifacts (and query-table / open-data artifacts) via the Elephant IPFS path (Filebase or equivalent gateway used by the Elephant ecosystem, following patterns such as `county-open-data-publish`).
  - Make the published CIDs / IPNS references visible and usable by the UI, agent, and MCP layer.
- Use DuckDB for local or portable analytical querying.
- Structure the database to support MCP access.
- Enable agent access to query the database.
- Provide a UI for exploring the uploaded data.
- Support questions about properties with roofs older than 15 years.
- Support questions about properties with a view of water.
- Support questions about properties that have not exchanged ownership in more than 10 years.
- Support questions about properties with regional owners.
- Support questions about properties within walking distance of public transportation using property coordinates.
- Support questions about properties within walking distance of Starbucks using property coordinates.
- Return source-backed answers where source data is available.
- Demonstrate the continuous pipeline (run history + incremental updates) and the uploaded dataset through the UI.
- Demonstrate the continuous pipeline and the uploaded dataset through an agent query.
- Demonstrate that Oracle can operate without carrying the infrastructure cost (DuckDB + Elephant IPFS).
- Confirm the candidate fulfilled both Oracle and builder responsibilities for this milestone.
- Pass the demo using real uploaded county records and real Elephant IPFS publications.

## Demo Transcript

- Presenter: “I will demonstrate that the Oracle pipeline for Duval County, Florida is continuous and incremental, that data is ingested on an ongoing basis, that eligible artifacts are published to Elephant IPFS, that the data is queryable through DuckDB, and that both the UI and agent can answer property intelligence questions.”
- Presenter: “First, I am opening the pipeline run summary and history.”
  - Expected Result: The system displays multiple runs (or an ongoing history), source list, record counts, deltas between runs, timestamps, and any documented source limitations — showing continuous / incremental ingestion.
- Presenter: “Show the total uploaded records by source and the most recent incremental updates.”
  - Expected Result: The system shows property, permit, ownership, contractor, business, and coordinate records with collection timestamps, provenance, and evidence of ongoing ingestion.
- Presenter: “Now I am opening the DuckDB-backed query layer.”
  - Expected Result: The system confirms that the loaded data is available for structured querying without requiring Oracle-hosted database infrastructure.
- Presenter: “Show the Elephant IPFS artifacts (CIDs / IPNS) created for the uploaded datasets.”
  - Expected Result: The system displays Elephant IPFS content identifiers and/or stable IPNS pointers for the published artifacts, confirming they follow Elephant conventions and are usable by MCP.
- Presenter: “Now I am using the UI to search for properties with roofs older than 15 years.”
  - Expected Result: The UI returns matching properties, supporting permit or property evidence, and source provenance where available.
- Presenter: “Show properties with a view of water.”
  - Expected Result: The UI returns properties identified using available location, parcel, or geographic indicators and explains the source basis.
- Presenter: “Show properties that have not exchanged ownership in more than 10 years.”
  - Expected Result: The system returns properties with ownership history showing no recorded exchange within the last 10 years.
- Presenter: “Show properties with regional owners.”
  - Expected Result: The system returns properties where owner location or ownership metadata indicates a regional owner.
- Presenter: “Show properties within walking distance of public transportation.”
  - Expected Result: The system uses property coordinates to return properties near public transportation and shows the distance calculation basis.
- Presenter: “Show properties within walking distance of Starbucks.”
  - Expected Result: The system uses property coordinates and nearby place data to return properties near Starbucks locations and shows the distance calculation basis.
- Presenter: “Now I am asking the same type of questions through the agent.”
  - Agent Prompt: “Which properties have roofs older than 15 years and have not exchanged ownership in more than 10 years?”
    - Expected Result: The agent returns matching properties, explains the reasoning, and includes source-backed evidence.
  - Agent Prompt: “Which properties are near public transportation and also have regional owners?”
    - Expected Result: The agent returns matching properties with coordinate-based distance logic and ownership evidence.
  - Agent Prompt: “Which properties appear to be strong candidates for further review based on ownership age, roof age, and location signals?”
    - Expected Result: The agent returns a ranked or filtered list using available data and clearly identifies any assumptions or missing data.
- Presenter: “Finally, I will show that the system is MCP-ready and that the data is served from Elephant IPFS.”
  - Expected Result: The system demonstrates an MCP-ready interface (or documented MCP-compatible query structure) that can resolve the published Elephant IPFS / IPNS artifacts without requiring Oracle-hosted infrastructure.

## Reference

- [Soofi XYZ Team Kit](https://github.com/soofi-xyz/soofi-xyz-team-kit)
- [Elephant Oracle Skills](https://github.com/elephant-xyz/skills)

---

# Implementation

_Everything above is the assignment. Everything below is what was built for it._

## Live

|                                                                                |                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| **App**                                                                        | https://oracle-web-production-1976.up.railway.app      |
| **MCP endpoint** (JSON-RPC 2.0 over HTTP POST)                                 | https://oracle-web-production-1976.up.railway.app/mcp  |
| **Guided demo**                                                                | https://oracle-web-production-1976.up.railway.app/demo |
| **Downstream consumer** — a residential acquisition CRM, a separate submission | https://crm-web-production-32c5.up.railway.app         |

Public, no login, nothing to install. Try the MCP without leaving the terminal:

```bash
curl -sX POST https://oracle-web-production-1976.up.railway.app/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":
       {"name":"queryProperties","arguments":{"sql":"SELECT count(*) AS n FROM properties"}}}'
```

## What is in it

**404,023 Duval County parcels** — the full Florida DOR 2026 preliminary tax
roll, joined to three vintages of parcel geometry (99.96% with coordinates) and
to Overture Places and water. Not a sample.

**A pipeline that is genuinely incremental.** Four published runs: a backfill,
two that ingest successive geometry vintages and record real inserts and
updates, and one scheduled run that read all 404,023 records and changed
nothing. That last one is the evidence — an idempotent no-op is a claim you can
check, where "it's incremental" is not.

**No database in the read path.** The app resolves an IPNS name to a CID,
fetches the published Parquet once, and queries it in-process with DuckDB. Any
consumer can point their own reader at the same address.

## Coverage, stated plainly

The assignment names six record categories. Three are ingested — property,
ownership and location — and **three are not**: permits, contractors (BBB) and
businesses (Sunbiz). Those columns publish as `NULL`, never as `false`, and
every page that would show them says so. Roof age is therefore derived from
effective year built rather than a roofing permit, which makes it an upper
bound; the affected pages say that too.

Every derived answer ships with the basis it rests on and the caveat that bounds
it. That is the point of the exercise as much as the numbers are.

## Running it

```bash
pnpm install
pnpm --filter @duval-oracle/web dev        # http://localhost:3000
```

| Variable                                                             | Required          | Default                 | What it does                                                                                          |
| -------------------------------------------------------------------- | ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                                  | for `/agent` only | —                       | The natural-language agent. Every other page works without it.                                        |
| `ORACLE_QUERY_TABLE_IPNS`                                            | no                | the published name      | The dataset pointer.                                                                                  |
| `ORACLE_QUERY_TABLE_CID`                                             | no                | —                       | Pin a CID directly if a pointer fails to propagate.                                                   |
| `ORACLE_RUN_HISTORY_CID`                                             | no                | the latest published    | Run history is CID-addressed; the free Filebase plan allows one IPNS name and the query table has it. |
| `ORACLE_MEMORY_LIMIT` / `ORACLE_THREADS` / `ORACLE_QUERY_TIMEOUT_MS` | no                | `512MB` / `2` / `20000` | Ceilings on the public SQL surface.                                                                   |

The worker needs Filebase credentials to publish (`S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_BUCKET`) and writes to `DATA_DIR`:

```bash
pnpm --filter @duval-oracle/worker exec tsx src/cli.ts \
  --mode incremental --roll 2026P --vintage 2026F
```

Runs are **manually triggered** today — there is no scheduler deployed. The
engine is incremental and idempotent, and the no-op run proves it; the cron that
would call it on a timer is not part of this milestone, and calling that
"continuous" without saying so would be overclaiming.

```bash
pnpm test          # 66 tests
pnpm type-check
pnpm format:check
```

## The public SQL surface

`/explore`, `/mcp` and `/agent` all accept caller-authored SQL against the
`properties` view, unauthenticated. Statements are validated by **parsing**
them, not by matching keywords: DuckDB's serializer refuses writes outright, and
what does parse is asserted to be a read whose every table reference is the
published view or a CTE it defines itself, with no table function anywhere in
the tree. A keyword blocklist was tried first and removed — it caught nothing
the parse does not, and it rejected `WHERE owner_name ILIKE '%LOAD%'` as a
write.

Queries run on their own connection under a shared memory limit, a thread cap
and a wall-clock timeout, so one expensive statement cannot hold the site.

## Design notes

- **[ADR 001 — no hosted database](docs/architecture-decisions/001-no-hosted-database.md)**
- **[ADR 002 — durable steps without Restate](docs/architecture-decisions/002-durable-steps-without-restate.md)**
