/**
 * Enrichment: roof age from re-roof permits.
 *
 * For each property that carries at least one linked JaxEPICS roofing permit, take the most
 * recent re-roof permit date and derive the roof age in years. Writes to `property_enrichment`:
 *   - roof_age_years     : numeric  (years since the most recent re-roof permit)
 *   - roof_permit_number : text     (that permit's number)
 *   - roof_permit_date   : date     (that permit's date)
 *   - roof_age_basis     : jsonb    (which permit, how many roofing permits, method)
 *
 * Coverage is PARTIAL BY DESIGN and documented honestly: only properties with a roofing permit
 * get a value; every other property has `roof_age_years = NULL` (no re-roof permit on record) —
 * that NULL is the correct, non-fabricated flag, not a failure. Most parcels have no permit.
 *
 * Run: DATABASE_URL=... npx tsx enrich/roof-age.ts
 */
import type { Client } from "pg";
import { ensureEnrichmentTable, round, upsertEnrichment, withDb } from "./lib.ts";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

interface RoofRow {
  propertyId: string;
  folio: string;
  latestDate: Date;
  permitNumber: string | null;
  roofingPermits: number;
}

async function main(): Promise<void> {
  await withDb(async (client: Client) => {
    await ensureEnrichmentTable(client);

    const totalProps = Number(
      (await client.query(`select count(*) n from properties`)).rows[0].n,
    );

    // For every property with a linked roofing permit: its most-recent re-roof date, the permit
    // number for that date, and how many roofing permits it carries. The re-roof date uses the
    // issue date, falling back to application-received / opened date when the issue date is null.
    const { rows } = await client.query(`
      with roofing as (
        select pi.property_id,
               pi.permit_number,
               coalesce(pi.permit_issue_date, pi.application_received_date, pi.opened_date) as roof_date
          from property_improvements pi
         where pi.source_system = 'duval_jaxepics'
           and pi.improvement_type ilike '%roof%'
           and pi.property_id is not null
      ),
      dated as (select * from roofing where roof_date is not null)
      select d.property_id,
             p.request_identifier as folio,
             max(d.roof_date) as latest_date,
             (array_agg(d.permit_number order by d.roof_date desc))[1] as permit_number,
             count(*) as roofing_permits
        from dated d
        join properties p on p.property_id = d.property_id
       group by d.property_id, p.request_identifier
    `);

    const roofRows: RoofRow[] = rows.map((r) => ({
      propertyId: r.property_id,
      folio: r.folio,
      latestDate: new Date(r.latest_date),
      permitNumber: r.permit_number,
      roofingPermits: Number(r.roofing_permits),
    }));

    const now = new Date();
    let futureDated = 0;
    for (const rr of roofRows) {
      // Clamp negative ages to 0 (a handful of permits are issued within days of "now").
      const ageRaw = (now.getTime() - rr.latestDate.getTime()) / MS_PER_YEAR;
      if (ageRaw < 0) futureDated++;
      const roofAge = round(Math.max(0, ageRaw));
      const dateStr = rr.latestDate.toISOString().slice(0, 10);
      const basis = {
        method: "years since the most recent linked re-roof permit (JaxEPICS)",
        latest_roof_permit: { permit_number: rr.permitNumber, date: dateStr },
        roofing_permits_on_property: rr.roofingPermits,
        computed_as_of: now.toISOString().slice(0, 10),
        source: "property_improvements (source_system=duval_jaxepics, improvement_type ~ roof)",
      };
      await upsertEnrichment(client, rr.propertyId, rr.folio, {
        roof_age_years: roofAge,
        roof_permit_number: rr.permitNumber,
        roof_permit_date: dateStr,
        roof_age_basis: JSON.stringify(basis),
      });
    }

    const pct = ((roofRows.length / totalProps) * 100).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(
      `roof-age: ${roofRows.length} / ${totalProps} properties got a roof age ` +
        `(${pct}% — partial by design; the rest have no re-roof permit → NULL). ` +
        `${futureDated} permits dated within the horizon (clamped to age 0).`,
    );
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
