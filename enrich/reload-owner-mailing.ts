/**
 * Re-load owner MAILING localities from the county transform output into Neon.
 *
 * This is a RE-LOAD, not a re-scrape. The appraiser transform already extracted each owner's
 * mailing address (`transform/duval/handler.js`, `lblMailingAddressLine…`) and emitted it as a
 * `person_N_mailing_address` / `company_N_mailing_address` entity in every parcel's
 * `transformed_output.zip`. The query-DB load collapsed addresses to one SITUS row per folio, so
 * the mailing never landed in Neon. This script reads those already-produced transform outputs and
 * materializes the owner mailing locality into:
 *   - `addresses`                     (a mailing-typed row, source_system 'duval_owner_mailing')
 *   - `ownerships.mailing_address_id` (the FK regional-owner.ts reads first)
 * so `enrich/regional-owner.ts` bands each owned parcel (in_county / in_state / out_of_state) with
 * no further change.
 *
 * Owner ↔ mailing mapping is EXACT (no name matching): the Neon owner's `source_record_key` is
 * `duval_appraiser:<folio>:<person|company>:<stem>` and the mailing file is `<stem>_mailing_address.json`.
 *
 * Prerequisite (run once by the operator; keeps bucket/account details out of the repo): use
 * `aws s3 sync` to pull the per-parcel `transformed_output.zip` files from the oracle-node
 * environment bucket's outputs prefix into a local `TRANSFORM_OUTPUT_DIR`.
 * Then: TRANSFORM_OUTPUT_DIR=... DATABASE_URL=... npx tsx enrich/reload-owner-mailing.ts [--dry-run]
 *
 * Server-only DB access via DATABASE_URL (never logged). Idempotent (upsert on the mailing
 * source-record key). The full mailing line is stored only in the hosted Neon layer (owner PII by
 * design); the published enrichment fact keeps only state + ZIP3 (see regional-owner.ts).
 */
import type { Client } from "pg";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun, withDb } from "./lib.ts";
import { bandLocality } from "./regional-owner.ts";

interface Mailing {
  folio: string;
  kind: "person" | "company";
  stem: string; // e.g. "person_1"
  ownerKey: string; // duval_appraiser:<folio>:<kind>:<stem>
  city: string | null;
  state: string | null;
  zip: string | null;
  unnormalized: string;
}

/** Parse "STREET, CITY, ST ZIP" into a mailing locality (state/ZIP/city). */
export function parseMailingLocality(addr: string): { city: string | null; state: string | null; zip: string | null } {
  const parts = addr.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length < 2) return { city: null, state: null, zip: null };
  const last = parts[parts.length - 1]!;
  const m = last.match(/^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/i);
  const state = m ? m[1]!.toUpperCase() : null;
  const zip = m ? m[2]! : null;
  const city = parts.length >= 3 ? parts[parts.length - 2]! : null;
  return { city, state, zip };
}

/** Recursively find every transformed_output.zip under a directory. */
function findTransformZips(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name === "transformed_output.zip") out.push(p);
    }
  };
  walk(dir);
  return out;
}

const MAILING_RE = /(?:^|\/)(?:data\/)?(person|company)_(\d+)_mailing_address\.json$/;

/** Read all owner mailings from one transform zip (stdin ignored so a bad archive can't hang). */
function mailingsFromZip(zip: string, folio: string): Mailing[] {
  let listing: string;
  try {
    listing = execFileSync("unzip", ["-Z1", zip], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const out: Mailing[] = [];
  for (const entry of listing.split(/\r?\n/)) {
    const m = entry.match(MAILING_RE);
    if (!m) continue;
    const kind = m[1] as "person" | "company";
    const stem = `${kind}_${m[2]}`;
    let content: string;
    try {
      content = execFileSync("unzip", ["-p", zip, entry], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch {
      continue;
    }
    let unnormalized: string | undefined;
    try {
      unnormalized = (JSON.parse(content) as { unnormalized_address?: string }).unnormalized_address;
    } catch {
      continue;
    }
    if (!unnormalized) continue;
    const loc = parseMailingLocality(unnormalized);
    out.push({
      folio,
      kind,
      stem,
      ownerKey: `duval_appraiser:${folio}:${kind}:${stem}`,
      city: loc.city,
      state: loc.state,
      zip: loc.zip,
      unnormalized,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const dir = process.env.TRANSFORM_OUTPUT_DIR;
  if (!dir) throw new Error("TRANSFORM_OUTPUT_DIR is not set (local dir of synced transformed_output.zip files).");
  const dryRun = process.argv.includes("--dry-run");

  const zips = findTransformZips(dir);
  // eslint-disable-next-line no-console
  console.log(`reload-owner-mailing: ${zips.length} transform outputs under ${dir}`);

  const mailings: Mailing[] = [];
  for (const zip of zips) {
    const folioMatch = zip.match(/folio-(\d+)/);
    if (!folioMatch) continue;
    mailings.push(...mailingsFromZip(zip, folioMatch[1]!));
  }

  const bands: Record<string, number> = {};
  for (const m of mailings) {
    const band = bandLocality({ state: m.state, zip: m.zip, city: m.city, source: "s3-transform" }) ?? "unknown";
    bands[band] = (bands[band] ?? 0) + 1;
  }
  // eslint-disable-next-line no-console
  console.log(
    `reload-owner-mailing: ${mailings.length} owner mailings parsed ` +
      `(person=${mailings.filter((m) => m.kind === "person").length}, ` +
      `company=${mailings.filter((m) => m.kind === "company").length}) | bands ${JSON.stringify(bands)}`,
  );

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log("reload-owner-mailing: --dry-run, no writes.");
    return;
  }

  await withDb(async (client: Client) => {
    let addrUpserts = 0;
    let ownershipUpdates = 0;
    let ownerNotFound = 0;
    for (const m of mailings) {
      const ins = await client.query(
        `insert into addresses
           (request_identifier, city_name, state_code, postal_code, unnormalized_address,
            source_payload, source_system, source_record_key, loaded_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, 'duval_owner_mailing', $7, now(), now(), now())
         on conflict (source_system, source_record_key) do update
           set city_name = excluded.city_name, state_code = excluded.state_code,
               postal_code = excluded.postal_code, unnormalized_address = excluded.unnormalized_address,
               updated_at = now()
         returning address_id`,
        [
          m.folio,
          m.city,
          m.state,
          m.zip,
          m.unnormalized,
          JSON.stringify({ owner_mailing: true, request_identifier: m.folio, stem: m.stem }),
          `duval_owner_mailing:${m.folio}:${m.kind}:${m.stem}`,
        ],
      );
      addrUpserts++;
      const addressId = ins.rows[0]!.address_id as string;
      const table = m.kind === "person" ? "people" : "companies";
      const fk = m.kind === "person" ? "owner_person_id" : "owner_company_id";
      const idCol = m.kind === "person" ? "person_id" : "company_id";
      const upd = await client.query(
        `update ownerships o set mailing_address_id = $1, updated_at = now()
           from ${table} t
          where o.${fk} = t.${idCol} and t.source_record_key = $2`,
        [addressId, m.ownerKey],
      );
      if (upd.rowCount && upd.rowCount > 0) ownershipUpdates += upd.rowCount;
      else ownerNotFound++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `reload-owner-mailing: ${addrUpserts} mailing addresses upserted, ` +
        `${ownershipUpdates} ownerships linked, ${ownerNotFound} mailings had no matching owner in Neon.`,
    );
  });
}

if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
}
