/**
 * Backfill: materialize the owner MAILING locality into structured columns so regional-owner
 * banding can run over it — WITHOUT re-scraping the appraiser.
 *
 * The appraiser transform (transform/duval/handler.js) DOES extract the owner mailing address
 * (`lblMailingAddressLine1..3`) and emits it as a `<owner>_mailing_address` entity linked by
 * `person_has_mailing_address` / `company_has_mailing_address`. This script re-materializes that
 * mailing locality from whatever the current Neon load carries, into:
 *   - `addresses`                     (a mailing-typed address row, source_system 'duval_owner_mailing')
 *   - `ownerships.mailing_address_id` (the FK regional-owner.ts reads first)
 * so that `enrich/regional-owner.ts` bands each owned parcel with ZERO code change.
 *
 * It looks for a mailing locality, in priority order, in:
 *   1. an existing mailing-typed `addresses` row for the folio (already materialized), then
 *   2. mailing fields inside `people` / `companies` / `ownerships` `source_payload`
 *      (mailing_state / mailing_zip / mail_city / owner_state ... — the generic key set).
 * Only the ZIP + state (+ optional city/county) are needed for banding; no raw street line is
 * required, and none is stored in this code. Idempotent and re-runnable.
 *
 * IMPORTANT — current-load reality (verified 2026-07-16, honest, not fabricated): the mailing
 * locality is NOT present in the current Neon load. `people`/`companies`/`ownerships`
 * `source_payload` carry owner NAMES only; `addresses` holds exactly one SITUS row per folio
 * (all Duval, FL) with no mailing row; `ownerships.mailing_address_id` is NULL on all 457 rows;
 * `unnormalized_addresses` is empty. The mailing entity the transform emitted was collapsed at
 * load (addresses deduped to one situs row per folio). It survives only in the S3 transform
 * output (not reachable without AWS credentials) or the raw appraiser page (re-scrape, out of
 * scope). So this backfill materializes 0 rows against the current load and leaves regional_owner
 * a documented NULL rather than fabricating a locality from the property's own situs. Restoring
 * the mailing (re-materialize from the S3 transform output, or a mailing-aware re-load) makes this
 * script populate it on the next run with no code change.
 *
 * Run: DATABASE_URL=... npx tsx enrich/backfill-owner-mailing.ts
 */
import type { Client } from "pg";
import { isDirectRun, withDb } from "./lib.ts";

interface MailingLocality {
  state: string | null;
  zip: string | null;
  city: string | null;
  county: string | null;
  source: string;
}

/** Pull a mailing locality (state/zip/city/county) out of a source_payload, if present. */
export function mailingFromPayload(payload: unknown, source: string): MailingLocality | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === "string" && v.trim() !== "") return v.trim();
    }
    return null;
  };
  const state = pick("mailing_state", "mail_state", "owner_state", "state_code", "state");
  const zip = pick("mailing_zip", "mail_zip", "owner_zip", "postal_code", "zip", "mailing_postal_code");
  const city = pick("mailing_city", "mail_city", "owner_city", "city_name", "city");
  const county = pick("mailing_county", "mail_county", "county_name", "county");
  if (!state && !zip && !city && !county) return null;
  return { state, zip, city, county, source };
}

async function main(): Promise<void> {
  await withDb(async (client: Client) => {
    // Every ownership with its owner payloads + any already-materialized mailing-typed address.
    const { rows } = await client.query(`
      select o.ownership_id,
             o.property_id,
             o.mailing_address_id,
             p.request_identifier          as folio,
             pe.source_payload             as person_payload,
             co.source_payload             as company_payload,
             o.source_payload              as ownership_payload,
             ma.address_id                 as existing_mailing_id
        from ownerships o
        join properties p  on p.property_id = o.property_id
        left join people    pe on pe.person_id  = o.owner_person_id
        left join companies co on co.company_id = o.owner_company_id
        left join addresses ma on ma.request_identifier = p.request_identifier
                              and ma.source_system = 'duval_owner_mailing'
       order by o.property_id, o.ownership_id
    `);

    let materialized = 0;
    let alreadyLinked = 0;
    for (const r of rows) {
      if (r.mailing_address_id) {
        alreadyLinked++;
        continue;
      }
      const loc =
        mailingFromPayload(r.person_payload, "people.source_payload") ??
        mailingFromPayload(r.company_payload, "companies.source_payload") ??
        mailingFromPayload(r.ownership_payload, "ownerships.source_payload");
      if (!loc) continue;

      // Upsert a mailing-typed address row (locality only) and link it to the ownership.
      let addressId: string | undefined = r.existing_mailing_id ?? undefined;
      if (!addressId) {
        const ins = await client.query(
          `insert into addresses
             (request_identifier, city_name, county_name, state_code, postal_code,
              source_payload, source_system, source_record_key, loaded_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, 'duval_owner_mailing', $7, now(), now(), now())
           on conflict (source_system, source_record_key) do update set updated_at = now()
           returning address_id`,
          [
            r.folio,
            loc.city,
            loc.county,
            loc.state,
            loc.zip,
            JSON.stringify({ mailing_locality: loc, method: "owner mailing materialized from Neon payload" }),
            `duval_owner_mailing:${r.folio}:${r.ownership_id}`,
          ],
        );
        addressId = ins.rows[0]?.address_id;
      }
      if (!addressId) continue;
      await client.query(`update ownerships set mailing_address_id = $1, updated_at = now() where ownership_id = $2`, [
        addressId,
        r.ownership_id,
      ]);
      materialized++;
    }

    // eslint-disable-next-line no-console
    console.log(
      `backfill-owner-mailing: ${materialized} owner-mailing localities materialized ` +
        `(${alreadyLinked} already linked, ${rows.length} ownerships scanned).`,
    );
    if (materialized === 0 && alreadyLinked === 0) {
      // eslint-disable-next-line no-console
      console.log(
        "backfill-owner-mailing: 0 materialized — the current Neon load carries owner NAMES only " +
          "(no mailing locality in people/companies/ownerships payloads; addresses hold only the " +
          "Duval situs). This is the documented load-layer gap: the transform emits the owner " +
          "mailing address, but it was collapsed at load. regional_owner is left NULL (not " +
          "fabricated from the property situs). Restore the mailing (re-materialize the S3 " +
          "transform output or a mailing-aware re-load) and re-run to populate it.",
      );
    }
  });
}

if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
