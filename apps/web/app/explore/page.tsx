"use client";
import { useState } from "react";
import { trpc } from "../../lib/trpc";

export default function Explore() {
  const [folio, setFolio] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const q = trpc.entities.explore.useQuery({ folio: active ?? "" }, { enabled: active != null });

  return (
    <>
      <h1>Explore a parcel</h1>
      <p className="lede">
        Look up one parcel by its appraiser folio (RE#) to see its reconciled entities and
        relationships — owners, permits, contractors, and coordinate — with provenance. Try{" "}
        <button className="link" onClick={() => { setFolio("1677334550"); setActive("1677334550"); }}>1677334550</button> or{" "}
        <button className="link" onClick={() => { setFolio("0021130200"); setActive("0021130200"); }}>0021130200</button>.
      </p>

      <form className="row" onSubmit={(e) => { e.preventDefault(); setActive(folio.trim()); }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="folio">Folio / RE#</label>
          <input id="folio" value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="e.g. 1677334550" />
        </div>
        <button className="primary" type="submit" disabled={folio.trim().length < 3}>Explore</button>
      </form>

      {q.isLoading && <div className="card muted" style={{ marginTop: 16 }}>Loading parcel…</div>}
      {q.error && <div className="card err" style={{ marginTop: 16 }}>{q.error.message}</div>}
      {q.data && !q.data.found && <div className="card" style={{ marginTop: 16 }}>No parcel found for folio {active}.</div>}
      {q.data?.found && q.data.property && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}>{q.data.property.situs_address ?? "(no situs)"} <span className="pill">{q.data.property.folio}</span></h2>
          <div className="grid tiles">
            <div className="tile"><div className="n">{q.data.property.owners.count}</div><div className="k">owner(s) · {q.data.property.owners.type}</div></div>
            <div className="tile"><div className="n">{q.data.property.permit_count}</div><div className="k">permits</div></div>
            <div className="tile"><div className="n">{q.data.property.built_year ?? "—"}</div><div className="k">built year</div></div>
            <div className="tile"><div className="n">{q.data.property.coordinate ? "yes" : "no"}</div><div className="k">geocoded</div></div>
          </div>

          <h2>Derived facts</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {Object.entries(q.data.property.facts).map(([k, v]) => (
                  <tr key={k}><td className="muted">{k.replace(/_/g, " ")}</td>
                    <td>{typeof v === "boolean" ? (v ? "yes" : "no") : v == null ? "—" : String(v)}</td></tr>
                ))}
                {q.data.property.coordinate && (
                  <tr><td className="muted">coordinate</td><td className="mono">{q.data.property.coordinate.lat}, {q.data.property.coordinate.lon}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {q.data.property.contractor_names.length > 0 && (
            <>
              <h2>Linked contractors</h2>
              <div>{q.data.property.contractor_names.map((n, i) => <span key={i} className="pill" style={{ marginRight: 6 }}>{n}</span>)}</div>
            </>
          )}

          <h2>Provenance</h2>
          {q.data.property.citations.map((c, i) => (
            <div key={i} className="cite">• {c.source_system} — {c.contributes}{c.source_uri ? ` · ${c.source_uri}` : ""}{c.page_sha256 ? ` · sha256:${c.page_sha256.slice(0, 12)}…` : ""}</div>
          ))}
        </div>
      )}
    </>
  );
}
