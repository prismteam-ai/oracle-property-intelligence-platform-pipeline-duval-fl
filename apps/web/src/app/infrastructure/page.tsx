import { GATEWAY, QUERY_TABLE_IPNS, resolvePointer } from "@/lib/oracle";

export const dynamic = "force-dynamic";

export default async function InfrastructurePage() {
  const pointer = await resolvePointer().catch(() => undefined);

  return (
    <>
      <h1>Running without infrastructure</h1>
      <p className="muted" style={{ maxWidth: "72ch", marginTop: 8 }}>
        The story&rsquo;s constraint is that Oracle carries no ongoing
        infrastructure cost by default. That is an architectural claim, so it is
        worth showing rather than asserting.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>There is no database</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Nothing in the read path stores data. This site resolves a published
          IPNS pointer, fetches the immutable Parquet behind it, and queries it
          with an in-process DuckDB. Every count and every table on this site is
          a SQL query against a file on IPFS. Stop this container and no data is
          lost, because it holds none.
        </p>
      </div>

      <h2 style={{ marginTop: 32 }}>What actually costs money</h2>
      <div className="table-scroll card" style={{ marginTop: 12, padding: 0 }}>
        <table data-testid="cost-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Runs when</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Published dataset (IPFS pin)</td>
              <td>Always available</td>
              <td>Filebase free tier — 40 MB of a 5 GB allowance</td>
            </tr>
            <tr>
              <td>Ingestion pipeline</td>
              <td>Only while a run is executing</td>
              <td>Seconds of compute; nothing between runs</td>
            </tr>
            <tr>
              <td>DuckDB warehouse</td>
              <td>Only during a run</td>
              <td>A file, not a service — no port, no process</td>
            </tr>
            <tr>
              <td>This site and the MCP</td>
              <td>Stateless</td>
              <td>Each consumer runs their own; no shared backend</td>
            </tr>
            <tr>
              <td>Source data</td>
              <td>Public</td>
              <td>Florida DOR and Overture — free, unauthenticated</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>The consumer model</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Because the data is content-addressed and public, serving it to one
          consumer costs the same as serving it to a thousand: the pin. There is
          no API to scale and no per-tenant backend. Anyone can point their own
          MCP at the same address and be independent of this deployment
          entirely.
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
        >{`# Query the dataset directly — no account, no server
duckdb -c "INSTALL httpfs; LOAD httpfs;
  SELECT count(*) FROM read_parquet('${pointer?.cidUrl ?? `${GATEWAY}/ipns/${QUERY_TABLE_IPNS}`}');"`}</pre>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>What this trade costs</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Being honest about the other side of it: because there is no database,
          there is no write path for consumers, no per-user state, and no
          sub-second freshness — the data is as current as the last published
          run. Reads are also gateway-dependent, which is why the pointer is
          resolved once and the immutable CID is read directly. Those are real
          limits, and they are the price of the property that matters here:
          nothing has to stay running for the data to stay available.
        </p>
      </div>
    </>
  );
}
