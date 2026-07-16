/**
 * Canonical Neon queries for the six inquiry workflows, plus the records-by-source overview and
 * entity/relationship exploration. This is the single definition used by BOTH the deterministic
 * tRPC endpoints and the agent's SQL tool, so the UI and the agent can never disagree.
 *
 * Every workflow returns the public situs data + the derived fact + an inspectable basis + a
 * source-provenance citation. Owner names / mailing addresses are never selected (design §8).
 * Counts (coverage, matched) are always derived live from the DB — never hardcoded.
 */
import {
  getWorkflow,
  SOURCE_CATEGORIES,
  type Citation,
  type PropertyHit,
  type SourceCoverageRow,
  type WorkflowId,
  type WorkflowResult,
} from "@oracle-duval/shared";
import { query } from "./db.ts";

const APPRAISER_SOURCE = "duval_appraiser";
const DEFAULT_LIMIT = 50;

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function appraiserCitation(r: {
  folio: string;
  source_record_key: string | null;
  source_artifact_uri: string | null;
  source_record_hash: string | null;
  contributes: string;
}): Citation {
  return {
    source_system: APPRAISER_SOURCE,
    source_record_key: r.source_record_key,
    source_uri: r.source_artifact_uri,
    page_sha256: r.source_record_hash,
    folio: r.folio,
    contributes: r.contributes,
  };
}

async function scalar(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await query<{ n: string | number }>(sql, params);
  return rows.length ? Number(rows[0]!.n) : 0;
}

interface WorkflowRow {
  folio: string;
  situs: string | null;
  property_usage_type: string | null;
  source_record_key: string | null;
  source_artifact_uri: string | null;
  source_record_hash: string | null;
  [k: string]: unknown;
}

const TOTAL_PROPERTIES_SQL = `select count(*)::int n from properties`;

// ---------------------------------------------------------------------------
// 1. Roof age (> 15-year candidates)
// ---------------------------------------------------------------------------
async function roofAge(limit: number): Promise<WorkflowResult> {
  const spec = getWorkflow("roof_age");
  const rows = await query<WorkflowRow>(
    `select e.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
            e.roof_age_years, e.roof_permit_number, e.roof_permit_date, e.roof_age_basis,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from property_enrichment e
       join properties p on p.property_id = e.property_id
       left join addresses a on a.address_id = p.address_id
      where e.roof_age_years > 15
      order by e.roof_age_years desc
      limit $1`,
    [limit],
  );
  const matched = await scalar(`select count(*)::int n from property_enrichment where roof_age_years > 15`);
  const populated = await scalar(`select count(*)::int n from property_enrichment where roof_age_years is not null`);
  const eligible = await scalar(
    `select count(distinct property_id)::int n from property_improvements
      where property_id is not null and lower(coalesce(improvement_type,'')) like '%roof%'`,
  );
  const total = await scalar(TOTAL_PROPERTIES_SQL);

  const hits: PropertyHit[] = rows.map((r) => ({
    folio: r.folio,
    situs_address: r.situs,
    property_usage_type: r.property_usage_type,
    is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
    facts: {
      roof_age_years: num(r.roof_age_years),
      roof_permit_number: (r.roof_permit_number as string) ?? null,
      roof_permit_date: r.roof_permit_date ? String(r.roof_permit_date).slice(0, 10) : null,
    },
    basis: r.roof_age_basis,
    citations: [
      appraiserCitation({ ...r, contributes: "Property record (use, situs address)" }),
      {
        source_system: "duval_jaxepics",
        source_record_key: (r.roof_permit_number as string) ?? null,
        source_uri: null,
        page_sha256: null,
        folio: r.folio,
        contributes: `Re-roof permit ${r.roof_permit_number ?? ""} (${r.roof_permit_date ? String(r.roof_permit_date).slice(0, 10) : "date n/a"}) — roof-age basis`,
      },
    ],
  }));
  return { workflow: spec.id, question: spec.question, basis: spec.basis, coverage: { populated, eligible, total }, matched, rows: hits };
}

