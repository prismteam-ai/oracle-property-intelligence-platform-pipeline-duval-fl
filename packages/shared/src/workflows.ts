/**
 * The six Oracle inquiry workflows and the six source categories — the single source of truth
 * shared by the API (SQL procedures), the agent (tool routing), and the web UI (per-criterion
 * views). Each workflow names the Neon columns / entities it is answered from and, where the
 * enrichment backfill is still pending (Task 13), an honest `pendingNote` the agent surfaces
 * instead of fabricating data.
 */

export type WorkflowId =
  | "roof_age"
  | "water_view"
  | "ownership_age"
  | "regional_owner"
  | "walking_distance"
  | "records_by_source";

export interface WorkflowSpec {
  id: WorkflowId;
  title: string;
  /** One-sentence business question this workflow answers. */
  question: string;
  /** How it is derived from the reconciled Neon entities (shown in the UI + agent evidence). */
  basis: string;
  /** Set when a fact is not yet fully populated; the agent states this instead of faking data. */
  pendingNote?: string;
}

export const WORKFLOWS: readonly WorkflowSpec[] = [
  {
    id: "roof_age",
    title: "Roof age (> 15-year candidates)",
    question:
      "Which properties have a roof older than 15 years (candidates for re-roofing / further review)?",
    basis:
      "property_enrichment.roof_age_years, derived as years since the most recent linked re-roof " +
      "permit (JaxEPICS), with the permit number + date as the inspectable basis. Properties with " +
      "no linked roofing permit have an unknown (null) roof age and are reported as such, not guessed.",
  },
  {
    id: "water_view",
    title: "Water view / waterfront",
    question: "Which properties have a water view or are adjacent to water?",
    basis:
      "property_enrichment.water_view — a coordinate-proximity proxy: minimum distance from the " +
      "parcel centroid (US Census geocode) to the nearest OSM water feature, banded at 150 m. The " +
      "basis (nearest water name, distance, method) is inspectable per property. It is a proximity " +
      "proxy, not a line-of-sight view determination.",
  },
  {
    id: "ownership_age",
    title: "Ownership age (no recorded exchange in 10 years)",
    question:
      "Which properties have had no recorded ownership exchange in the last 10 years (long-held)?",
    basis:
      "The most recent recorded ownership transfer per property (sales_histories.ownership_transfer_date, " +
      "backed by the deeds/clerk record) older than 10 years. Cited by deed book/page/instrument and date.",
  },
  {
    id: "regional_owner",
    title: "Regional / out-of-area owners",
    question: "Which properties are owned by regional (out-of-locality) owners?",
    basis:
      "property_enrichment.regional_owner — owner mailing locality (ZIP/state) compared against the " +
      "property situs. The classification logic is implemented; the owner-mailing backfill is the " +
      "input.",
    pendingNote:
      "Owner mailing addresses are not yet backfilled (ownerships.mailing_address_id is currently " +
      "unpopulated — scheduled in the Task 13 backfill), so 0 properties are classified today. The " +
      "workflow returns this honestly rather than fabricating owner localities; once mailing " +
      "addresses are loaded the same query classifies each owner as local vs regional.",
  },
  {
    id: "walking_distance",
    title: "Walking distance (with distance basis)",
    question:
      "Which properties are within walking distance of transit / a Starbucks, and on what basis?",
    basis:
      "property_enrichment.near_transit / near_starbucks / dist_band, computed as the haversine " +
      "great-circle distance from the parcel centroid (US Census geocode) to the nearest JTA GTFS " +
      "stop and nearest OSM Starbucks, with an 800 m walkshed. The full distance_basis JSON " +
      "(parcel point, POI point, method, thresholds) is returned as the distance calculation basis.",
  },
  {
    id: "records_by_source",
    title: "Records by source (all six categories)",
    question: "How many records were ingested per source, with provenance and load timestamps?",
    basis:
      "Live counts across the six source categories (appraisal, permits, coordinates, ownership, " +
      "business registrations, contractor reputation) plus the published oracle_dataset_coverage " +
      "snapshot. Counts are derived from the DB at query time, never hardcoded.",
  },
] as const;

export function getWorkflow(id: WorkflowId): WorkflowSpec {
  const w = WORKFLOWS.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown workflow: ${id}`);
  return w;
}

/** The six source categories shown in the records-by-source overview. */
export type SourceCategoryId =
  | "appraisal"
  | "permits"
  | "coordinates"
  | "ownership"
  | "business"
  | "contractor";

export interface SourceCategory {
  id: SourceCategoryId;
  label: string;
  source: string;
  description: string;
}

export const SOURCE_CATEGORIES: readonly SourceCategory[] = [
  {
    id: "appraisal",
    label: "Appraisal",
    source: "Duval County Property Appraiser",
    description: "Parcel record, use type, year built, situs address, valuations, structures.",
  },
  {
    id: "permits",
    label: "Permits",
    source: "JaxEPICS (Accela)",
    description: "Building/roofing/electrical permits linked to parcels by folio + address.",
  },
  {
    id: "coordinates",
    label: "Coordinates",
    source: "US Census geocoder",
    description: "Parcel centroid latitude/longitude keyed on the appraiser RE#.",
  },
  {
    id: "ownership",
    label: "Ownership",
    source: "Duval appraiser (owners)",
    description: "Owner persons/companies and the ownership relationship to the parcel.",
  },
  {
    id: "business",
    label: "Business registrations",
    source: "Florida Sunbiz",
    description: "Corporate registrations reconciled to owners/contractors by name/address.",
  },
  {
    id: "contractor",
    label: "Contractor reputation",
    source: "Better Business Bureau (BBB)",
    description: "Contractor BBB profiles + a derived quality score, linked off permit contractors.",
  },
] as const;
