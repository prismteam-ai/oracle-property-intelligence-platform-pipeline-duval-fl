-- Duval Oracle warehouse schema.
--
-- Two planes live here:
--   1. The pipeline plane (pipeline_runs / _steps / _deltas / source_artifacts /
--      watermarks) — the durable journal that makes runs resumable, idempotent, and
--      auditable. This is the evidence behind "continuous and incremental".
--   2. The domain plane (parcels / sales / parcel_points / places) — one table per
--      source, each carrying the Elephant provenance columns verbatim so every
--      published record can be traced to the artifact it came from.
--
-- Parcel identifiers are TEXT everywhere. Duval RE#s carry significant leading
-- zeros; storing them numerically silently merges distinct parcels.

-- ---------------------------------------------------------------- pipeline plane

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id                    TEXT PRIMARY KEY,
    county                    TEXT NOT NULL,
    mode                      TEXT NOT NULL,   -- backfill | incremental | scheduled
    trigger                   TEXT NOT NULL,   -- manual | cron | api
    started_at                TIMESTAMPTZ NOT NULL,
    finished_at               TIMESTAMPTZ,
    status                    TEXT NOT NULL,   -- running | success | failed
    sources_attempted         INTEGER DEFAULT 0,
    sources_succeeded         INTEGER DEFAULT 0,
    sources_skipped_unchanged INTEGER DEFAULT 0,
    records_in                BIGINT  DEFAULT 0,
    inserts                   BIGINT  DEFAULT 0,
    updates                   BIGINT  DEFAULT 0,
    deletes                   BIGINT  DEFAULT 0,
    unchanged                 BIGINT  DEFAULT 0,
    duration_ms               BIGINT,
    limitations               JSON,
    artifacts                 JSON
);

CREATE TABLE IF NOT EXISTS pipeline_run_steps (
    run_id          TEXT NOT NULL,
    step_key        TEXT NOT NULL,
    seq             INTEGER NOT NULL,
    status          TEXT NOT NULL,   -- running | success | failed | skipped_unchanged
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    idempotency_key TEXT,
    detail          JSON,
    error           TEXT,
    PRIMARY KEY (run_id, step_key)
);

-- One row per changed record. This is what the CRM's notification loop reads, and
-- what proves a run actually moved data rather than just re-running.
CREATE TABLE IF NOT EXISTS pipeline_run_deltas (
    run_id         TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    source_system  TEXT NOT NULL,
    record_key     TEXT NOT NULL,
    delta_type     TEXT NOT NULL,   -- insert | update | delete
    changed_fields JSON,
    before_hash    TEXT,
    after_hash     TEXT
);

