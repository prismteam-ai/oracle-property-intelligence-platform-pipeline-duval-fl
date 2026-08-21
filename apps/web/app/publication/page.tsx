"use client";
import { useState } from "react";
import { trpc } from "../../lib/trpc";

const DEFAULT_SQL =
  "select property_usage_type, count(*) n, count(*) filter (where roof_age_years > 15) roof_gt15\nfrom properties\ngroup by 1 order by n desc limit 8";

export default function Publication() {
  const pub = trpc.pipeline.publication.useQuery();
  const status = trpc.agent.duckdbStatus.useQuery();
  const [sql, setSql] = useState(DEFAULT_SQL);
  const run = trpc.agent.duckdb.useMutation();

  return (
    <>
      <h1>IPFS · DuckDB · MCP</h1>
      <p className="lede">
        The decentralized-storage / MCP publication path is built and exercised as a dry-run: no
        owner PII is uploaded to public IPFS, while the non-PII coverage snapshot IS published so the
        MCP can report the county&apos;s real coverage.
      </p>

      {pub.data && (
        <>
          <h2>Content identifiers (CIDs)</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td><strong>Coverage snapshot</strong><br /><span className="muted small">non-PII · published to public IPFS · served by MCP getOracleDatasetInfo</span></td>
                  <td><span className="badge good">published</span></td>
                  <td className="mono small">{pub.data.coverageCid}</td>
                </tr>
                <tr>
                  <td><strong>Property query table</strong><br /><span className="muted small">carries owner PII · dry-run only · not uploaded</span></td>
                  <td><span className="badge warn">dry-run</span></td>
                  <td className="mono small">{pub.data.queryTableDryRunCid}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small" style={{ marginTop: 10 }}>
            <a href={pub.data.coverageGateway} target="_blank" rel="noreferrer">Open coverage on IPFS gateway ↗</a> ·{" "}
            <a href={pub.data.mcpHealth} target="_blank" rel="noreferrer">MCP health ↗</a> ·{" "}
            <span className="mono">{pub.data.mcpEndpoint}</span>
          </p>
          <div className="note small">{pub.data.note}</div>
        </>
      )}

      <h2>DuckDB query layer {status.data && <span className={`badge ${status.data.available ? "good" : "warn"}`}>{status.data.available ? "live in Lambda" : "unavailable"}</span>}</h2>
      <p className="muted small">
        The same flat, one-row-per-property query table (the shape the MCP&apos;s embedded DuckDB
        range-reads off IPFS) is queried here with DuckDB over a bundled Parquet snapshot. Read-only
        SQL over the <span className="pill">properties</span> view.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); run.mutate({ sql }); }}>
        <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={4} className="mono" />
        <button className="primary" type="submit" disabled={run.isPending} style={{ alignSelf: "flex-start" }}>
          {run.isPending ? "Running…" : "Run DuckDB query"}
        </button>
      </form>
      {run.error && <p className="err">{run.error.message}</p>}
      {run.data && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr>{Object.keys(run.data.rows[0] ?? {}).map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>
              {run.data.rows.map((r, i) => (
                <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className={typeof v === "number" ? "num" : ""}>{v == null ? "—" : String(v)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
