/**
 * Enrichment: regional-owner banding (owner locality vs property location).
 *
 * Bands each property by where its owner's MAILING address sits relative to the property's
 * situs (Duval County, FL):
 *   - regional_owner in { 'in_county', 'in_state', 'out_of_state' }  (NULL when unknown)
 *   - owner_locality_basis : jsonb  (owner state + ZIP3, the source, method — inspectable)
 *
 * The band is derived generically from the owner mailing STATE + ZIP prefix — no real owner
 * street address is embedded in this code. Owner mailing is read from the designed source
 * (`ownerships.mailing_address_id` → `addresses`), with a `people`/`companies.source_payload`
 * mailing fallback, so re-running after a mailing backfill populates the fact with zero code
 * change.
 *
 * DATA GAP (honest): in the current Duval load the owner mailing address is NOT persisted —
 * `ownerships.mailing_address_id` is NULL on every row, the `addresses` table holds only the
 * Duval situs address, and the person/company payloads carry names only. The appraiser transform
 * emits `person_has_mailing_address` / `company_has_mailing_address`, but the load stage did not
 * materialize those mailing entities. Re-deriving owner mailing needs the geo-blocked appraiser
 * source (out of scope for this DB + public-API enrichment stage, VPN off). So this fact is
 * computed where the input exists and left NULL (flagged) where it does not, rather than fabricated.
 *
 * Run: DATABASE_URL=... npx tsx enrich/regional-owner.ts
 */
import type { Client } from "pg";
import { ensureEnrichmentTable, isDirectRun, upsertEnrichment, withDb } from "./lib.ts";

// The property county/state for this pipeline (all 373 parcels are Duval, FL situs).
const PROPERTY_COUNTY = "Duval";
const PROPERTY_STATE = "FL";
// Duval County is the consolidated City of Jacksonville, so its municipalities are a COMPLETE
// in-county signal — an owner-mailing city in this set is in Duval. This is the authoritative test.
const DUVAL_CITIES = new Set([
  "jacksonville",
  "jacksonville beach",
  "atlantic beach",
  "neptune beach",
  "baldwin",
]);
// Duval County ZIP codes (secondary in-county signal, used when the mailing city is missing).
// NOTE: a coarse 3-digit prefix is NOT usable here — the 320xx/321xx prefixes also cover the
// neighbouring counties (e.g. Nassau 32009 Bryceville, Clay 32073 Orange Park), which must band as
// in_state, not in_county. Only these specific 5-digit Duval ZIPs count as in-county.
const DUVAL_ZIP5 = new Set([
  "32099", "32202", "32204", "32205", "32206", "32207", "32208", "32209", "32210", "32211",
  "32212", "32216", "32217", "32218", "32219", "32220", "32221", "32222", "32223", "32224",
  "32225", "32226", "32227", "32228", "32233", "32234", "32244", "32246", "32250", "32254",
  "32256", "32257", "32258", "32266", "32277", "32201", "32203", "32229", "32231", "32232",
  "32235", "32236", "32237", "32238", "32239", "32240", "32241", "32245", "32247", "32255",
]);

/** A Florida ZIP (used only to infer FL when the mailing state code is absent). */
function isFloridaZip(zip5: string): boolean {
  if (zip5.length !== 5) return false;
  const n = Number(zip5);
  return n >= 32000 && n <= 34999;
}

interface OwnerLocality {
  state?: string | null;
  zip?: string | null;
  county?: string | null;
  city?: string | null;
  source: string;
}

/** Pull a mailing locality out of a person/company source_payload, if present (fallback path). */
function localityFromPayload(payload: unknown, source: string): OwnerLocality | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const state =
    (p.mailing_state ?? p.mail_state ?? p.owner_state ?? p.state_code ?? p.state) as
      | string
      | undefined;
  const zip =
    (p.mailing_zip ?? p.mail_zip ?? p.owner_zip ?? p.postal_code ?? p.zip) as string | undefined;
  const city = (p.mailing_city ?? p.mail_city ?? p.owner_city ?? p.city_name) as string | undefined;
  if (!state && !zip && !city) return null;
  return { state: state ?? null, zip: zip ?? null, city: city ?? null, source };
}

