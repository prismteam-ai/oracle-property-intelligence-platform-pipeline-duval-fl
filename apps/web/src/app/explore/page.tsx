import Link from "next/link";
import { Unavailable, cell, num } from "@/components/ui";
import { PROPERTIES_VIEW, runQuery, schema } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_SQL = `SELECT request_identifier, address_street, address_city,
       owner_name, owner_region_class, market_value,
       built_year, roof_age_years, water_view_class
FROM properties
WHERE property_usage_type = 'residential'
  AND market_value > 250000
ORDER BY market_value DESC`;

const PRESETS: Array<{ label: string; sql: string }> = [
  {
    label: "Largest owner portfolios",
    sql: `SELECT owner_name, count(*) AS parcels, sum(market_value) AS total_just_value
FROM properties
WHERE owner_name IS NOT NULL AND owner_name <> ''
GROUP BY owner_name
ORDER BY parcels DESC`,
  },
  {
    label: "Value by city",
    sql: `SELECT address_city, count(*) AS parcels,
       round(median(market_value)) AS median_just_value
FROM properties
WHERE address_city IS NOT NULL AND address_city <> ''
GROUP BY address_city
ORDER BY parcels DESC`,
  },
  {
    label: "Oldest housing stock by ZIP",
    sql: `SELECT address_zip, count(*) AS parcels,
       round(avg(roof_age_years), 1) AS avg_roof_age
FROM properties
WHERE roof_age_years IS NOT NULL AND address_zip IS NOT NULL
GROUP BY address_zip
HAVING count(*) > 500
ORDER BY avg_roof_age DESC`,
  },
  {
    label: "Out-of-state investor concentration",
    sql: `SELECT address_city, owner_mailing_state, count(*) AS parcels
FROM properties
WHERE owner_region_class = 'out_of_state'
GROUP BY address_city, owner_mailing_state
ORDER BY parcels DESC`,
  },
];

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sqlParam = raw["sql"];
  const sql = (Array.isArray(sqlParam) ? sqlParam[0] : sqlParam) ?? DEFAULT_SQL;

  let rows: Array<Record<string, unknown>> = [];
  let columns: string[] = [];
  let durationMs = 0;
  let error: string | undefined;
  let pointer;

  try {
    const result = await runQuery<Record<string, unknown>>(sql, { limit: 100 });
    rows = result.rows;
    columns = rows[0] ? Object.keys(rows[0]) : [];
    durationMs = result.durationMs;
    pointer = result.pointer;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const cols = await schema().catch(() => []);

  return (
    <>
      <h1>Explore the dataset</h1>
      <p className="muted" style={{ maxWidth: "70ch", marginTop: 8 }}>
        Run read-only SQL against the published Duval query table. The view is
        called <code>{PROPERTIES_VIEW}</code> and holds one row per parcel — the
        same view an <code>elephant-mcp</code> consumer queries.
      </p>

      <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <Link
            key={p.label}
            href={`/explore?sql=${encodeURIComponent(p.sql)}`}
            className="btn btn-secondary"
            data-testid={`preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <form method="get" className="card" style={{ marginTop: 16 }}>
        <label className="stat-label" htmlFor="sql">
          Query
        </label>
        <textarea
          id="sql"
          name="sql"
          rows={8}
          defaultValue={sql}
          data-testid="sql-input"
          style={{
            width: "100%",
            marginTop: 8,
            background: "var(--bg-sunken)",
            color: "var(--fg)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)",
            padding: "10px 12px",
            fontFamily: "var(--mono)",
            fontSize: "0.85rem",
            resize: "vertical",
          }}
        />
        <button
          className="btn"
          type="submit"
          style={{ marginTop: 12 }}
          data-testid="run-sql"
        >
          Run query
        </button>
      </form>

      {error ? (
        <div style={{ marginTop: 20 }}>
          <Unavailable error={error} kind="query" />
        </div>
      ) : (
        <>
          <p
            className="subtle"
            style={{ marginTop: 16 }}
            data-testid="explore-meta"
          >
            {num(rows.length)} rows in {durationMs} ms
            {pointer ? ` · read from CID ${pointer.cid}` : ""}
          </p>
          <div
            className="table-scroll card"
            style={{ marginTop: 8, padding: 0 }}
          >
            <table data-testid="explore-results">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c}>{cell(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cols.length ? (
        <section style={{ marginTop: 32 }}>
          <h2>Columns</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            {cols.length} columns. The first 37 match the Elephant query-table
            contract; the rest are the Duval derivations.
          </p>
          <div
            className="table-scroll card"
            style={{ marginTop: 12, padding: 0 }}
          >
            <table data-testid="schema-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c) => (
                  <tr key={c.name}>
                    <td className="mono">{c.name}</td>
                    <td className="subtle">{c.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
