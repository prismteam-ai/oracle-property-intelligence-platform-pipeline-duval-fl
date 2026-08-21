import {
  WALK_METERS,
  WALK_METERS_TIGHT,
  WATERFRONT_METERS,
  WATER_PROXIMATE_METERS,
} from "./config.ts";
import type { RunContext, StepResult } from "./runner.ts";
import { query, runSqlFile, scalar } from "./warehouse.ts";

/**
 * Rebuild the derived query table from the current warehouse state.
 *
 * Derivation is deliberately a whole-table rebuild rather than an incremental
 * patch: it is cheap at Duval's scale, and it guarantees the published artifact
 * is a consistent snapshot of one moment rather than a mix of vintages.
 */
export async function deriveQueryTable(ctx: RunContext): Promise<StepResult> {
  await runSqlFile("derive.sql", {
    WALK_METERS,
    WALK_METERS_TIGHT,
    WATERFRONT_METERS,
    WATER_PROXIMATE_METERS,
  });

  const rows = Number(
    await scalar(`SELECT count(*) FROM property_query_table`),
  );
  const distinctFolios = Number(
    await scalar(
      `SELECT count(DISTINCT request_identifier) FROM property_query_table`,
    ),
  );

  // The Elephant query-table gate: exactly one row per folio, no empty folios.
  if (rows !== distinctFolios) {
    throw new Error(
      `Query table has ${rows} rows but only ${distinctFolios} distinct folios — the one-row-per-property contract is violated.`,
    );
  }
  const emptyFolios = Number(
    await scalar(
      `SELECT count(*) FROM property_query_table WHERE request_identifier IS NULL OR trim(request_identifier) = ''`,
    ),
  );
  if (emptyFolios > 0) {
    throw new Error(`Query table contains ${emptyFolios} null/empty folios.`);
  }

  // Coverage is reported, never implied. Columns we cannot populate for Duval
  // stay NULL and are named explicitly in the run's limitations.
  const [cov] = await query<Record<string, number>>(`
    SELECT
      count(*) FILTER (WHERE latitude IS NOT NULL)              AS with_coords,
      count(*) FILTER (WHERE roof_age_years IS NOT NULL)        AS with_roof_age,
      count(*) FILTER (WHERE roof_age_years > 15)               AS roof_over_15,
      count(*) FILTER (WHERE last_sale_date IS NOT NULL)        AS with_recorded_sale,
      count(*) FILTER (WHERE tenure_class IN ('held_10_plus_years','likely_held_10_plus_years')) AS held_10_plus,
      count(*) FILTER (WHERE water_view_class = 'waterfront')   AS waterfront,
      count(*) FILTER (WHERE water_view_class = 'water_proximate') AS water_proximate,
      count(*) FILTER (WHERE walkable_to_transit)               AS near_transit,
      count(*) FILTER (WHERE walkable_to_starbucks)             AS near_starbucks,
      count(*) FILTER (WHERE owner_region_class = 'out_of_state')        AS out_of_state,
      count(*) FILTER (WHERE owner_region_class = 'regional_ne_florida') AS regional_ne_fl,
      count(*) FILTER (WHERE owner_portfolio_size >= 10)        AS owners_with_10_plus_parcels
    FROM property_query_table
  `);

  ctx.limitation(
    "Permit and contractor coverage is not ingested for this milestone: has_permits, permit_count, has_bbb_contractor and has_sunbiz_tenant publish as NULL (unknown), never as FALSE — an absence we never checked is not an absence.",
  );
  ctx.limitation(
    "exterior_wall_material, roof_covering_material and hoa_flag are not present in the Florida DOR roll and are published as NULL for Duval.",
  );
  ctx.limitation(
    "Roof age is derived from effective/actual year built, not from a roofing permit; it is an upper bound that overstates age where an unpermitted re-roof occurred.",
  );
  ctx.limitation(
    "Transit and Starbucks distances are straight-line from the parcel centroid, not network walking distance, so they understate the real walk.",
  );
  ctx.limitation(
    `Ownership tenure is exactly known only for the ${Number(cov!.with_recorded_sale).toLocaleString()} parcels with a sale recorded in the current DOR roll period; the preliminary roll does not carry full historical sale detail. For the remainder tenure is banded from the Florida assessment-cap differential, which widens with each untransferred year — an indicator, not a recorded date.`,
  );
  ctx.limitation(
    "Waterfront is derived from parcel-centroid distance to a named river, lake, bay, ocean, canal, reservoir or lagoon. Overture's water layer also contains swimming pools, ditches, drains and retention basins, which are excluded. Adjacency does not establish a view: orientation, obstruction and elevation are unknown.",
  );

  return {
    recordsIn: rows,
    rows,
    distinctFolios,
    coverage: Object.fromEntries(
      Object.entries(cov!).map(([k, v]) => [k, Number(v)]),
    ),
  };
}