// ---------------------------------------------------------------------------
// 2. Water view / waterfront
// ---------------------------------------------------------------------------
async function waterView(limit: number): Promise<WorkflowResult> {
  const spec = getWorkflow("water_view");
  const rows = await query<WorkflowRow>(
    `select e.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
            e.water_view, e.nearest_water_name, e.nearest_water_distance_m, e.water_basis,
            g.source_record_key as geo_key, g.source_artifact_uri as geo_uri,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from property_enrichment e
       join properties p on p.property_id = e.property_id
       left join addresses a on a.address_id = p.address_id
       left join geometries g on g.property_id = e.property_id
      where e.water_view = true
      order by e.nearest_water_distance_m asc nulls last
      limit $1`,
    [limit],
  );
  const matched = await scalar(`select count(*)::int n from property_enrichment where water_view = true`);
  const populated = await scalar(`select count(*)::int n from property_enrichment where water_view is not null`);
  const eligible = await scalar(`select count(*)::int n from geometries where latitude is not null and property_id is not null`);
  const total = await scalar(TOTAL_PROPERTIES_SQL);

  const hits: PropertyHit[] = rows.map((r) => ({
    folio: r.folio,
    situs_address: r.situs,
    property_usage_type: r.property_usage_type,
    is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
    facts: {
      water_view: r.water_view as boolean,
      nearest_water_name: (r.nearest_water_name as string) ?? null,
      nearest_water_distance_m: num(r.nearest_water_distance_m),
    },
    basis: r.water_basis,
    citations: [
      appraiserCitation({ ...r, contributes: "Property record (use, situs address)" }),
      {
        source_system: "duval_geo_census",
        source_record_key: (r.geo_key as string) ?? r.folio,
        source_uri: (r.geo_uri as string) ?? null,
        page_sha256: null,
        folio: r.folio,
        contributes: "Parcel coordinate (US Census geocode) — water-proximity basis",
      },
    ],
  }));
  return { workflow: spec.id, question: spec.question, basis: spec.basis, coverage: { populated, eligible, total }, matched, rows: hits };
}

// ---------------------------------------------------------------------------
// 3. Ownership age (no recorded exchange in 10 years)
// ---------------------------------------------------------------------------
async function ownershipAge(limit: number): Promise<WorkflowResult> {
  const spec = getWorkflow("ownership_age");
  // Latest credible recorded transfer per property (guard the pre-1950 sentinel dates), older
  // than 10 years => no recorded exchange in a decade. One deed citation per property.
  const rows = await query<WorkflowRow>(
    `with latest as (
        select property_id, max(ownership_transfer_date) as last_sale
          from sales_histories
         where ownership_transfer_date is not null and ownership_transfer_date >= date '1950-01-01'
         group by property_id)
      select l.last_sale, l.property_id,
             extract(year from age(now(), l.last_sale))::int as years_held,
             p.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
             p.source_record_key, p.source_artifact_uri, p.source_record_hash,
             d.deed_type, d.book as deed_book, d.page as deed_page, d.instrument_number,
             d.source_record_key as deed_key, d.source_artifact_uri as deed_uri
        from latest l
        join properties p on p.property_id = l.property_id
        left join addresses a on a.address_id = p.address_id
        left join lateral (
          select deed_type, book, page, instrument_number, source_record_key, source_artifact_uri
            from deeds dd where dd.property_id = l.property_id
            order by dd.created_at desc limit 1) d on true
       where l.last_sale < now() - interval '10 years'
       order by l.last_sale asc
       limit $1`,
    [limit],
  );
  const matched = await scalar(
    `with latest as (select property_id, max(ownership_transfer_date) last_sale from sales_histories
       where ownership_transfer_date is not null and ownership_transfer_date >= date '1950-01-01' group by property_id)
     select count(*)::int n from latest where last_sale < now() - interval '10 years'`,
  );
  const populated = await scalar(`select count(distinct property_id)::int n from sales_histories where ownership_transfer_date is not null`);
  const total = await scalar(TOTAL_PROPERTIES_SQL);

  const hits: PropertyHit[] = rows.map((r) => ({
    folio: r.folio,
    situs_address: r.situs,
    property_usage_type: r.property_usage_type,
    is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
    facts: {
      last_recorded_transfer: r.last_sale ? String(r.last_sale).slice(0, 10) : null,
      years_since_transfer: num(r.years_held),
      deed_type: (r.deed_type as string) ?? null,
    },
    basis: {
      method: "most recent recorded ownership transfer (sales_histories) older than 10 years",
      last_recorded_transfer: r.last_sale ? String(r.last_sale).slice(0, 10) : null,
      deed: { book: r.deed_book ?? null, page: r.deed_page ?? null, instrument_number: r.instrument_number ?? null },
      note: "Clerk/appraiser sale-history record; pre-1950 sentinel dates excluded.",
    },
    citations: [
      appraiserCitation({ ...r, contributes: "Property record (use, situs address)" }),
      {
        source_system: "duval_clerk_deeds",
        source_record_key: (r.deed_key as string) ?? (r.instrument_number as string) ?? null,
        source_uri: (r.deed_uri as string) ?? null,
        page_sha256: null,
        folio: r.folio,
        contributes: `Deed / sale history (book ${r.deed_book ?? "n/a"}, page ${r.deed_page ?? "n/a"}, instrument ${r.instrument_number ?? "n/a"})`,
      },
    ],
  }));
  return { workflow: spec.id, question: spec.question, basis: spec.basis, coverage: { populated, eligible: total, total }, matched, rows: hits };
}

