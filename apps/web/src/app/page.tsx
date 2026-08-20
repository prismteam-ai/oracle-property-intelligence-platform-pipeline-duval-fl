export const dynamic = "force-dynamic";

export default function OverviewPage() {
  return (
    <>
      <h1>Oracle Property Intelligence Pipeline</h1>
      <p className="muted" style={{ maxWidth: "68ch", marginTop: 8 }}>
        Continuous, incremental ingestion of Duval County, Florida public property
        records into a DuckDB warehouse, published as content-addressed artifacts on
        Elephant IPFS and served to agents over MCP — with no hosted database in the
        read path.
      </p>

      <div className="card" style={{ marginTop: 24 }} data-testid="build-status">
        <h2>Deployment live</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          This runtime is deployed and reachable. Data ingestion, IPFS publication and
          the MCP query surface are being wired in now — each section of the navigation
          above becomes live as its stage lands.
        </p>
      </div>
    </>
  );
}
