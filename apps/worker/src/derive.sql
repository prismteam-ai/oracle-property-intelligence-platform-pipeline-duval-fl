-- Derivations behind the six required property-intelligence questions.
--
-- Every derived answer carries a companion *_basis column naming the evidence it
-- came from, and a *_confidence band. Nothing here returns a bare boolean: the
-- UI and the agent both surface the basis so an answer can be argued with.
--
-- Thresholds are substituted from config.ts rather than written as literals, so
-- the walk/waterfront distances have exactly one definition.

-- ------------------------------------------------------- nearest-neighbour prep

-- Parcel centroids as geometry, once, for every proximity join below.
CREATE OR REPLACE TABLE parcel_geo AS
SELECT request_identifier, latitude, longitude,
       ST_Point(longitude, latitude) AS pt
FROM parcel_points
WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Transit stops and Starbucks are small sets (hundreds), so a direct
-- cross-join with a spherical distance is cheap and exact.
CREATE OR REPLACE TABLE transit_stops AS
SELECT place_id, name_primary, category_primary, latitude, longitude
FROM places
WHERE category_primary IN (
  'bus_stop','transit_stop','bus_station','train_station','subway_station',
  'light_rail_station','ferry_terminal','tram_stop','public_transportation'
) AND latitude IS NOT NULL;

CREATE OR REPLACE TABLE starbucks AS
SELECT place_id, name_primary, latitude, longitude
FROM places
WHERE lower(coalesce(brand_name, name_primary, '')) LIKE '%starbucks%'
  AND latitude IS NOT NULL;

-- ------------------------------------------------------------------- proximity

CREATE OR REPLACE TABLE nearest_transit AS
SELECT p.request_identifier,
       min(ST_Distance_Sphere(p.pt, ST_Point(t.longitude, t.latitude))) AS dist_m
FROM parcel_geo p
JOIN transit_stops t
  ON t.latitude  BETWEEN p.latitude  - 0.02 AND p.latitude  + 0.02
 AND t.longitude BETWEEN p.longitude - 0.023 AND p.longitude + 0.023
GROUP BY 1;

CREATE OR REPLACE TABLE nearest_starbucks AS
SELECT p.request_identifier,
       min(ST_Distance_Sphere(p.pt, ST_Point(s.longitude, s.latitude))) AS dist_m
FROM parcel_geo p
JOIN starbucks s
  ON s.latitude  BETWEEN p.latitude  - 0.03 AND p.latitude  + 0.03
 AND s.longitude BETWEEN p.longitude - 0.035 AND p.longitude + 0.035
GROUP BY 1;

-- Water is a much larger set, so it is pruned by envelope overlap first: only
-- water bodies whose bounding box comes within ~350 m of the parcel are
-- distance-tested.
-- Overture's base/water layer is not all "water you could have a view of": in
-- Duval it includes 1,959 swimming pools, plus ditches, storm drains, retention
-- basins and wastewater structures. Restricting to navigable/natural water
-- bodies is the difference between a defensible waterfront signal and one that
-- flags most of the county.
CREATE OR REPLACE TABLE water_env AS
SELECT water_id, water_name, water_class, geom,
       ST_XMin(geom) AS xmin, ST_XMax(geom) AS xmax,
       ST_YMin(geom) AS ymin, ST_YMax(geom) AS ymax
FROM water_bodies
WHERE
  -- Navigable/named water is what a "water view" means. Duval is threaded with
  -- tidal marsh and wetland that Overture files under an unnamed generic 'water'
  -- class; including it flagged a quarter of the county as waterfront, so
  -- unnamed generic polygons are excluded and only named or unambiguously
  -- navigable bodies qualify.
  water_class IN ('river','bay','ocean','canal','lagoon','strait')
  OR (water_class IN ('lake','reservoir','water') AND water_name IS NOT NULL);

CREATE OR REPLACE TABLE nearest_water AS
SELECT request_identifier, dist_m, water_name, water_class FROM (
  SELECT p.request_identifier,
         ST_Distance_Sphere(p.pt, ST_ClosestPoint(w.geom, p.pt)) AS dist_m,
         w.water_name, w.water_class,
         row_number() OVER (PARTITION BY p.request_identifier
                            ORDER BY ST_Distance_Sphere(p.pt, ST_ClosestPoint(w.geom, p.pt))) AS rn
  FROM parcel_geo p
  JOIN water_env w
    ON p.longitude BETWEEN w.xmin - 0.004 AND w.xmax + 0.004
   AND p.latitude  BETWEEN w.ymin - 0.004 AND w.ymax + 0.004
) WHERE rn = 1;

