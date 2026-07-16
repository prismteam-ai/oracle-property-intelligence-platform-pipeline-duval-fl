# Duval open-data MCP

The Elephant open-data MCP (`elephant-xyz/elephant-mcp`) deployed to Vercel and wired to serve
Duval County, FL. It is stateless — one fresh MCP server per request — and reads the county's
published open data straight from public IPFS. Any agent (e.g. the `donphan` explorer) points at
this endpoint to query Duval property data and qualify answers by dataset coverage.

## Endpoint

- **MCP (streamable HTTP):** `https://elephant-mcp-three.vercel.app/mcp`
- **Health:** `https://elephant-mcp-three.vercel.app/health` → `{"status":"ok","server":"@elephant-xyz/mcp","version":"1.7.0"}`

The URL above is the project's stable production alias — it is public (no deployment-protection
wall) and stays constant across redeploys. Point an MCP client at it with `mcp.json` in this
folder.

## County wiring

Two per-county maps are configured on the deployment (see `duval-mcp-config.json` for the exact
values and rationale):

| Env map | Tool | Status | What it points at |
|---|---|---|---|
| `DATASET_COVERAGE_MAP` | `getOracleDatasetInfo` | **live** | Non-PII coverage snapshot on public IPFS (`Qm…Da5H`) |
| `PROPERTY_QUERY_TABLE_MAP` | `queryProperties` | **deferred** | Dry-run query-table CID (`Qm…34Le`), not enabled in the live env |

Only `DATASET_COVERAGE_MAP` is set on the live deployment. Both maps accept a JSON object of
`{ "<county>": "<location>" }` where a location is a local path or an http(s) URL that returns
the artifact.

### Why the property query table is deferred

The per-property query table carries owner PII and was published in **dry-run only** — no owner
PII was uploaded to public IPFS (decision record: `../../docs/decisions/ipfs-publication.md`,
sections 2, 5, 6). Its dry-run CID is recorded in `duval-mcp-config.json` as the wiring target
that activates once a **redacted, eligible** table is published.

It is intentionally left out of the live `PROPERTY_QUERY_TABLE_MAP`. `getOracleDatasetInfo` opens
a DuckDB view over the property query table whenever a county appears in that map; pointing it at
the intentionally-unreachable dry-run CID makes the dataset-info call fail and would suppress the
county's coverage. With the map unset for `duval`, `getOracleDatasetInfo` still returns real
coverage and `queryProperties` returns no rows for `duval` — the intended behaviour per the
decision record.

## Verification (against the live deployment)

`getOracleDatasetInfo({ "county": "duval" })` returns the real, published per-source coverage:

```json
{
  "county": "duval",
  "propertyCount": null,
  "propertyDatasetAvailable": false,
  "datasets": [
    { "source": "appraisal", "ingestedCount": 373, "expectedCount": 398315, "completionPercent": 0 },
    { "source": "bbb",       "ingestedCount": 14,  "expectedCount": null,   "completionPercent": null },
    { "source": "permits",   "ingestedCount": 1604,"expectedCount": null,   "completionPercent": null },
    { "source": "sunbiz",    "ingestedCount": 0,   "expectedCount": null,   "completionPercent": null }
  ]
}
```

(`firstLoadedAt` / `lastLoadedAt` / `cid` / `ipnsLabel` fields elided above for brevity.)

`queryProperties({ "county": "duval", "sql": "SELECT count(*) AS n FROM properties" })` returns no
rows, by design:

```json
{
  "error": "Failed to run property query",
  "details": "County 'duval' is not served by this deployment's properties query table."
}
```

## Reproduce the deployment

From an `elephant-xyz/elephant-mcp` checkout:

```bash
npm install
npm run build:vercel                       # Nitro Vercel preset + @noble/hashes patch
vercel link --yes                          # create/link the Vercel project
printf '%s' '{"duval":"https://ipfs.filebase.io/ipfs/QmRx1GjJGMTeoXzVz6gfhxty6yucj2aPZoN2a4CaYkDa5H"}' \
  | vercel env add DATASET_COVERAGE_MAP production
vercel deploy --prebuilt --prod --yes      # deploy the prebuilt Build Output
```

No secrets are committed here: the CIDs and the alias URL are public; the Vercel token, project id,
and org id live only in the local (git-ignored) Vercel CLI state.