// ---------------------------------------------------------------------------
// 4. Regional / out-of-area owners (honest-null: backfill pending, Task 13)
// ---------------------------------------------------------------------------
async function regionalOwner(limit: number): Promise<WorkflowResult> {
  const spec = getWorkflow("regional_owner");
  // Regional / out-of-area = owner mailing outside Duval County (in_state = other FL county, or
  // out_of_state). in_county owners are local and excluded from the matches.
  const rows = await query<WorkflowRow>(
    `select e.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
            e.regional_owner, e.owner_locality_basis,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from property_enrichment e
       join properties p on p.property_id = e.property_id
       left join addresses a on a.address_id = p.address_id
      where e.regional_owner in ('in_state', 'out_of_state')
      order by case e.regional_owner when 'out_of_state' then 0 else 1 end, e.request_identifier
      limit $1`,
    [limit],
  );
  const matched = await scalar(
    `select count(*)::int n from property_enrichment where regional_owner in ('in_state', 'out_of_state')`,
  );
  const populated = await scalar(`select count(*)::int n from property_enrichment where regional_owner is not null`);
  const eligible = await scalar(`select count(*)::int n from ownerships where mailing_address_id is not null`);
  const total = await scalar(TOTAL_PROPERTIES_SQL);

  const hits: PropertyHit[] = rows.map((r) => ({
    folio: r.folio,
    situs_address: r.situs,
    property_usage_type: r.property_usage_type,
    is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
    facts: {
      owner_locality: (r.regional_owner as string) ?? null,
      out_of_area: r.regional_owner === "in_state" || r.regional_owner === "out_of_state",
    },
    basis: r.owner_locality_basis,
    citations: [appraiserCitation({ ...r, contributes: "Property record (use, situs address)" })],
  }));
  return {
    workflow: spec.id,
    question: spec.question,
    basis: spec.basis,
    coverage: { populated, eligible, total },
    matched,
    rows: hits,
  };
}

// ---------------------------------------------------------------------------
// 5. Walking distance (with the distance calculation basis)
// ---------------------------------------------------------------------------
async function walkingDistance(limit: number): Promise<WorkflowResult> {
  const spec = getWorkflow("walking_distance");
  const rows = await query<WorkflowRow>(
    `select e.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
            e.near_transit, e.nearest_transit_stop_name, e.nearest_transit_distance_m,
            e.near_starbucks, e.nearest_starbucks_name, e.nearest_starbucks_distance_m,
            e.dist_band, e.distance_basis,
            g.source_record_key as geo_key, g.source_artifact_uri as geo_uri,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from property_enrichment e
       join properties p on p.property_id = e.property_id
       left join addresses a on a.address_id = p.address_id
       left join geometries g on g.property_id = e.property_id
      where e.near_transit = true or e.near_starbucks = true
      order by e.nearest_transit_distance_m asc nulls last
      limit $1`,
    [limit],
  );
  const matched = await scalar(`select count(*)::int n from property_enrichment where near_transit = true or near_starbucks = true`);
  const populated = await scalar(`select count(*)::int n from property_enrichment where near_transit is not null`);
  const eligible = await scalar(`select count(*)::int n from geometries where latitude is not null and property_id is not null`);
  const total = await scalar(TOTAL_PROPERTIES_SQL);

  const hits: PropertyHit[] = rows.map((r) => ({
    folio: r.folio,
    situs_address: r.situs,
    property_usage_type: r.property_usage_type,
    is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
    facts: {
      near_transit: r.near_transit as boolean,
      nearest_transit_stop: (r.nearest_transit_stop_name as string) ?? null,
      nearest_transit_distance_m: num(r.nearest_transit_distance_m),
      near_starbucks: r.near_starbucks as boolean,
      nearest_starbucks_distance_m: num(r.nearest_starbucks_distance_m),
      dist_band: (r.dist_band as string) ?? null,
    },
    basis: r.distance_basis,
    citations: [
      appraiserCitation({ ...r, contributes: "Property record (use, situs address)" }),
      {
        source_system: "duval_geo_census",
        source_record_key: (r.geo_key as string) ?? r.folio,
        source_uri: (r.geo_uri as string) ?? null,
        page_sha256: null,
        folio: r.folio,
        contributes: "Parcel coordinate (US Census geocode) — walking-distance basis (JTA GTFS + OSM)",
      },
    ],
  }));
  return { workflow: spec.id, question: spec.question, basis: spec.basis, coverage: { populated, eligible, total }, matched, rows: hits };
}

