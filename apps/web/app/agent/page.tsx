"use client";
import { useState } from "react";
import { trpc } from "../../lib/trpc";

const SAMPLES = [
  "Which properties have a roof older than 15 years?",
  "Show me properties with a water view.",
  "Which properties have had no recorded ownership exchange in 10 years?",
  "Which properties are owned by regional out-of-area owners?",
  "Which commercial properties are within walking distance of transit, and what is the distance basis?",
  "How many records were ingested per source?",
];

export default function AgentPage() {
  const [question, setQuestion] = useState("");
  const ask = trpc.agent.ask.useMutation();

  function run(q: string) {
    setQuestion(q);
    ask.mutate({ question: q });
  }

  const a = ask.data;
  return (
    <>
      <h1>Ask the agent</h1>
      <p className="lede">
        A hybrid retrieval-grounded + SQL/DuckDB agent over the reconciled Duval records. It routes
        the question to the right inquiry workflow, gathers evidence from SQL (exact facts +
        provenance) and semantic retrieval, and answers strictly from that evidence with citations.
      </p>

      <form className="row" onSubmit={(e) => { e.preventDefault(); if (question.trim().length > 2) run(question); }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="q">Question</label>
          <input id="q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about Duval County property records…" />
        </div>
        <button className="primary" type="submit" disabled={ask.isPending || question.trim().length < 3}>
          {ask.isPending ? "Thinking…" : "Ask"}
        </button>
      </form>

      <div className="chips" style={{ marginTop: 12 }}>
        {SAMPLES.map((s) => <button key={s} className="chip" onClick={() => run(s)}>{s}</button>)}
      </div>

      {ask.isPending && <div className="card muted">Retrieving evidence and reasoning over real records…</div>}
      {ask.error && <div className="card err">{ask.error.message}</div>}
      {a && (
        <div className="card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {a.workflow && <span className="badge ok">{a.workflow}</span>}
            {a.paths.map((p) => <span key={p} className="badge">{p}</span>)}
            <span className="muted small" style={{ marginLeft: "auto" }}>{a.model}</span>
          </div>
          <div className="answer">{a.answer}</div>
          {a.notes && <div className="note warn small" style={{ marginTop: 12 }}>{a.notes}</div>}

          {a.evidence.length > 0 && (
            <div className="evidence">
              <h2>Evidence ({a.evidence.length} parcels · {a.citations.length} citations)</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Folio</th><th>Situs</th><th>Key facts</th></tr></thead>
                  <tbody>
                    {a.evidence.map((e) => (
                      <tr key={e.folio}>
                        <td className="mono">{e.folio}</td>
                        <td className="small">{e.situs_address ?? "—"}</td>
                        <td className="small mono">{Object.entries(e.facts).filter(([, v]) => v != null).slice(0, 4).map(([k, v]) => `${k}=${v}`).join("  ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details style={{ marginTop: 10 }}>
                <summary>All source citations</summary>
                <div style={{ marginTop: 8 }}>
                  {a.citations.map((c, i) => (
                    <div key={i} className="cite">• folio {c.folio} — {c.source_system}: {c.contributes}{c.source_record_key ? ` [${c.source_record_key}]` : ""}</div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      )}
    </>
  );
}
