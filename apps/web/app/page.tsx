"use client";
import { trpc } from "../lib/trpc";

function Tile({ n, k }: { n: number | string; k: string }) {
  return (
    <div className="tile">
      <div className="n">{typeof n === "number" ? n.toLocaleString() : n}</div>
      <div className="k">{k}</div>
    </div>
  );
}

export default function Overview() {
  const q = trpc.pipeline.summary.useQuery();
  return (
    <>
      <h1>Pipeline run — Duval County, FL</h1>
      <p className="lede">
        Real county records ingested from six sources, reconciled into canonical, provenance-tracked
        entities in a hosted query DB, and served here behind auth. Counts are read live from the
        database on every request — nothing is hardcoded.
      </p>

      {q.isLoading && <div className="card muted">Loading pipeline summary…</div>}
      {q.error && <div className="card err">{q.error.message}</div>}
      {q.data && (
        <>
          <h2>Reconciled entities</h2>
          <div className="grid tiles">
            <Tile n={q.data.entities.properties} k="Properties (parcels)" />
            <Tile n={q.data.entities.coordinates} k="Coordinates (geocode)" />
            <Tile n={q.data.entities.permits} k="Permits (JaxEPICS)" />
            <Tile n={q.data.entities.owners_people} k="Owner persons" />
            <Tile n={q.data.entities.owners_companies} k="Owner companies" />
            <Tile n={q.data.entities.deeds} k="Deeds / sales" />
            <Tile n={q.data.entities.contractors} k="Contractors (BBB)" />
          </div>

          <h2>Derived enrichment facts</h2>
          <div className="grid tiles">
            <Tile n={q.data.facts.roof_age} k="Roof age (permit-derived)" />
            <Tile n={q.data.facts.water_view} k="Water view" />
            <Tile n={q.data.facts.near_transit} k="Near transit / Starbucks" />
            <Tile n={q.data.facts.regional_owner} k="Regional owner (owner locality)" />
            <Tile n={q.data.withCoordinate} k="Parcels with a coordinate" />
            <Tile n={q.data.enrichmentComputed} k="Enrichment rows computed" />
          </div>

          <div className="note small" style={{ marginTop: 20 }}>
            <strong>Honest scale.</strong> Geo-derived facts (transit, water) are populated for the{" "}
            {q.data.withCoordinate} geocoded parcels; roof age for the {q.data.facts.roof_age} parcels
            with a linked re-roof permit. Regional-owner is banded for {q.data.facts.regional_owner}{" "}
            parcels from the owner&apos;s real mailing locality (in-county / in-state / out-of-state
            vs the Duval situs) — no locality is fabricated.
          </div>
        </>
      )}
    </>
  );
}
