import path from "node:path";

/** Duval County, FL. One lowercase slug end-to-end — the MCP's county key, the
 *  IPNS label suffix, and the --county argument all use this exact string. */
export const COUNTY = "duval";
export const COUNTY_NAME = "Duval";
export const STATE_CODE = "FL";
/** Florida DOR county number for Duval (used in the roll filenames and CO_NO). */
export const DOR_COUNTY_NO = "26";
/** Census FIPS for Duval County, used to clip Overture to the county. */
export const COUNTY_FIPS = "12031";

/** Rough Duval bounding box, used to prune Overture before the precise clip. */
export const DUVAL_BBOX = {
  minLat: 30.103,
  maxLat: 30.586,
  minLng: -82.05,
  maxLng: -81.318,
};

export const DATA_DIR =
  process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
export const DB_PATH =
  process.env.DUCKDB_PATH ?? path.join(DATA_DIR, "duval-oracle.duckdb");
export const RAW_DIR = path.join(DATA_DIR, "raw");
export const ARTIFACT_DIR = path.join(DATA_DIR, "artifacts");

// Publishing configuration, consumed by apps/worker/src/publish/: Parquet
// export -> Filebase upload -> CID read-back -> verification -> IPNS repoint.
export const FILEBASE = {
  endpoint: "https://s3.filebase.io",
  gateway: "https://ipfs.filebase.io",
  namesApi: "https://api.filebase.io/v1/names",
  accessKeyId:
    process.env.S3_ACCESS_KEY_ID ?? process.env.FILEBASE_ACCESS_KEY_ID ?? "",
  secretAccessKey:
    process.env.S3_SECRET_ACCESS_KEY ??
    process.env.FILEBASE_SECRET_ACCESS_KEY ??
    "",
  bucket:
    process.env.S3_BUCKET ??
    process.env.FILEBASE_BUCKET ??
    "elephant-oracle-query-table-duval",
};

/** IPNS labels follow the Elephant convention: oracle-<dataset>-<county>. */
export const IPNS_LABELS = {
  queryTable: `oracle-query-table-${COUNTY}`,
  placeTable: `oracle-place-table-${COUNTY}`,
  runHistory: `oracle-run-history-${COUNTY}`,
  coverage: `oracle-dataset-coverage-${COUNTY}`,
} as const;

/** Object keys are prefix-namespaced so a single bucket can back every dataset.
 *  IPNS points at CIDs, not paths, so one bucket serves all labels without collision. */
export const OBJECT_KEYS = {
  queryTable: `query-tables/${COUNTY}/query-table.parquet`,
  placeTable: `place-tables/${COUNTY}/places.parquet`,
  runHistory: `run-history/${COUNTY}/pipeline-runs.json`,
  coverage: `coverage/${COUNTY}/dataset-coverage.json`,
  changes: (runId: string) => `changes/${COUNTY}/changes-${runId}.parquet`,
} as const;

export const FL_DOR = {
  base: "https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal",
  /** Directory listing API. Confirmed working with the odata=nometadata Accept header. */
  listApi:
    "https://floridarevenue.com/property/dataportal/_api/web/GetFolderByServerRelativeUrl",
} as const;

export const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE ?? "2026-08-19.0";
export const OVERTURE_S3 = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}`;

/** ~10 minutes at an average walking pace. Exposed alongside a 400 m band. */
export const WALK_METERS = 800;
export const WALK_METERS_TIGHT = 400;
/** A parcel centroid within this distance of a water body reads as waterfront. */
export const WATERFRONT_METERS = 60;
export const WATER_PROXIMATE_METERS = 150;
