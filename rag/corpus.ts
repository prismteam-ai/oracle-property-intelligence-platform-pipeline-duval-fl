/**
 * Corpus builder — reads the real, reconciled Duval records from Neon and assembles one citable
 * document per property (the folio spine). Denormalizes appraisal + JaxEPICS permits + Census
 * geocode + the derived enrichment facts, and attaches a source-provenance citation for each
 * contributing record so every retrieved parcel can be cited by source_system + record_key + folio.
 *
 * Owner identity is deliberately excluded: `text_for_embedding` and citations never carry owner
 * names or mailing addresses (design §8 PII boundary). `owner_type` (person / company / mixed) is a
 * structural, non-identifying fact kept for filtering. The situs (property) address is public.
 *
 * Server-only: reads DATABASE_URL from the environment via the Task-8 enrichment lib helper.
 */
import { Client } from "pg";
import { withDb } from "../enrich/lib.ts";
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL_ID } from "./config.ts";
import { type Citation, type CorpusStore, type PropertyDoc, PropertyDocSchema } from "./types.ts";

const ROOF_RECENT_YEARS = 15;

interface PropertyRow {
  property_id: string;
  folio: string;
  property_type: string | null;
  property_usage_type: string | null;
  built_year: number | null;
  effective_built_year: number | null;
  situs_address: string | null;
  situs_zip: string | null;
  source_record_key: string | null;
  source_artifact_uri: string | null;
  source_record_hash: string | null;
}

interface PermitRow {
  property_id: string;
  improvement_type: string | null;
  permit_number: string | null;
  permit_date: string | null;
  source_record_key: string | null;
}

interface GeoRow {
  property_id: string;
  latitude: number;
  longitude: number;
  source_record_key: string | null;
  source_uri: string | null;
}

interface EnrichRow {
  property_id: string;
  near_transit: boolean | null;
  nearest_transit_stop_name: string | null;
  nearest_transit_distance_m: number | null;
  near_starbucks: boolean | null;
  dist_band: string | null;
  water_view: boolean | null;
  nearest_water_distance_m: number | null;
  roof_age_years: number | null;
}

interface OwnerTypeRow {
  property_id: string;
  person_count: number;
  company_count: number;
}

function ownerType(row: OwnerTypeRow | undefined): PropertyDoc["owner_type"] {
  if (!row) return null;
  const p = row.person_count > 0;
  const c = row.company_count > 0;
  if (p && c) return "mixed";
  if (c) return "company";
  if (p) return "person";
  return null;
}

