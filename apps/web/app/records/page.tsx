"use client";
import { trpc } from "../../lib/trpc";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 10);
}

export default function Records() {
  const q = trpc.pipeline.recordsBySource.useQuery();
  const c = trpc.pipeline.contractors.useQuery();

  return (
    <>
      <h1>Records by source</h1>
      <p className="lede">
        All six source categories with live ingested counts, provenance, and load timestamps. Source
        provenance (source URI, page hash, fetched-at) is preserved on every underlying record.
      </p>

      {q.isLoading && <div className="card muted">Loading…</div>}
      {q.error && <div className="card err">{q.error.message}</div>}
      {q.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th><th>Source</th><th className="num">Ingested</th><th className="num">Expected</th>
                <th>First loaded</th><th>Last loaded</th><th>What it contributes</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.category}>
                  <td><strong>{r.label}</strong></td>
                  <td>{r.source}</td>
                  <td className="num">{r.ingested.toLocaleString()}</td>
                  <td className="num">{r.expected ? r.expected.toLocaleString() : "—"}</td>
                  <td className="mono">{fmtDate(r.firstLoadedAt)}</td>
                  <td className="mono">{fmtDate(r.lastLoadedAt)}</td>
                  <td className="muted small">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Contractor reputation (BBB) — the contractor category</h2>
      <p className="muted small">
        Contractors are reconciled off permit contractors and scored from their BBB profile. Top by
        derived quality score:
      </p>
      {c.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Contractor</th><th>BBB rating</th><th>Accredited</th><th className="num">Complaints</th><th className="num">Score</th><th>Band</th></tr>
            </thead>
            <tbody>
              {c.data.map((x, i) => (
                <tr key={i}>
                  <td>{x.name}</td>
                  <td><span className="pill">{x.bbb_rating ?? "—"}</span></td>
                  <td>{x.is_accredited ? <span className="badge good">yes</span> : <span className="muted">no</span>}</td>
                  <td className="num">{x.complaint_count ?? 0}</td>
                  <td className="num">{x.score != null ? Number(x.score).toFixed(0) : "—"}</td>
                  <td>{x.score_band ? <span className="badge ok">{x.score_band}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
