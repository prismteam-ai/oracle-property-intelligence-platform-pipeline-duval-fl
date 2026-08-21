/**
 * The six property-intelligence questions the assignment requires, each defined
 * once and consumed by the UI pages, the agent's tools, and the MCP endpoint.
 *
 * Every question carries the SQL it runs, the evidence its answer rests on, and
 * the caveat that bounds it. The caveats are not disclaimers bolted on at the
 * end — they are the difference between an answer and a claim. A user who
 * cannot see what an answer is derived from cannot argue with it.
 */

export interface QuestionColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface Question {
  slug: string;
  title: string;
  /** The question as the assignment phrases it. */
  prompt: string;
  /** Extra WHERE predicate applied on top of the base filter. */
  predicate: (params: Record<string, string | undefined>) => string;
  /** Ordering that puts the most relevant answers first. */
  orderBy: string;
  /** That ordering in words. "Ranked by relevance" is not a fact; this is. */
  orderLabel: string;
  columns: QuestionColumn[];
  /** What the answer is derived from. */
  basis: string;
  /** What the answer cannot support. */
  caveat: string;
  /** Tunable thresholds, rendered as controls. */
  params?: Array<{
    name: string;
    label: string;
    default: string;
    options: string[];
  }>;
}

/** The only owner-locality values the roll derivation produces. */
const OWNER_REGION_CLASSES = [
  "regional_ne_florida",
  "regional_florida",
  "out_of_state",
  "any_non_local",
  "local_duval",
];

const BASE_COLUMNS: QuestionColumn[] = [
  { key: "request_identifier", label: "Parcel / RE#" },
  { key: "address_street", label: "Address" },
  { key: "address_city", label: "City" },
  { key: "owner_name", label: "Owner" },
  { key: "market_value", label: "Just value", numeric: true },
];