/** A human-readable, spaced version of a CamelCase usage type (RetailStore -> "retail store"). */
function humanizeUsage(usage: string | null): string {
  if (!usage) return "property";
  return usage.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/** Assemble the natural-language summary embedded for semantic retrieval (no owner identity). */
function buildText(
  p: PropertyRow,
  isCommercial: boolean,
  permits: PermitRow[],
  roofing: PermitRow[],
  mostRecentRoof: string | null,
  roofAge: number | null,
  geo: GeoRow | undefined,
  enr: EnrichRow | undefined,
): string {
  const parts: string[] = [];
  const kind = `${isCommercial ? "Commercial" : "Residential"} ${humanizeUsage(p.property_usage_type)}`;
  const where = p.situs_address ? ` at ${p.situs_address}` : p.situs_zip ? ` in ZIP ${p.situs_zip}` : "";
  parts.push(`${kind}${where} (Duval County, FL; folio ${p.folio}).`);
  if (p.property_type) parts.push(`Parcel type: ${p.property_type}.`);
  const year = p.built_year ?? p.effective_built_year;
  if (year) parts.push(`Built ${year}.`);

  if (permits.length > 0) {
    const types = [...new Set(permits.map((x) => x.improvement_type).filter(Boolean))];
    parts.push(`${permits.length} building permit(s) on record${types.length ? ` (${types.join(", ")})` : ""}.`);
  }
  if (roofing.length > 0) {
    const recency =
      roofAge != null
        ? `roof age about ${roofAge.toFixed(1)} years${roofAge <= ROOF_RECENT_YEARS ? " (recent re-roof)" : ""}`
        : mostRecentRoof
          ? `most recent re-roof ${mostRecentRoof}`
          : "";
    parts.push(`${roofing.length} roofing permit(s)${recency ? `; ${recency}` : ""}.`);
  }

  if (enr?.near_transit) {
    const d = enr.nearest_transit_distance_m;
    parts.push(
      `Near public transit${enr.nearest_transit_stop_name ? ` (nearest JTA stop "${enr.nearest_transit_stop_name}"${d != null ? ` ${Math.round(d)} m` : ""})` : ""} — within walking distance.`,
    );
  } else if (enr && enr.near_transit === false && enr.dist_band) {
    parts.push(`Transit walkability band: ${enr.dist_band}.`);
  }
  if (enr?.water_view) {
    const d = enr.nearest_water_distance_m;
    parts.push(`Waterfront / water view${d != null ? ` (nearest water ${Math.round(d)} m)` : ""}.`);
  } else if (enr && enr.water_view === false && enr.nearest_water_distance_m != null) {
    parts.push(`Nearest water ${Math.round(enr.nearest_water_distance_m)} m.`);
  }

  const sources = ["Duval County appraiser"];
  if (permits.length > 0) sources.push("JaxEPICS permits");
  if (geo) sources.push("US Census geocode");
  parts.push(`Sources: ${sources.join(", ")}.`);
  return parts.join(" ");
}

function buildCitations(
  p: PropertyRow,
  roofing: PermitRow[],
  allPermits: PermitRow[],
  geo: GeoRow | undefined,
  enr: EnrichRow | undefined,
): Citation[] {
  const cites: Citation[] = [
    {
      source_system: "duval_appraiser",
      source_record_key: p.source_record_key,
      source_uri: p.source_artifact_uri,
      page_sha256: p.source_record_hash,
      folio: p.folio,
      contributes: "Property record (use, year built, situs address)",
    },
  ];
  // Cite roofing permits explicitly (they back the roof-related answers); cap the list but keep count.
  const permitCites = roofing.length > 0 ? roofing : allPermits;
  for (const perm of permitCites.slice(0, 8)) {
    cites.push({
      source_system: "duval_jaxepics",
      source_record_key: perm.source_record_key,
      source_uri: null,
      page_sha256: null,
      folio: p.folio,
      contributes: `Permit: ${perm.improvement_type ?? "permit"}${perm.permit_date ? ` (${perm.permit_date})` : ""}`,
    });
  }
  if (geo) {
    cites.push({
      source_system: "duval_geo_census",
      source_record_key: geo.source_record_key,
      source_uri: geo.source_uri,
      page_sha256: null,
      folio: p.folio,
      contributes: "Parcel coordinate (US Census geocode)",
    });
  }
  if (enr) {
    cites.push({
      source_system: "oracle_enrichment",
      source_record_key: p.folio,
      source_uri: null,
      page_sha256: null,
      folio: p.folio,
      contributes:
        "Derived geo/roof facts (walking distance, water proximity, roof age) with inspectable per-property basis in property_enrichment",
    });
  }
  return cites;
}

async function loadRows(client: Client): Promise<PropertyDoc[]> {
  const props = await client.query<PropertyRow>(
    `select p.property_id, p.request_identifier as folio, p.property_type, p.property_usage_type,
            p.property_structure_built_year as built_year, p.property_effective_built_year as effective_built_year,
            a.unnormalized_address as situs_address, a.postal_code as situs_zip,
            p.source_record_key, p.source_artifact_uri, p.source_record_hash
       from properties p
       left join addresses a on a.address_id = p.address_id
      order by p.request_identifier`,
  );

  const permits = await client.query<PermitRow>(
    `select property_id, improvement_type, permit_number, source_record_key,
            coalesce(permit_issue_date, application_received_date, opened_date, completion_date)::text as permit_date
       from property_improvements
      where source_system = 'duval_jaxepics'
        and property_id is not null
        and property_match_confidence = 'high'`,
  );

  const geos = await client.query<GeoRow>(
    `select property_id, latitude, longitude, source_record_key, source_artifact_uri as source_uri
       from geometries where property_id is not null`,
  );

  const enrich = await client.query<EnrichRow>(
    `select property_id, near_transit, nearest_transit_stop_name, nearest_transit_distance_m,
            near_starbucks, dist_band, water_view, nearest_water_distance_m, roof_age_years
       from property_enrichment`,
  );

  const owners = await client.query<OwnerTypeRow>(
    `select property_id,
            count(*) filter (where owner_person_id is not null)::int as person_count,
            count(*) filter (where owner_company_id is not null)::int as company_count
       from ownerships where property_id is not null group by property_id`,
  );

  const permitsBy = new Map<string, PermitRow[]>();
  for (const r of permits.rows) {
    const list = permitsBy.get(r.property_id) ?? [];
    list.push(r);
    permitsBy.set(r.property_id, list);
  }
  const geoBy = new Map(geos.rows.map((r) => [r.property_id, r]));
  const enrBy = new Map(enrich.rows.map((r) => [r.property_id, r]));
  const ownerBy = new Map(owners.rows.map((r) => [r.property_id, r]));

  const now = new Date();
  const docs: PropertyDoc[] = [];
  for (const p of props.rows) {
    const isCommercial = p.property_usage_type != null && p.property_usage_type !== "Residential";
    const allPermits = permitsBy.get(p.property_id) ?? [];
    const roofing = allPermits.filter((x) => (x.improvement_type ?? "").toLowerCase().includes("roof"));
    const roofDates = roofing.map((x) => x.permit_date).filter((d): d is string => !!d).sort();
    const mostRecentRoof = roofDates.length > 0 ? roofDates[roofDates.length - 1]! : null;
    const geo = geoBy.get(p.property_id);
    const enr = enrBy.get(p.property_id);
    const roofAge = enr?.roof_age_years != null ? Number(enr.roof_age_years) : null;
    const recentRoof =
      roofing.length > 0 &&
      (roofAge != null
        ? roofAge <= ROOF_RECENT_YEARS
        : mostRecentRoof != null &&
          (now.getTime() - new Date(mostRecentRoof).getTime()) / 3.15576e10 <= ROOF_RECENT_YEARS);

    const doc: PropertyDoc = {
      id: p.folio,
      corpus_type: "property_record",
      county: "duval",
      folio: p.folio,
      property_type: p.property_type,
      property_usage_type: p.property_usage_type,
      is_commercial: isCommercial,
      built_year: p.built_year,
      effective_built_year: p.effective_built_year,
      situs_address: p.situs_address,
      situs_zip: p.situs_zip,
      owner_type: ownerType(ownerBy.get(p.property_id)),
      permit_count: allPermits.length,
      permit_types: [...new Set(allPermits.map((x) => x.improvement_type).filter((t): t is string => !!t))],
      roofing_permit_count: roofing.length,
      has_recent_roofing_permit: recentRoof,
      most_recent_roofing_permit_date: mostRecentRoof,
      has_coordinate: !!geo,
      latitude: geo ? Number(geo.latitude) : null,
      longitude: geo ? Number(geo.longitude) : null,
      near_transit: enr?.near_transit ?? null,
      nearest_transit_stop_name: enr?.nearest_transit_stop_name ?? null,
      nearest_transit_distance_m: enr?.nearest_transit_distance_m != null ? Number(enr.nearest_transit_distance_m) : null,
      near_starbucks: enr?.near_starbucks ?? null,
      dist_band: enr?.dist_band ?? null,
      water_view: enr?.water_view ?? null,
      nearest_water_distance_m: enr?.nearest_water_distance_m != null ? Number(enr.nearest_water_distance_m) : null,
      roof_age_years: roofAge,
      sources: buildCitations(p, roofing, allPermits, geo, enr),
      text_for_embedding: buildText(p, isCommercial, allPermits, roofing, mostRecentRoof, roofAge, geo, enr),
      embedding_model: EMBEDDING_MODEL_ID,
      embedding_dimension: EMBEDDING_DIMENSION,
      indexed_at: now.toISOString(),
    };
    docs.push(PropertyDocSchema.parse(doc)); // validate the corpus contract before it leaves the builder
  }
  return docs;
}

export class NeonCorpusStore implements CorpusStore {
  async buildDocuments(): Promise<PropertyDoc[]> {
    return withDb((client) => loadRows(client));
  }
}
