import Link from "next/link";
import { Stat, Unavailable, num } from "@/components/ui";
import { QUESTIONS } from "@/lib/questions";
import { runQuery } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Totals {
  properties: number;
  with_coordinates: number;
  residential: number;
  owners: number;
  roof_over_15: number;
  waterfront: number;
  near_transit: number;
  near_starbucks: number;
  out_of_state: number;
  with_recorded_sale: number;
}

export default async function OverviewPage() {
  let totals: Totals | undefined;
  let error: string | undefined;
  let pointer: Awaited<ReturnType<typeof runQuery>>["pointer"] | undefined;
  let durationMs = 0;

  try {
    const result = await runQuery<Totals>(`
      SELECT
        count(*)                                                        AS properties,
        count(*) FILTER (WHERE latitude IS NOT NULL)                    AS with_coordinates,
        count(*) FILTER (WHERE property_usage_type = 'residential')     AS residential,
        count(DISTINCT owner_name)                                      AS owners,
        count(*) FILTER (WHERE roof_age_years > 15)                     AS roof_over_15,
        count(*) FILTER (WHERE water_view_class = 'waterfront')         AS waterfront,
        count(*) FILTER (WHERE walkable_to_transit)                     AS near_transit,
        count(*) FILTER (WHERE walkable_to_starbucks)                   AS near_starbucks,
        count(*) FILTER (WHERE owner_region_class = 'out_of_state')     AS out_of_state,
        count(*) FILTER (WHERE last_sale_date IS NOT NULL)              AS with_recorded_sale
      FROM properties
    `);
    totals = result.rows[0];
    pointer = result.pointer;
    durationMs = result.durationMs;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <h1>Oracle Property Intelligence Pipeline</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        Continuous, incremental ingestion of Duval County, Florida public
        property records into a DuckDB warehouse, published as content-addressed
        artifacts on Elephant IPFS and served to agents over MCP. Every number
        on this page was just read from a Parquet file on IPFS — there is no
        database behind this site.
      </p>

      {error ? (
        <div style={{ marginTop: 24 }}>
          <Unavailable error={error} />
        </div>
      ) : null}

      {totals ? (
        <>
          <div className="grid grid-3" style={{ marginTop: 24 }}>
            <Stat
              testId="stat-properties"
              value={num(totals.properties)}
              label="Properties"
              hint="Every parcel on the Duval real-property roll"
            />
            <Stat
              testId="stat-coordinates"
              value={num(totals.with_coordinates)}
              label="With coordinates"
              hint={`${((totals.with_coordinates / totals.properties) * 100).toFixed(2)}% of parcels`}
            />
            <Stat
              testId="stat-owners"
              value={num(totals.owners)}
              label="Distinct owners"
              hint="Normalised from the roll's owner names"
            />
          </div>

          <h2 style={{ marginTop: 36 }}>What the data answers</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Counts across the whole county, live from the published artifact.
          </p>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            <Stat
              testId="stat-roof"
              value={num(totals.roof_over_15)}
              label="Roofs over 15 years"
            />
            <Stat
              testId="stat-waterfront"
              value={num(totals.waterfront)}
              label="Waterfront"
            />
            <Stat
              testId="stat-transit"
              value={num(totals.near_transit)}
              label="Walk to transit"
            />
            <Stat
              testId="stat-starbucks"
              value={num(totals.near_starbucks)}
              label="Walk to Starbucks"
            />
            <Stat
              testId="stat-outofstate"
              value={num(totals.out_of_state)}
              label="Out-of-state owners"
            />
            <Stat
              testId="stat-sales"
              value={num(totals.with_recorded_sale)}
              label="With a recorded sale"
            />
          </div>

          <h2 style={{ marginTop: 36 }}>Ask a question</h2>
          <div className="grid grid-3" style={{ marginTop: 16 }}>
            {QUESTIONS.map((q) => (
              <Link
                key={q.slug}
                href={`/questions/${q.slug}`}
                className="card"
                data-testid={`question-card-${q.slug}`}
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <h3>{q.title}</h3>
                <p className="subtle" style={{ marginTop: 8 }}>
                  {q.prompt}
                </p>
              </Link>
            ))}
          </div>

          {pointer ? (
            <div className="card" style={{ marginTop: 32 }}>
              <h3>Read path</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                Resolved the stable IPNS pointer{" "}
                <code>{pointer.ipnsName.slice(0, 20)}…</code> to CID{" "}
                <code>{pointer.cid}</code>, then answered the query above in{" "}
                <strong>{durationMs} ms</strong> over HTTP range requests.
              </p>
              <p style={{ marginTop: 12 }}>
                <Link href="/infrastructure" className="btn btn-secondary">
                  How this runs without a database
                </Link>
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
