"use client";
import { useState } from "react";
import { WORKFLOWS, type WorkflowId } from "@oracle-duval/shared";
import { trpc } from "../../lib/trpc";

function factLabel(k: string): string {
  return k.replace(/_/g, " ").replace(/\bm\b/, "(m)");
}

export default function Workflows() {
  const [id, setId] = useState<WorkflowId>("roof_age");
  const spec = WORKFLOWS.find((w) => w.id === id)!;
  const q = trpc.workflows.run.useQuery({ id, limit: 50 }, { enabled: id !== "records_by_source" });

  return (
    <>
      <h1>Inquiry workflows</h1>
      <p className="lede">
        The six required property-intelligence questions answered on real reconciled records, each
        with its derivation basis, honest coverage, and source citations.
      </p>

      <div className="chips">
        {WORKFLOWS.filter((w) => w.id !== "records_by_source").map((w) => (
          <button key={w.id} className={`chip ${w.id === id ? "active" : ""}`} onClick={() => setId(w.id)}>
            {w.title}
          </button>
        ))}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>{spec.title}</h2>
        <p className="muted">{spec.question}</p>
        <p className="small"><strong>Basis:</strong> {spec.basis}</p>
        {spec.pendingNote && <div className="note warn small"><strong>Pending backfill:</strong> {spec.pendingNote}</div>}

        {q.isLoading && <p className="muted">Running query…</p>}
        {q.error && <p className="err">{q.error.message}</p>}
        {q.data && (
          <>
            <div className="grid tiles" style={{ margin: "14px 0" }}>
              <div className="tile"><div className="n">{q.data.matched.toLocaleString()}</div><div className="k">matching parcels</div></div>
              <div className="tile">
                <div className="n">{q.data.coverage.populated}/{q.data.coverage.total}</div>
                <div className="k">fact populated</div>
                <div className="bar"><span style={{ width: `${Math.round((q.data.coverage.populated / Math.max(1, q.data.coverage.total)) * 100)}%` }} /></div>
              </div>
              <div className="tile"><div className="n">{q.data.coverage.eligible}</div><div className="k">eligible parcels</div></div>
            </div>

            {q.data.rows.length === 0 ? (
              <p className="muted">No parcels match today. {q.data.pendingNote ?? ""}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Folio</th><th>Situs address</th><th>Use</th>
                      {Object.keys(q.data.rows[0]!.facts).map((k) => <th key={k}>{factLabel(k)}</th>)}
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.rows.slice(0, 25).map((r) => (
                      <tr key={r.folio}>
                        <td className="mono">{r.folio}</td>
                        <td>{r.situs_address ?? "—"}</td>
                        <td className="small">{r.property_usage_type ?? "—"}</td>
                        {Object.values(r.facts).map((v, i) => (
                          <td key={i} className={typeof v === "number" ? "num" : ""}>
                            {typeof v === "boolean" ? (v ? "yes" : "no") : v == null ? "—" : String(v)}
                          </td>
                        ))}
                        <td>
                          <details>
                            <summary>{r.citations.length} citations · basis</summary>
                            <div style={{ marginTop: 8 }}>
                              {r.citations.map((c, i) => (
                                <div key={i} className="cite">• {c.source_system} — {c.contributes}{c.source_record_key ? ` [${c.source_record_key}]` : ""}</div>
                              ))}
                              {r.basis != null && <pre>{JSON.stringify(r.basis, null, 2)}</pre>}
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
