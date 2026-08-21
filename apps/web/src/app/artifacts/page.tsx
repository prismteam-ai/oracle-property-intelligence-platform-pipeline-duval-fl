import { Stat, Unavailable, num } from "@/components/ui";
import {
  GATEWAY,
  QUERY_TABLE_IPNS,
  resolvePointer,
  runHistory,
  parseJsonColumn,
} from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ArtifactRef {
  dataset?: string;
  cid?: string;
  cidUrl?: string;
  ipnsName?: string;
  ipnsLabel?: string;
  bytes?: number;
}

export default async function ArtifactsPage() {
  let pointer;
  let error: string | undefined;
  try {
    pointer = await resolvePointer();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const history = await runHistory();
  const latest = history?.runs.find(
    (r) => r.status === "success" && r.artifacts && r.artifacts !== "{}",
  );
  const artifacts = Object.values(
    parseJsonColumn<Record<string, ArtifactRef>>(latest?.artifacts ?? null, {}),
  );

  return (
    <>
      <h1>Elephant IPFS artifacts</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        The pipeline publishes its output as content-addressed artifacts on IPFS
        through Filebase. The query table carries a stable IPNS pointer that
        survives every republish; the supporting artifacts are immutable per-run
        snapshots, recorded against the run that produced them.
      </p>

      {error ? (
        <div style={{ marginTop: 20 }}>
          <Unavailable error={error} />
        </div>
      ) : pointer ? (
        <>
          <div
            className="card"
            style={{ marginTop: 24 }}
            data-testid="ipns-pointer"
          >
            <h2>Stable pointer</h2>
            <table style={{ marginTop: 12 }}>
              <tbody>
                <tr>
                  <td className="muted" style={{ width: 160 }}>
                    IPNS label
                  </td>
                  <td className="mono">oracle-query-table-duval</td>
                </tr>
                <tr>
                  <td className="muted">IPNS name</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>
                    <a href={pointer.ipnsUrl} data-testid="ipns-link">
                      {pointer.ipnsName}
                    </a>
                  </td>
                </tr>
                <tr>
                  <td className="muted">Resolves to CID</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>
                    <a href={pointer.cidUrl} data-testid="cid-link">
                      {pointer.cid}
                    </a>
                  </td>
                </tr>
                <tr>
                  <td className="muted">Resolved via</td>
                  <td>{pointer.resolvedFrom}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <h2>Consume it yourself</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              Nothing here is private. Any DuckDB can query the same dataset
              with no credentials and no server in between:
            </p>
            <pre
              className="mono"
              style={{
                marginTop: 12,
                marginBottom: 0,
                overflowX: "auto",
                color: "var(--fg-muted)",
              }}
            >{`INSTALL httpfs; LOAD httpfs;
SELECT count(*) FROM read_parquet('${pointer.cidUrl}');`}</pre>
            <p className="subtle" style={{ marginTop: 12 }}>
              The IPNS address is the stable one to bookmark. Resolve it once
              with a HEAD request and read the CID it returns — resolving per
              query makes the gateway re-resolve the name on every range
              request, which measured 4m14s against 1.2s by CID.
            </p>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <h2>Wire it into an MCP</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              This is exactly the value <code>elephant-mcp</code> expects in{" "}
              <code>PROPERTY_QUERY_TABLE_MAP</code>, which is what makes Duval
              servable alongside the counties already published.
            </p>
            <pre
              className="mono"
              style={{
                marginTop: 12,
                marginBottom: 0,
                overflowX: "auto",
                color: "var(--fg-muted)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >{`PROPERTY_QUERY_TABLE_MAP={"duval":"${GATEWAY}/ipns/${QUERY_TABLE_IPNS}"}`}</pre>
          </div>
        </>
      ) : null}

      {artifacts.length ? (
        <>
          <h2 style={{ marginTop: 36 }}>Published artifacts</h2>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <Stat
              value={num(artifacts.length)}
              label="Artifacts published"
              testId="stat-artifact-count"
            />
            <Stat
              value={`${(
                artifacts.reduce((n, a) => n + (a.bytes ?? 0), 0) / 1e6
              ).toFixed(1)} MB`}
              label="Total pinned"
            />
            <Stat
              value="1"
              label="Stable IPNS names"
              hint="Filebase plan limit"
            />
          </div>
          <div
            className="table-scroll card"
            style={{ marginTop: 16, padding: 0 }}
          >
            <table data-testid="artifacts-table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>CID</th>
                  <th className="num">Size</th>
                  <th>Address type</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((a) => (
                  <tr key={a.cid}>
                    <td>{a.dataset}</td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>
                      {a.cidUrl ? <a href={a.cidUrl}>{a.cid}</a> : a.cid}
                    </td>
                    <td className="num">
                      {a.bytes ? `${(a.bytes / 1e6).toFixed(2)} MB` : "—"}
                    </td>
                    <td>
                      {a.ipnsName ? (
                        <span className="badge badge-ok">IPNS + CID</span>
                      ) : (
                        <span className="badge">CID only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
