import Link from "next/link";
import { notFound } from "next/navigation";
import { Unavailable, cell, money, num } from "@/components/ui";
import { runQuery } from "@/lib/oracle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FIELDS: Array<[string, string, "text" | "money" | "num"]> = [
  ["parcel_identifier", "Parcel / RE#", "text"],
  ["address_street", "Situs address", "text"],
  ["address_city", "City", "text"],
  ["address_zip", "ZIP", "text"],
  ["property_type", "Property type", "text"],
  ["property_usage_type", "Use", "text"],
  ["built_year", "Year built", "text"],
  ["livable_floor_area", "Living area (sqft)", "num"],
  ["lot_area_sqft", "Lot area (sqft)", "num"],
  ["market_value", "Just value", "money"],
  ["assessed_value", "Assessed value", "money"],
  ["land_value", "Land value", "money"],
  ["owner_name", "Owner", "text"],
  ["owner_occupied", "Owner occupied", "text"],
  ["owner_mailing_city", "Owner mailing city", "text"],
  ["owner_mailing_state", "Owner mailing state", "text"],
  ["owner_region_class", "Owner locality", "text"],
  ["owner_portfolio_size", "Parcels held by owner", "num"],
  ["last_sale_date", "Last recorded sale", "text"],
  ["last_sale_price", "Last sale price", "money"],
  ["subdivision", "Neighbourhood code", "text"],
  ["latitude", "Latitude", "text"],
  ["longitude", "Longitude", "text"],
];

const SIGNALS: Array<[string, string, string]> = [
  ["roof_age_years", "Roof age (years)", "roof_age_basis"],
  ["water_view_class", "Water", "water_view_basis"],
  ["tenure_class", "Ownership tenure", "tenure_basis"],
  ["dist_to_transit_m", "Metres to transit", "transit_basis"],
  ["dist_to_starbucks_m", "Metres to Starbucks", "starbucks_basis"],
];

export default async function PropertyPage({
  params,
}: {
  params: Promise<{ folio: string }>;
}) {
  const { folio } = await params;
  const decoded = decodeURIComponent(folio);

  let row: Record<string, unknown> | undefined;
  let error: string | undefined;
  let pointer;
  try {
    const result = await runQuery<Record<string, unknown>>(
      `SELECT * FROM properties WHERE request_identifier = '${decoded.replace(/'/g, "''")}'`,
      { limit: 1 },
    );
    row = result.rows[0];
    pointer = result.pointer;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  if (error) return <Unavailable error={error} />;
  if (!row) notFound();

  return (
    <>
      <p className="subtle">
        <Link href="/questions">← Questions</Link>
      </p>
      <h1>{cell(row["address_street"])}</h1>
      <p className="muted" style={{ marginTop: 6 }}>
        {cell(row["address_city"])} {cell(row["address_zip"])} · Parcel{" "}
        <span className="mono">{cell(row["request_identifier"])}</span>
      </p>

      <h2 style={{ marginTop: 28 }}>Derived signals</h2>
      <div className="grid grid-3" style={{ marginTop: 12 }}>
        {SIGNALS.map(([key, label, basisKey]) => (
          <div className="card" key={key}>
            <div className="stat-value" style={{ fontSize: "1.4rem" }}>
              {cell(
                row![key],
                key.startsWith("dist_") || key.includes("years"),
              )}
            </div>
            <div className="stat-label">{label}</div>
            <div className="subtle" style={{ marginTop: 6 }}>
              basis: {cell(row![basisKey])}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 32 }}>Record</h2>
      <div className="table-scroll card" style={{ marginTop: 12, padding: 0 }}>
        <table data-testid="property-record">
          <tbody>
            {FIELDS.map(([key, label, kind]) => (
              <tr key={key}>
                <td className="muted" style={{ width: 220 }}>
                  {label}
                </td>
                <td>
                  {kind === "money"
                    ? money(row![key])
                    : kind === "num"
                      ? num(row![key])
                      : cell(row![key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 32 }}>Provenance</h2>
      <div className="table-scroll card" style={{ marginTop: 12, padding: 0 }}>
        <table data-testid="property-provenance">
          <tbody>
            <tr>
              <td className="muted" style={{ width: 220 }}>
                Source system
              </td>
              <td className="mono">{cell(row["source_system"])}</td>
            </tr>
            <tr>
              <td className="muted">Source artifact</td>
              <td className="mono" style={{ wordBreak: "break-all" }}>
                {cell(row["source_artifact_uri"])}
              </td>
            </tr>
            <tr>
              <td className="muted">Record hash</td>
              <td className="mono" style={{ wordBreak: "break-all" }}>
                {cell(row["source_record_hash"])}
              </td>
            </tr>
            <tr>
              <td className="muted">First seen in run</td>
              <td className="mono">
                {row["first_seen_run_id"] ? (
                  <Link href={`/runs/${String(row["first_seen_run_id"])}`}>
                    {cell(row["first_seen_run_id"])}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td className="muted">Last changed in run</td>
              <td className="mono">
                {row["last_changed_run_id"] ? (
                  <Link href={`/runs/${String(row["last_changed_run_id"])}`}>
                    {cell(row["last_changed_run_id"])}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            {pointer ? (
              <tr>
                <td className="muted">Published dataset</td>
                <td className="mono" style={{ wordBreak: "break-all" }}>
                  <a href={pointer.cidUrl}>{pointer.cid}</a>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