/** Band an owner locality against the Duval, FL property location. */
export function bandLocality(loc: OwnerLocality): string | null {
  const state = (loc.state ?? "").trim().toUpperCase();
  const zip5 = (loc.zip ?? "").replace(/\D/g, "").slice(0, 5);
  const county = (loc.county ?? "").trim().toLowerCase();
  const city = (loc.city ?? "").trim().toLowerCase();
  if (!state && !zip5 && !county && !city) return null;
  // Out of state: an explicit non-FL state, or (state absent) a clearly non-Florida ZIP.
  if (state && state !== PROPERTY_STATE) return "out_of_state";
  if (!state && zip5.length === 5 && !isFloridaZip(zip5)) return "out_of_state";
  // In county: Duval == consolidated Jacksonville, so the municipality (city) is authoritative;
  // county name or a specific Duval 5-digit ZIP also qualify.
  const inCounty =
    county === PROPERTY_COUNTY.toLowerCase() ||
    (city !== "" && DUVAL_CITIES.has(city)) ||
    (zip5 !== "" && DUVAL_ZIP5.has(zip5));
  if (inCounty) return "in_county";
  // Florida but not Duval.
  if (state === PROPERTY_STATE || (zip5.length === 5 && isFloridaZip(zip5))) return "in_state";
  return null;
}

async function main(): Promise<void> {
  await withDb(async (client: Client) => {
    await ensureEnrichmentTable(client);

    // One row per ownership, most-local owner wins per property. Ordered so the pick is deterministic.
    const { rows } = await client.query(`
      select o.property_id,
             p.request_identifier                 as folio,
             ma.state_code                         as mail_state,
             ma.postal_code                        as mail_zip,
             ma.county_name                        as mail_county,
             ma.city_name                          as mail_city,
             pe.source_payload                     as person_payload,
             co.source_payload                     as company_payload
        from ownerships o
        join properties p  on p.property_id = o.property_id
        left join addresses ma on ma.address_id = o.mailing_address_id
        left join people    pe on pe.person_id  = o.owner_person_id
        left join companies co on co.company_id = o.owner_company_id
       order by o.property_id, o.ownership_id
    `);

    const rank: Record<string, number> = { in_county: 3, in_state: 2, out_of_state: 1 };
    // property_id -> best (most local) band + basis
    const best = new Map<string, { folio: string; band: string; basis: OwnerLocality }>();

    for (const r of rows) {
      let loc: OwnerLocality | null = null;
      if (r.mail_state || r.mail_zip || r.mail_county || r.mail_city) {
        loc = {
          state: r.mail_state,
          zip: r.mail_zip,
          county: r.mail_county,
          city: r.mail_city,
          source: "ownerships.mailing_address_id → addresses",
        };
      } else {
        loc =
          localityFromPayload(r.person_payload, "people.source_payload") ??
          localityFromPayload(r.company_payload, "companies.source_payload");
      }
      if (!loc) continue;
      const band = bandLocality(loc);
      if (!band) continue;
      const prev = best.get(r.property_id);
      if (!prev || (rank[band] ?? 0) > (rank[prev.band] ?? 0)) {
        best.set(r.property_id, { folio: r.folio, band, basis: loc });
      }
    }

    const totalProps = Number((await client.query(`select count(*) n from properties`)).rows[0].n);
    const bandCounts: Record<string, number> = {};
    for (const [propertyId, v] of best) {
      bandCounts[v.band] = (bandCounts[v.band] ?? 0) + 1;
      const basis = {
        method: "owner mailing state + ZIP prefix vs property situs (Duval, FL)",
        owner_mailing_state: v.basis.state ?? null,
        owner_mailing_zip3: (v.basis.zip ?? "").replace(/\D/g, "").slice(0, 3) || null,
        source: v.basis.source,
      };
      await upsertEnrichment(client, propertyId, v.folio, {
        regional_owner: v.band,
        owner_locality_basis: JSON.stringify(basis),
      });
    }

    const n = best.size;
    // eslint-disable-next-line no-console
    console.log(
      `regional-owner: ${n} / ${totalProps} properties banded ${JSON.stringify(bandCounts)}.`,
    );
    if (n === 0) {
      // eslint-disable-next-line no-console
      console.log(
        "regional-owner: 0 populated — owner mailing address is not present in the current load " +
          "(ownerships.mailing_address_id all NULL; addresses hold only the Duval situs; owner " +
          "payloads carry names only). This is a documented load-layer gap: the appraiser transform " +
          "emits person/company mailing addresses, but the load stage did not materialize them. " +
          "Re-running after a mailing backfill will populate this fact with no code change.",
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