-- --------------------------------------------------------------- sale recency

-- The roll's SALE_YR1 and the Sale Data File disagree occasionally; take the
-- latest qualified sale known from either source.
CREATE OR REPLACE TABLE latest_sale AS
SELECT request_identifier,
       max(sale_date) AS last_sale_date,
       max_by(sale_price, sale_date) AS last_sale_price
FROM (
  SELECT request_identifier,
         make_date(sale1_year, least(greatest(coalesce(sale1_month, 1), 1), 12), 1) AS sale_date,
         sale1_price AS sale_price
  FROM parcels
  WHERE sale1_year BETWEEN 1900 AND year(current_date) + 1
  UNION ALL
  SELECT request_identifier,
         make_date(sale_year, least(greatest(coalesce(sale_month, 1), 1), 12), 1),
         sale_price
  FROM sales
  WHERE sale_year BETWEEN 1900 AND year(current_date) + 1
)
GROUP BY 1;

-- ------------------------------------------------------------- owner locality

-- Normalised owner key, so a portfolio can be counted across parcels.
CREATE OR REPLACE TABLE owner_portfolio AS
SELECT upper(regexp_replace(coalesce(owner_name, ''), '[^A-Za-z0-9]', '', 'g')) AS owner_key,
       count(*) AS parcel_count
FROM parcels
WHERE coalesce(owner_name, '') <> ''
GROUP BY 1;