export const QUESTIONS: Question[] = [
  {
    slug: "roof-age",
    title: "Roofs older than 15 years",
    prompt: "Which properties have roofs older than 15 years?",
    predicate: (p) =>
      `roof_age_years > ${Number(p["min"] ?? 15) || 15} AND property_usage_type = 'residential'`,
    orderBy: "roof_age_years DESC",
    orderLabel: "oldest roof first",
    columns: [
      ...BASE_COLUMNS,
      { key: "roof_age_years", label: "Roof age (yrs)", numeric: true },
      { key: "roof_age_basis", label: "Basis" },
      { key: "roof_age_confidence", label: "Confidence" },
    ],
    basis:
      "Years since the structure's effective year built, falling back to actual year built. Effective year built advances when a property is substantially improved, which makes it the closest proxy the county roll offers for the age of the current roof.",
    caveat:
      "Derived, not observed. The Florida DOR roll carries no roof installation date and no roofing-permit history is ingested for this milestone, so this is an upper bound: it overstates roof age wherever a roof was replaced without the improvement being reflected in the effective year.",
    params: [
      {
        name: "min",
        label: "Minimum roof age",
        default: "15",
        options: ["10", "15", "20", "30", "40"],
      },
    ],
  },
  {
    slug: "water-view",
    title: "Properties with a view of water",
    prompt: "Which properties have a view of water?",
    predicate: (p) =>
      p["band"] === "proximate"
        ? `water_view_class IN ('waterfront','water_proximate')`
        : `water_view_class = 'waterfront'`,
    orderBy: "dist_to_water_m ASC",
    orderLabel: "closest to water first",
    columns: [
      ...BASE_COLUMNS,
      { key: "dist_to_water_m", label: "Distance to water (m)", numeric: true },
      { key: "nearest_water_name", label: "Water body" },
      { key: "nearest_water_class", label: "Water type" },
      { key: "water_view_class", label: "Proximity band" },
    ],
    basis:
      "Straight-line distance from the parcel centroid to the nearest named river, lake, bay, ocean, canal, reservoir or lagoon in the Overture base/water layer. Within 60 m reads as waterfront; within 150 m as water-proximate.",
    caveat:
      "A distance of 0 m is not missing data: it means the parcel centroid falls inside the water polygon, which happens on large lots a creek or lake runs through. 100 of the 12,697 are like that, and they are the most genuinely waterfront parcels in the county. Adjacency is still not a view — orientation, obstruction and elevation are unknown to this dataset, so a parcel backing onto a river with a building between it and the water reads the same as one with an unobstructed outlook. Overture's water layer also contains 1,959 swimming pools in Duval plus ditches, storm drains and retention basins; those are excluded, as are unnamed generic polygons, which are mostly tidal marsh and would otherwise flag a quarter of the county.",
    params: [
      {
        name: "band",
        label: "Proximity band",
        default: "waterfront",
        options: ["waterfront", "proximate"],
      },
    ],
  },
  {
    slug: "ownership-tenure",
    title: "No ownership change in 10+ years",
    prompt:
      "Which properties have not exchanged ownership in more than 10 years?",
    predicate: (p) =>
      p["evidence"] === "recorded"
        ? `tenure_class = 'held_10_plus_years'`
        : `tenure_class IN ('held_10_plus_years','likely_held_10_plus_years')`,
    orderBy:
      "years_since_last_sale DESC NULLS LAST, assessment_differential_ratio DESC",
    orderLabel: "longest held first, then widest assessment gap",
    columns: [
      ...BASE_COLUMNS,
      { key: "years_since_last_sale", label: "Years held", numeric: true },
      { key: "tenure_class", label: "Tenure" },
      { key: "tenure_basis", label: "Basis" },
      {
        key: "assessment_differential_ratio",
        label: "Assessment gap",
        numeric: true,
      },
    ],
    basis:
      "Where a sale is recorded in the current roll period, the exact years since that sale. Where none is, the Florida assessment-cap differential: Save Our Homes and the non-homestead cap limit how fast assessed value may rise, so the gap between just value and assessed value widens with every year a parcel goes untransferred, and collapses when a sale resets the assessment to market.",
    caveat:
      "Only 51,022 of 404,023 parcels carry a recorded sale — the preliminary roll does not include full historical sale detail. For the rest this is an indicator banded into ranges, not a recorded date. Intra-family transfers, quit-claim deeds and trust re-titling may also not appear as qualified sales, so some long-held parcels have in fact changed hands.",
    params: [
      {
        name: "evidence",
        label: "Evidence",
        default: "all",
        options: ["all", "recorded"],
      },
    ],
  },
  {
    slug: "regional-owners",
    title: "Properties with regional owners",
    prompt: "Which properties have regional owners?",
    predicate: (p) => {
      // Validated against the option list, not sanitised into one. Stripping
      // characters turned "OUT_OF_STATE" into "__" and an empty string into
      // "", both of which are syntactically fine and match nothing — the page
      // reported zero results for a typo with no indication the filter was
      // invalid.
      const requested = p["class"];
      const cls = OWNER_REGION_CLASSES.includes(requested ?? "")
        ? requested!
        : "regional_ne_florida";
      if (cls === "any_non_local") {
        return `owner_region_class IN ('regional_ne_florida','regional_florida','out_of_state')`;
      }
      return `owner_region_class = '${cls}'`;
    },
    orderBy: "owner_portfolio_size DESC, market_value DESC",
    orderLabel: "largest owner portfolio first, then highest value",
    columns: [
      ...BASE_COLUMNS,
      { key: "owner_region_class", label: "Owner locality" },
      { key: "owner_mailing_city", label: "Mailing city" },
      { key: "owner_mailing_state", label: "State" },
      {
        key: "owner_portfolio_size",
        label: "Parcels held",
        numeric: true,
      },
    ],
    basis:
      "The owner's mailing address on the county roll, compared against the property's situs address. A homestead exemption marks owner-occupied; a mailing address in a neighbouring Northeast Florida county marks regional; out of state is out of state. Portfolio size counts how many Duval parcels share a normalised owner name.",
    caveat:
      "Mailing address is where tax notices go, not necessarily where the owner lives — a local owner using an accountant, a PO box or an LLC registered agent will read as non-local. Portfolio counts group on normalised owner name, so two unrelated owners with identical names merge, and one owner spelled two ways splits.",
    params: [
      {
        name: "class",
        label: "Owner locality",
        default: "regional_ne_florida",
        options: OWNER_REGION_CLASSES,
      },
    ],
  },
  {
    slug: "near-transit",
    title: "Within walking distance of public transportation",
    prompt:
      "Which properties are within walking distance of public transportation?",
    predicate: (p) =>
      `dist_to_transit_m IS NOT NULL AND dist_to_transit_m <= ${Number(p["max"] ?? 800) || 800}`,
    orderBy: "dist_to_transit_m ASC",
    orderLabel: "closest to a stop first",
    columns: [
      ...BASE_COLUMNS,
      { key: "dist_to_transit_m", label: "Distance (m)", numeric: true },
      { key: "transit_basis", label: "Basis" },
    ],
    basis:
      "Straight-line distance from the parcel centroid to the nearest transit stop in Overture Places — 211 stops across Duval. 800 m is roughly a ten-minute walk; 400 m is the tighter band.",
    caveat:
      "Straight-line, not network walking distance, so it understates the real walk wherever a river, highway or rail line intervenes — which in Jacksonville is often. Stop coverage is Overture's and service frequency is not modelled: a stop served twice a day counts the same as one served every ten minutes.",
    params: [
      {
        name: "max",
        label: "Maximum distance",
        default: "800",
        options: ["400", "800", "1200"],
      },
    ],
  },
  {
    slug: "near-starbucks",
    title: "Within walking distance of Starbucks",
    prompt: "Which properties are within walking distance of a Starbucks?",
    predicate: (p) =>
      `dist_to_starbucks_m IS NOT NULL AND dist_to_starbucks_m <= ${Number(p["max"] ?? 800) || 800}`,
    orderBy: "dist_to_starbucks_m ASC",
    orderLabel: "closest first",
    columns: [
      ...BASE_COLUMNS,
      { key: "dist_to_starbucks_m", label: "Distance (m)", numeric: true },
      { key: "starbucks_basis", label: "Basis" },
    ],
    basis:
      "Straight-line distance from the parcel centroid to the nearest of the 78 Starbucks locations Overture Places records in Duval, matched on brand or place name.",
    caveat:
      "Straight-line rather than walking distance, and the location set is Overture's snapshot of a single release — a store that opened or closed since is not reflected until the next release is ingested. Licensed in-store counters inside groceries may be recorded inconsistently.",
    params: [
      {
        name: "max",
        label: "Maximum distance",
        default: "800",
        options: ["400", "800", "1200"],
      },
    ],
  },
];

export function questionBySlug(slug: string): Question | undefined {
  return QUESTIONS.find((q) => q.slug === slug);
}

/** Only parcels with a physical address are meaningful answers. */
export const BASE_FILTER = `address_street IS NOT NULL AND address_street <> ''`;

export function buildSql(
  q: Question,
  params: Record<string, string | undefined>,
  limit = 50,
): string {
  const cols = Array.from(new Set(q.columns.map((c) => c.key))).join(", ");
  return [
    `SELECT ${cols}`,
    `FROM properties`,
    `WHERE ${BASE_FILTER}`,
    `  AND ${q.predicate(params)}`,
    `ORDER BY ${q.orderBy}`,
    `LIMIT ${limit}`,
  ].join("\n");
}

export function buildCountSql(
  q: Question,
  params: Record<string, string | undefined>,
): string {
  return [
    `SELECT count(*) AS matches`,
    `FROM properties`,
    `WHERE ${BASE_FILTER}`,
    `  AND ${q.predicate(params)}`,
  ].join("\n");
}
