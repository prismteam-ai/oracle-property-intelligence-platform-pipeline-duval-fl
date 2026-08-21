import type { ReactNode } from "react";

export function Stat({
  value,
  label,
  hint,
  testId,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="card" data-testid={testId}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint ? (
        <div className="subtle" style={{ marginTop: 6 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function num(value: unknown): string {
  // The null check comes first on purpose. `Number(null)` is 0, so a missing
  // count rendered a confident "0" — "the roll records no living area" and
  // "this parcel has zero square feet of living area" are different claims,
  // and the product's stated rule is that a gap is an em-dash.
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

export function money(value: unknown): string {
  // A recorded price of $0 is data, not a gap. Florida quit-claims, trust
  // re-titling and intra-family transfers are routinely recorded at $0, and
  // that zero is itself the signal the tenure caveat is built on.
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) && n >= 0
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : "—";
}

/** Byte sizes, scaled. "0.00 MB" for a 41 KB artifact reads as "empty". */
export function bytes(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function cell(value: unknown, numeric?: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (numeric) {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { maximumFractionDigits: 1 })
      : String(value);
  }
  return String(value);
}

/**
 * Evidence block. Every derived answer in this app shows the SQL that produced
 * it, what the answer rests on, and what it cannot support — so a reader can
 * disagree with the method rather than having to trust the number.
 */
export function Evidence({
  sql,
  basis,
  caveat,
  pointer,
  durationMs,
}: {
  sql: string;
  basis: string;
  caveat: string;
  pointer?: { cid: string; ipnsName: string; resolvedFrom: string };
  durationMs?: number;
}) {
  return (
    <section style={{ marginTop: 28 }} data-testid="evidence">
      <h2>Evidence</h2>
      <div className="grid" style={{ marginTop: 12 }}>
        <div className="card">
          <h3>Query executed</h3>
          <pre
            className="mono"
            data-testid="evidence-sql"
            style={{
              marginTop: 10,
              marginBottom: 0,
              overflowX: "auto",
              color: "var(--fg-muted)",
              whiteSpace: "pre",
            }}
          >
            {sql}
          </pre>
          {durationMs !== undefined ? (
            <div className="subtle" style={{ marginTop: 10 }}>
              Answered in {durationMs} ms against the published Parquet
              artifact, fetched once from IPFS and queried in-process by DuckDB.
              No database is involved.
            </div>
          ) : null}
        </div>

        <div className="card">
          <h3>What this is derived from</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            {basis}
          </p>
        </div>

        <div className="card" style={{ borderColor: "var(--border-strong)" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Caveat
            <span className="badge badge-warn">read this</span>
          </h3>
          <p className="muted" style={{ marginTop: 8 }} data-testid="caveat">
            {caveat}
          </p>
        </div>

        {pointer ? (
          <div className="card">
            <h3>Source</h3>
            <table style={{ marginTop: 8 }}>
              <tbody>
                <tr>
                  <td className="muted">IPNS</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>
                    {pointer.ipnsName}
                  </td>
                </tr>
                <tr>
                  <td className="muted">CID</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>
                    {pointer.cid}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Resolved via</td>
                  <td>{pointer.resolvedFrom}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Shown when the IPFS gateway is unreachable. A labelled degraded state is
 * honest and still tells the reader what the page would contain; a blank page
 * or a spinner tells them nothing.
 */
export function Unavailable({
  error,
  kind = "source",
}: {
  error: string;
  /** "source" blames the upstream artifact; "query" blames the caller's SQL. */
  kind?: "source" | "query";
}) {
  return (
    <div
      className="card"
      data-testid="unavailable"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {kind === "query" ? "Query rejected" : "Data temporarily unreachable"}
        <span className="badge badge-warn">
          {kind === "query" ? "check the query" : "upstream"}
        </span>
      </h2>
      <p className="muted" style={{ marginTop: 10 }}>
        {kind === "query"
          ? "That statement was not accepted. Queries must be a single read-only SELECT against the properties view — table functions and references to anything else are rejected. Edit the query and run it again."
          : "This page reads the published dataset from IPFS. The artifact could not be retrieved, so there is nothing to show; the app holds no database of its own to fall back to. Reloading usually resolves it."}
      </p>
      <pre
        className="mono subtle"
        style={{ marginTop: 12, marginBottom: 0, whiteSpace: "pre-wrap" }}
      >
        {error}
      </pre>
    </div>
  );
}