-- ------------------------------------------------------------ the query table
--
-- One row per folio, matching the Elephant `properties` view contract (the 37
-- columns elephant-mcp's getPropertyQuerySchema describes), plus the Duval
-- derivations. Extra columns are additive: the upstream contract is preserved.

CREATE OR REPLACE TABLE property_query_table AS
WITH base AS (
  SELECT
    p.request_identifier,
    p.parcel_identifier,
    p.owner_name,
    p.dor_use_code,
    p.actual_year_built,
    p.effective_year_built,
    p.working_waterfront_value,
    p.homestead_assessed_value,
    p.owner_city, p.owner_state, p.owner_zip,
    p.situs_addr1, p.situs_city, p.situs_zip,
    p.just_value, p.assessed_value, p.land_value,
    p.land_sqft, p.total_living_area, p.building_count, p.residential_units,
    p.neighborhood_code, p.fiduciary_name,
    p.source_system, p.source_artifact_uri, p.source_record_hash,
    p.first_seen_run_id, p.last_changed_run_id,
    g.latitude, g.longitude,
    ls.last_sale_date, ls.last_sale_price,
    nt.dist_m AS dist_transit_m,
    ns.dist_m AS dist_starbucks_m,
    nw.dist_m AS dist_water_m,
    nw.water_name, nw.water_class,
    op.parcel_count AS owner_portfolio_size
  FROM parcels p
  LEFT JOIN parcel_geo         g  USING (request_identifier)
  LEFT JOIN latest_sale        ls USING (request_identifier)
  LEFT JOIN nearest_transit    nt USING (request_identifier)
  LEFT JOIN nearest_starbucks  ns USING (request_identifier)
  LEFT JOIN nearest_water      nw USING (request_identifier)
  LEFT JOIN owner_portfolio    op
         ON op.owner_key = upper(regexp_replace(coalesce(p.owner_name, ''), '[^A-Za-z0-9]', '', 'g'))
)
SELECT
  -- ---- Elephant query-table contract ----
  md5(concat_ws('|', 'duval', request_identifier))            AS property_id,
  NULL                                                        AS property_cid,
  request_identifier,
  parcel_identifier,
  'duval_appraiser'                                           AS source_system,
  'Duval'                                                     AS county_name,
  'FL'                                                        AS state_code,
  situs_addr1                                                 AS address_street,
  situs_city                                                  AS address_city,
  situs_zip                                                   AS address_zip,
  latitude,
  longitude,
  CASE WHEN land_sqft > 0 THEN round(land_sqft / 43560.0, 4) END AS lot_size_acre,
  land_sqft                                                   AS lot_area_sqft,
  NULL                                                        AS exterior_wall_material,
  NULL                                                        AS roof_covering_material,
  CASE
    WHEN dor_use_code IN ('001') THEN 'single_family'
    WHEN dor_use_code IN ('004') THEN 'condominium'
    WHEN dor_use_code IN ('002') THEN 'mobile_home'
    WHEN dor_use_code IN ('005') THEN 'cooperative'
    WHEN dor_use_code IN ('008') THEN 'multi_family_lt_10'
    WHEN dor_use_code IN ('003') THEN 'multi_family_ge_10'
    WHEN dor_use_code IN ('000') THEN 'vacant_residential'
    ELSE 'other'
  END                                                         AS property_type,
  CASE
    WHEN dor_use_code IN ('000','001','002','004','005','006','007','008','009') THEN 'residential'
    WHEN dor_use_code BETWEEN '010' AND '039' THEN 'commercial'
    WHEN dor_use_code BETWEEN '040' AND '049' THEN 'industrial'
    WHEN dor_use_code BETWEEN '050' AND '069' THEN 'agricultural'
    WHEN dor_use_code BETWEEN '070' AND '079' THEN 'institutional'
    WHEN dor_use_code BETWEEN '080' AND '089' THEN 'governmental'
    ELSE 'other'
  END                                                         AS property_usage_type,
  actual_year_built                                           AS built_year,
  total_living_area                                           AS livable_floor_area,
  total_living_area                                           AS total_area,
  assessed_value,
  just_value                                                  AS market_value,
  land_value,
  NULL                                                        AS avm_value,
  owner_name,
  trim(concat_ws(' ', owner_name, fiduciary_name))            AS owners_text,
  CASE WHEN coalesce(owner_name,'') = '' THEN 0 ELSE 1 END    AS owner_count,
  coalesce(homestead_assessed_value, 0) > 0                   AS owner_occupied,
  last_sale_date,
  last_sale_price,
  neighborhood_code                                           AS subdivision,
  -- Permits, Sunbiz tenancy and BBB contractors are not ingested for this
  -- milestone. They publish as NULL (unknown), never FALSE/0 — asserting an
  -- absence the pipeline never checked would be a claim we cannot support.
  NULL                                                        AS has_permits,
  NULL                                                        AS permit_count,
  NULL                                                        AS has_sunbiz_tenant,
  NULL                                                        AS has_bbb_contractor,
  NULL                                                        AS hoa_flag,

  -- ---- Duval derivations: roof age ----
  CASE WHEN coalesce(effective_year_built, actual_year_built) BETWEEN 1800 AND year(current_date)
       THEN year(current_date) - coalesce(effective_year_built, actual_year_built) END AS roof_age_years,
  CASE WHEN effective_year_built BETWEEN 1800 AND year(current_date) THEN 'effective_year_built'
       WHEN actual_year_built    BETWEEN 1800 AND year(current_date) THEN 'actual_year_built'
       ELSE 'unknown' END                                     AS roof_age_basis,
  CASE WHEN effective_year_built BETWEEN 1800 AND year(current_date) THEN 'medium'
       WHEN actual_year_built    BETWEEN 1800 AND year(current_date) THEN 'low'
       ELSE 'none' END                                        AS roof_age_confidence,

  -- ---- Duval derivations: water ----
  -- Duval's roll reports no assessed working-waterfront value on any parcel
  -- (that statute covers commercial marina use), so proximity to a navigable or
  -- natural water body is the only available basis. Adjacency is a strong proxy
  -- for waterfront; it does not establish a view.
  round(dist_water_m, 1)                                      AS dist_to_water_m,
  water_name                                                  AS nearest_water_name,
  water_class                                                 AS nearest_water_class,
  coalesce(working_waterfront_value, 0) > 0                   AS county_working_waterfront,
  CASE
    WHEN dist_water_m <= ${WATERFRONT_METERS}  THEN 'waterfront'
    WHEN dist_water_m <= ${WATER_PROXIMATE_METERS} THEN 'water_proximate'
    WHEN dist_water_m IS NULL THEN 'unknown'
    ELSE 'inland'
  END                                                         AS water_view_class,
  CASE
    WHEN dist_water_m IS NOT NULL THEN 'parcel_centroid_distance_to_named_water_body'
    ELSE 'no_geometry_or_no_water_within_search_radius'
  END                                                         AS water_view_basis,
  CASE
    WHEN dist_water_m <= ${WATERFRONT_METERS}  THEN 'medium'
    WHEN dist_water_m <= ${WATER_PROXIMATE_METERS} THEN 'low'
    ELSE 'none'
  END                                                         AS water_view_confidence,

  -- ---- Duval derivations: ownership tenure ----
  -- The preliminary roll carries sale detail only for the current roll period,
  -- so an exact tenure is known for a minority of parcels. For the rest, the
  -- Save Our Homes / non-homestead assessment differential is a genuine proxy:
  -- Florida caps annual assessment growth, so the gap between just value and
  -- assessed value widens with every year the parcel goes untransferred. A sale
  -- resets the assessment to market, collapsing the gap. This is banded rather
  -- than converted to a fabricated year count.
  CASE WHEN last_sale_date IS NOT NULL
       THEN round(date_diff('day', last_sale_date, current_date) / 365.25, 1) END AS years_since_last_sale,
  CASE WHEN last_sale_date IS NOT NULL THEN 'recorded_sale_in_roll_period'
       WHEN just_value > 0 THEN 'assessment_differential_proxy'
       ELSE 'unknown' END                                     AS tenure_basis,
  CASE WHEN just_value > 0
       THEN round((just_value - assessed_value) / CAST(just_value AS DOUBLE), 4) END AS assessment_differential_ratio,
  CASE
    WHEN last_sale_date IS NOT NULL THEN
      CASE WHEN date_diff('day', last_sale_date, current_date) / 365.25 >= 10
           THEN 'held_10_plus_years' ELSE 'sold_within_10_years' END
    WHEN just_value > 0 AND (just_value - assessed_value) / CAST(just_value AS DOUBLE) >= 0.25
      THEN 'likely_held_10_plus_years'
    WHEN just_value > 0 AND (just_value - assessed_value) / CAST(just_value AS DOUBLE) >= 0.10
      THEN 'likely_held_5_to_10_years'
    WHEN just_value > 0 THEN 'likely_held_under_5_years'
    ELSE 'unknown'
  END                                                         AS tenure_class,
  CASE WHEN last_sale_date IS NOT NULL THEN 'high' ELSE 'low' END AS tenure_confidence,

  -- ---- Duval derivations: owner locality ----
  CASE
    WHEN coalesce(homestead_assessed_value, 0) > 0 THEN 'owner_occupied'
    WHEN upper(coalesce(owner_state,'')) <> 'FL' AND coalesce(owner_state,'') <> '' THEN 'out_of_state'
    WHEN upper(coalesce(owner_city,'')) IN ('JACKSONVILLE','JACKSONVILLE BEACH','ATLANTIC BEACH',
         'NEPTUNE BEACH','BALDWIN','JAX') THEN 'local_duval'
    WHEN upper(coalesce(owner_city,'')) IN ('ORANGE PARK','MIDDLEBURG','GREEN COVE SPRINGS',
         'ST AUGUSTINE','SAINT AUGUSTINE','PONTE VEDRA','PONTE VEDRA BEACH','FERNANDINA BEACH',
         'YULEE','CALLAHAN','MACCLENNY','PALATKA','FLEMING ISLAND') THEN 'regional_ne_florida'
    WHEN upper(coalesce(owner_state,'')) = 'FL' THEN 'regional_florida'
    ELSE 'unknown'
  END                                                         AS owner_region_class,
  owner_city                                                  AS owner_mailing_city,
  owner_state                                                 AS owner_mailing_state,
  owner_zip                                                   AS owner_mailing_zip,
  coalesce(owner_portfolio_size, 1)                           AS owner_portfolio_size,

  -- ---- Duval derivations: walkability ----
  -- A parcel with no coordinates is unknown, not "nothing nearby"; only a
  -- geolocated parcel can truthfully answer FALSE.
  round(dist_transit_m, 1)                                    AS dist_to_transit_m,
  CASE WHEN latitude IS NULL THEN NULL
       ELSE coalesce(dist_transit_m <= ${WALK_METERS}, FALSE) END   AS walkable_to_transit,
  CASE WHEN latitude IS NULL THEN NULL
       ELSE coalesce(dist_transit_m <= ${WALK_METERS_TIGHT}, FALSE) END AS walkable_to_transit_tight,
  CASE WHEN latitude IS NULL THEN 'no_parcel_coordinates'
       ELSE 'straight_line_from_parcel_centroid_to_overture_transit_stop' END AS transit_basis,
  round(dist_starbucks_m, 1)                                  AS dist_to_starbucks_m,
  CASE WHEN latitude IS NULL THEN NULL
       ELSE coalesce(dist_starbucks_m <= ${WALK_METERS}, FALSE) END AS walkable_to_starbucks,
  CASE WHEN latitude IS NULL THEN 'no_parcel_coordinates'
       ELSE 'straight_line_from_parcel_centroid_to_overture_place' END AS starbucks_basis,

  -- ---- provenance ----
  source_artifact_uri,
  source_record_hash,
  first_seen_run_id,
  last_changed_run_id
FROM base;