export async function runWorkflow(id: WorkflowId, limit = DEFAULT_LIMIT): Promise<WorkflowResult> {
  const capped = Math.max(1, Math.min(limit, 200));
  switch (id) {
    case "roof_age": return roofAge(capped);
    case "water_view": return waterView(capped);
    case "ownership_age": return ownershipAge(capped);
    case "regional_owner": return regionalOwner(capped);
    case "walking_distance": return walkingDistance(capped);
    case "records_by_source": {
      const rows = await recordsBySource();
      const spec = getWorkflow("records_by_source");
      const total = rows.reduce((a, r) => a + r.ingested, 0);
      return {
        workflow: spec.id,
        question: spec.question,
        basis: spec.basis,
        coverage: { populated: rows.length, eligible: SOURCE_CATEGORIES.length, total },
        matched: total,
        rows: [],
      };
    }
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown workflow ${_exhaustive as string}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Compound queries — real intersection of 2+ criteria (e.g. "near transit AND
// regional owners"). Answers multi-criterion questions with an exact SQL AND, so the
// agent never punts on a compound demo prompt.
// ---------------------------------------------------------------------------
export interface CompoundResult {
  criteria: string[];
  matched: number;
  rows: PropertyHit[];
}

const LONG_HELD_EXISTS = `exists (select 1 from sales_histories sh
    where sh.property_id = e.property_id and sh.ownership_transfer_date >= date '1950-01-01'
    group by sh.property_id having max(sh.ownership_transfer_date) < now() - interval '10 years')`;

/** Detect 2+ criteria in the question and return the parcels satisfying ALL of them; else null. */
export async function compoundQuery(question: string, limit = 25): Promise<CompoundResult | null> {
  const q = question.toLowerCase();
  const preds: string[] = [];
  const labels: string[] = [];
  const add = (re: RegExp, pred: string, label: string) => {
    if (re.test(q)) { preds.push(pred); labels.push(label); }
  };
  add(/\b(transit|bus|walk|walking|stop)\b/, "e.near_transit = true", "near transit");
  add(/\bstarbucks\b/, "e.near_starbucks = true", "near a Starbucks");
  add(/water|waterfront|river|lake|canal/, "e.water_view = true", "water view");
  add(/\broof/, "e.roof_age_years > 15", "roof older than 15 years");
  add(/regional|out of area|out-of-area|out of state|out-of-state|absentee/, "e.regional_owner in ('in_state','out_of_state')", "regional / out-of-area owner");
  add(/no recorded exchange|no exchange|not sold|long-held|long held|held for|10 year/, LONG_HELD_EXISTS, "no recorded exchange in 10 years");
  if (preds.length < 2) return null;

  const where = preds.join(" and ");
  const rows = await query<WorkflowRow>(
    `select e.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
            e.near_transit, e.nearest_transit_distance_m, e.water_view, e.roof_age_years, e.regional_owner,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from property_enrichment e
       join properties p on p.property_id = e.property_id
       left join addresses a on a.address_id = p.address_id
      where ${where}
      order by e.request_identifier limit $1`,
    [limit],
  );
  const matched = await scalar(`select count(*)::int n from property_enrichment e where ${where}`);
  const hits: PropertyHit[] = rows.map((r) => ({
    folio: r.folio,
    situs_address: r.situs,
    property_usage_type: r.property_usage_type,
    is_commercial: r.property_usage_type != null && r.property_usage_type !== "Residential",
    facts: {
      near_transit: (r.near_transit as boolean) ?? null,
      nearest_transit_distance_m: num(r.nearest_transit_distance_m),
      water_view: (r.water_view as boolean) ?? null,
      roof_age_years: num(r.roof_age_years),
      owner_locality: (r.regional_owner as string) ?? null,
    },
    citations: [appraiserCitation({ ...r, contributes: `Compound match: ${labels.join(" AND ")}` })],
  }));
  return { criteria: labels, matched, rows: hits };
}

// ---------------------------------------------------------------------------
// 6. Records by source — all six categories with provenance + coverage snapshot
// ---------------------------------------------------------------------------
export async function recordsBySource(): Promise<SourceCoverageRow[]> {
  // Live per-category counts from the reconciled entities.
  const liveCounts: Record<string, string> = {
    appraisal: `select count(*)::int n, min(loaded_at) f, max(loaded_at) l from properties`,
    permits: `select count(*)::int n, min(loaded_at) f, max(loaded_at) l from property_improvements where source_system = 'duval_jaxepics'`,
    coordinates: `select count(*)::int n, min(loaded_at) f, max(loaded_at) l from geometries`,
    ownership: `select count(*)::int n, min(loaded_at) f, max(loaded_at) l from ownerships`,
    business: `select count(*)::int n, min(loaded_at) f, max(loaded_at) l from business_registrations`,
    contractor: `select count(*)::int n, min(loaded_at) f, max(loaded_at) l from business_reputation_profiles`,
  };
  // The published coverage snapshot maps its own source names onto our categories.
  const coverage = await query<{ source: string; ingested_count: string; expected_count: string | null; first_loaded_at: string | null; last_loaded_at: string | null; cid: string | null }>(
    `select source, ingested_count, expected_count, first_loaded_at, last_loaded_at, cid
       from oracle_dataset_coverage where county = 'duval'`,
  );
  const covBy = new Map(coverage.map((c) => [c.source, c]));
  const covMap: Record<string, string> = { appraisal: "appraisal", permits: "permits", coordinates: "appraisal", ownership: "appraisal", business: "sunbiz", contractor: "bbb" };

  const out: SourceCoverageRow[] = [];
  for (const cat of SOURCE_CATEGORIES) {
    const live = await query<{ n: number; f: string | null; l: string | null }>(liveCounts[cat.id]!);
    const cov = covBy.get(covMap[cat.id] ?? cat.id);
    out.push({
      category: cat.id,
      label: cat.label,
      source: cat.source,
      description: cat.description,
      ingested: live.length ? Number(live[0]!.n) : 0,
      expected: cov?.expected_count != null ? Number(cov.expected_count) : null,
      firstLoadedAt: live[0]?.f ? String(live[0]!.f) : null,
      lastLoadedAt: live[0]?.l ? String(live[0]!.l) : null,
      cid: cat.id === "appraisal" ? cov?.cid ?? null : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pipeline-run summary + entity/relationship exploration (UI support)
// ---------------------------------------------------------------------------
export interface PipelineSummary {
  county: string;
  totalProperties: number;
  commercial: number;
  residential: number;
  withCoordinate: number;
  withPermit: number;
  enrichmentComputed: number;
  entities: { properties: number; owners_people: number; owners_companies: number; permits: number; deeds: number; contractors: number; coordinates: number };
  facts: { roof_age: number; water_view: number; near_transit: number; regional_owner: number };
}

export async function pipelineSummary(): Promise<PipelineSummary> {
  const one = async (sql: string) => scalar(sql);
  return {
    county: "duval",
    totalProperties: await one(TOTAL_PROPERTIES_SQL),
    commercial: await one(`select count(*)::int n from properties where property_usage_type is not null and property_usage_type <> 'Residential'`),
    residential: await one(`select count(*)::int n from properties where property_usage_type = 'Residential'`),
    withCoordinate: await one(`select count(distinct property_id)::int n from geometries where property_id is not null`),
    withPermit: await one(`select count(distinct property_id)::int n from property_improvements where property_id is not null`),
    enrichmentComputed: await one(`select count(*)::int n from property_enrichment`),
    entities: {
      properties: await one(TOTAL_PROPERTIES_SQL),
      owners_people: await one(`select count(*)::int n from people`),
      owners_companies: await one(`select count(*)::int n from companies`),
      // True JaxEPICS permit count (matches the MCP coverage snapshot); the broader
      // property_improvements table also holds appraiser building-improvement rows.
      permits: await one(`select count(*)::int n from property_improvements where source_system = 'duval_jaxepics'`),
      deeds: await one(`select count(*)::int n from deeds`),
      contractors: await one(`select count(*)::int n from business_reputation_profiles`),
      coordinates: await one(`select count(*)::int n from geometries`),
    },
    facts: {
      roof_age: await one(`select count(*)::int n from property_enrichment where roof_age_years is not null`),
      water_view: await one(`select count(*)::int n from property_enrichment where water_view = true`),
      near_transit: await one(`select count(*)::int n from property_enrichment where near_transit = true`),
      // Owner-locality banded parcels (in_county / in_state / out_of_state) — real, backfilled.
      regional_owner: await one(`select count(*)::int n from property_enrichment where regional_owner is not null`),
    },
  };
}

export interface ExploredProperty extends PropertyHit {
  built_year: number | null;
  owners: { type: "person" | "company"; count: number };
  permit_count: number;
  contractor_names: string[];
  coordinate: { lat: number; lon: number } | null;
}

/** Explore one parcel: its reconciled entities + relationships (no owner PII). */
export async function exploreProperty(folio: string): Promise<ExploredProperty | null> {
  const props = await query<WorkflowRow & { built_year: number | null }>(
    `select p.property_id, p.request_identifier as folio, a.unnormalized_address as situs, p.property_usage_type,
            p.property_structure_built_year as built_year,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from properties p left join addresses a on a.address_id = p.address_id
      where p.request_identifier = $1 limit 1`,
    [folio],
  );
  if (!props.length) return null;
  const p = props[0]!;
  const pid = (p as unknown as { property_id: string }).property_id;

  const owners = await query<{ person_count: number; company_count: number }>(
    `select count(*) filter (where owner_person_id is not null)::int person_count,
            count(*) filter (where owner_company_id is not null)::int company_count
       from ownerships where property_id = $1`,
    [pid],
  );
  const permits = await scalar(`select count(*)::int n from property_improvements where property_id = $1`, [pid]);
  const contractors = await query<{ name: string }>(
    `select distinct pi_name.name from (
        select coalesce(c.name, brp.name) as name
          from property_improvements pi
          left join companies c on c.company_id = pi.contractor_company_id
          left join business_reputation_profiles brp on brp.company_id = pi.contractor_company_id
         where pi.property_id = $1 and coalesce(c.name, brp.name) is not null
      ) pi_name limit 10`,
    [pid],
  );
  const geo = await query<{ latitude: string; longitude: string }>(
    `select latitude, longitude from geometries where property_id = $1 and latitude is not null limit 1`,
    [pid],
  );
  const enr = await query<Record<string, unknown>>(
    `select roof_age_years, water_view, nearest_water_distance_m, near_transit, nearest_transit_distance_m, dist_band, regional_owner
       from property_enrichment where property_id = $1 limit 1`,
    [pid],
  );
  const e = enr[0] ?? {};

  return {
    folio: p.folio,
    situs_address: p.situs,
    property_usage_type: p.property_usage_type,
    is_commercial: p.property_usage_type != null && p.property_usage_type !== "Residential",
    built_year: p.built_year,
    facts: {
      roof_age_years: num(e.roof_age_years),
      water_view: (e.water_view as boolean) ?? null,
      near_transit: (e.near_transit as boolean) ?? null,
      dist_band: (e.dist_band as string) ?? null,
      regional_owner: (e.regional_owner as string) ?? null,
    },
    owners: {
      type: (owners[0]?.company_count ?? 0) > 0 ? "company" : "person",
      count: (owners[0]?.person_count ?? 0) + (owners[0]?.company_count ?? 0),
    },
    permit_count: permits,
    contractor_names: contractors.map((c) => c.name),
    coordinate: geo.length ? { lat: Number(geo[0]!.latitude), lon: Number(geo[0]!.longitude) } : null,
    citations: [appraiserCitation({ ...p, contributes: "Property record + reconciled owner/permit/coordinate relationships" })],
  };
}

/** Top contractors by BBB quality score (the contractor category detail). */
export async function contractors(limit = 20): Promise<
  { name: string; bbb_rating: string | null; is_accredited: boolean | null; score: number | null; score_band: string | null; complaint_count: number | null; profile_url: string | null }[]
> {
  return query(
    `select brp.name, brp.bbb_rating, brp.is_accredited, brp.complaint_count, brp.profile_url,
            s.score, s.score_band
       from business_reputation_profiles brp
       left join contractor_quality_scores s on s.business_reputation_profile_id = brp.business_reputation_profile_id
      order by s.score desc nulls last
      limit $1`,
    [limit],
  );
}