-- Artifact-level change detection: if the upstream file's ETag/length/digest is
-- unchanged, the whole download-and-parse step is skipped.
CREATE TABLE IF NOT EXISTS source_artifacts (
    artifact_uri      TEXT PRIMARY KEY,
    source_system     TEXT NOT NULL,
    etag              TEXT,
    content_length    BIGINT,
    sha256            TEXT,
    discovered_at     TIMESTAMPTZ,
    downloaded_at     TIMESTAMPTZ,
    first_seen_run_id TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_watermarks (
    source_system   TEXT PRIMARY KEY,
    watermark_value TEXT,
    updated_at      TIMESTAMPTZ
);

-- ------------------------------------------------------------------ domain plane

-- Florida DOR Name-Address-Legal roll: the real-property roll every FL county
-- appraiser files with the state. One row per parcel.
CREATE TABLE IF NOT EXISTS parcels (
    request_identifier   TEXT PRIMARY KEY,   -- canonical folio; dedup key
    parcel_identifier    TEXT NOT NULL,      -- as printed by the county (RE#)
    county_no            TEXT,
    assessment_year      INTEGER,
    dor_use_code         TEXT,
    pa_use_code          TEXT,

    just_value           BIGINT,
    assessed_value       BIGINT,
    taxable_value        BIGINT,
    land_value           BIGINT,
    working_waterfront_value BIGINT,         -- county's own waterfront signal
    homestead_assessed_value BIGINT,
    new_construction_value   BIGINT,
    special_feature_value    BIGINT,

    land_sqft            BIGINT,
    actual_year_built    INTEGER,
    effective_year_built INTEGER,
    total_living_area    BIGINT,
    building_count       INTEGER,
    residential_units    INTEGER,

    owner_name           TEXT,
    owner_addr1          TEXT,
    owner_addr2          TEXT,
    owner_city           TEXT,
    owner_state          TEXT,
    owner_zip            TEXT,
    fiduciary_name       TEXT,

    situs_addr1          TEXT,
    situs_addr2          TEXT,
    situs_city           TEXT,
    situs_zip            TEXT,
    neighborhood_code    TEXT,
    market_area          TEXT,
    census_block         TEXT,
    legal_description    TEXT,

    sale1_price          BIGINT,
    sale1_year           INTEGER,
    sale1_month          INTEGER,
    sale1_qual_code      TEXT,
    sale2_price          BIGINT,
    sale2_year           INTEGER,
    sale2_month          INTEGER,
    sale2_qual_code      TEXT,

    -- Elephant provenance contract
    source_system        TEXT NOT NULL,
    source_record_key    TEXT NOT NULL,
    source_record_hash   TEXT NOT NULL,
    source_artifact_uri  TEXT,
    loaded_at            TIMESTAMPTZ NOT NULL,
    first_seen_run_id    TEXT,
    last_changed_run_id  TEXT
);

-- Florida DOR Sale Data File: the full recorded-sale history behind ownership tenure.
CREATE TABLE IF NOT EXISTS sales (
    sale_key            TEXT PRIMARY KEY,    -- folio + book + page + clerk no
    request_identifier  TEXT NOT NULL,
    sale_year           INTEGER,
    sale_month          INTEGER,
    sale_price          BIGINT,
    qual_code           TEXT,
    vacant_improved     TEXT,
    or_book             TEXT,
    or_page             TEXT,
    clerk_no            TEXT,
    multi_parcel_sale   TEXT,

    source_system       TEXT NOT NULL,
    source_record_key   TEXT NOT NULL,
    source_record_hash  TEXT NOT NULL,
    source_artifact_uri TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL,
    first_seen_run_id   TEXT
);

-- Parcel centroids from the DOR statewide parcel GIS layer.
CREATE TABLE IF NOT EXISTS parcel_points (
    request_identifier  TEXT PRIMARY KEY,
    latitude            DOUBLE,
    longitude           DOUBLE,
    vintage_year        INTEGER,

    source_system       TEXT NOT NULL,
    source_record_key   TEXT NOT NULL,
    source_record_hash  TEXT NOT NULL,
    source_artifact_uri TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL,
    first_seen_run_id   TEXT
);

-- Overture Places pruned to a bounding rectangle around Duval (not the Census
-- county polygon): businesses, POIs, transit stops.
CREATE TABLE IF NOT EXISTS places (
    place_id            TEXT PRIMARY KEY,
    name_primary        TEXT,
    brand_name          TEXT,
    category_primary    TEXT,
    categories          TEXT,
    latitude            DOUBLE,
    longitude           DOUBLE,
    confidence          DOUBLE,

    source_system       TEXT NOT NULL,
    source_record_key   TEXT NOT NULL,
    source_record_hash  TEXT NOT NULL,
    source_artifact_uri TEXT,
    loaded_at           TIMESTAMPTZ NOT NULL,
    first_seen_run_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_folio    ON sales (request_identifier);
CREATE INDEX IF NOT EXISTS idx_places_cat     ON places (category_primary);
CREATE INDEX IF NOT EXISTS idx_deltas_run     ON pipeline_run_deltas (run_id);
