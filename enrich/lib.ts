/**
 * Shared helpers for the Duval enrichment stage (Task 8).
 *
 * Enrichment facts are computed in OUR OWN Neon layer — a dedicated `property_enrichment`
 * table — NOT by extending the kit's fixed query-table schema, so the kit exporter is never
 * forked (design §4). Every fact carries an inspectable `*_basis` JSON so the derivation
 * (which POI, what distance, which permit) can be audited per property.
 *
 * Server-only: the Neon connection string is read from `process.env.DATABASE_URL` and never
 * hardcoded or logged. External POI sources (JTA GTFS, OSM/Overpass) are public and fetched
 * directly; responses are cached under the OS temp dir (never committed) to avoid re-hammering
 * the public endpoints across the four scripts.
 */
import { Client } from "pg";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USER_AGENT = "oracle-duval-enrich/1.0 (public property-data enrichment)";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — POI layers are slow-moving

// ---------------------------------------------------------------------------
// Database (server-only)
// ---------------------------------------------------------------------------

/** Read the Neon connection string from the environment. Never commit or log this value. */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error(
      "DATABASE_URL is not set. Provide the Neon connection string via the environment " +
        "(server-only — it must never be committed or printed).",
    );
  }
  return url;
}

/** Connect, run `fn`, always close. */
export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: getDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Create the enrichment table if absent (idempotent). One row per property, keyed by the
 * appraiser folio's `property_id`; every fact keeps its own inspectable `*_basis` JSON.
 */
export async function ensureEnrichmentTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists property_enrichment (
      property_id                   uuid primary key references properties(property_id),
      request_identifier            text not null,
      -- walking-distance (enrich/walking-distance.ts)
      near_transit                  boolean,
      nearest_transit_stop_id       text,
      nearest_transit_stop_name     text,
      nearest_transit_distance_m    numeric(10,1),
      near_starbucks                boolean,
      nearest_starbucks_name        text,
      nearest_starbucks_distance_m  numeric(10,1),
      dist_band                     text,
      distance_basis                jsonb,
      -- water-view (enrich/water-view.ts)
      water_view                    boolean,
      nearest_water_name            text,
      nearest_water_distance_m      numeric(10,1),
      water_basis                   jsonb,
      -- roof-age (enrich/roof-age.ts)
      roof_age_years                numeric(5,1),
      roof_permit_number            text,
      roof_permit_date              date,
      roof_age_basis                jsonb,
      -- regional-owner (enrich/regional-owner.ts)
      regional_owner                text,
      owner_locality_basis          jsonb,
      -- provenance
      computed_at                   timestamptz not null default now(),
      updated_at                    timestamptz not null default now()
    );
  `);
}

/** A loaded parcel point (from `geometries`, US Census geocode keyed on the appraiser RE#). */
export interface ParcelPoint {
  propertyId: string;
  folio: string;
  lat: number;
  lon: number;
}

/** All parcels that carry a real coordinate — the enrichment-eligible set. */
export async function loadParcelPoints(client: Client): Promise<ParcelPoint[]> {
  const { rows } = await client.query(
    `select g.property_id, g.request_identifier, g.latitude, g.longitude
       from geometries g
      where g.latitude is not null and g.longitude is not null
        and g.property_id is not null
      order by g.request_identifier`,
  );
  return rows.map((r) => ({
    propertyId: r.property_id,
    folio: r.request_identifier,
    lat: Number(r.latitude),
    lon: Number(r.longitude),
  }));
}

/** Upsert one property's enrichment columns (only the passed columns are written). */
export async function upsertEnrichment(
  client: Client,
  propertyId: string,
  folio: string,
  cols: Record<string, unknown>,
): Promise<void> {
  const keys = Object.keys(cols);
  const setList = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
  const insertCols = ["property_id", "request_identifier", ...keys];
  const insertVals = insertCols.map((_, i) => `$${i + 1}`);
  const updateSet = [...keys.map((k, i) => `${k} = $${i + 3}`), "updated_at = now()"].join(", ");
  const params = [propertyId, folio, ...keys.map((k) => cols[k])];
  await client.query(
    `insert into property_enrichment (${insertCols.join(", ")})
       values (${insertVals.join(", ")})
     on conflict (property_id) do update set ${updateSet}`,
    params,
  );
  void setList;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance in metres between two lat/lon points. */
export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance in metres from point P to the segment A-B, using a local equirectangular
 * projection centred on P (accurate to well under a metre at county scale).
 */
export function pointToSegmentMeters(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos(toRad(pLat));
  const px = 0;
  const py = 0;
  const ax = (aLon - pLon) * mPerDegLon;
  const ay = (aLat - pLat) * mPerDegLat;
  const bx = (bLon - pLon) * mPerDegLon;
  const by = (bLat - pLat) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Bounding box of a set of points, padded by `padDeg` degrees. */
export function bboxOf(
  pts: { lat: number; lon: number }[],
  padDeg: number,
): { south: number; west: number; north: number; east: number } {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of pts) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }
  return { south: south - padDeg, west: west - padDeg, north: north + padDeg, east: east + padDeg };
}

// ---------------------------------------------------------------------------
// External POI sources (public; cached under the OS temp dir, never committed)
// ---------------------------------------------------------------------------

function cacheDir(): string {
  const dir = join(tmpdir(), "oracle-duval-enrich-cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function freshCache(file: string): boolean {
  return existsSync(file) && Date.now() - statSync(file).mtimeMs < CACHE_TTL_MS;
}

// Public Overpass endpoints (tried in order; the load balancers 504/429 under load).
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Overpass API turbo query → parsed JSON, cached by query hash, retried across mirrors. */
export async function overpass(query: string): Promise<{ elements: OverpassElement[] }> {
  const file = join(cacheDir(), `overpass-${createHash("sha1").update(query).digest("hex")}.json`);
  if (freshCache(file)) return JSON.parse(readFileSync(file, "utf8"));
  const body = "data=" + encodeURIComponent(query);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(180_000),
        });
        if (res.status === 504 || res.status === 429 || res.status === 502 || res.status === 503) {
          lastErr = new Error(`Overpass ${endpoint} HTTP ${res.status}`);
          continue;
        }
        if (!res.ok) throw new Error(`Overpass ${endpoint} HTTP ${res.status}`);
        const json = (await res.json()) as { elements: OverpassElement[] };
        writeFileSync(file, JSON.stringify(json));
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    await sleep(3000 * (attempt + 1));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Overpass: all endpoints failed");
}

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
}

export interface TransitStop {
  stopId: string;
  stopName: string;
  lat: number;
  lon: number;
}

/**
 * Download + parse the current JTA GTFS `stops.txt` (public, not geo-blocked). Cached zip
 * under the OS temp dir; extracted with the `unzip` CLI (already used by the seed builder).
 */
export async function jtaStops(): Promise<{ stops: TransitStop[]; feedUrl: string }> {
  const feedUrl = process.env.JTA_GTFS_URL ?? "https://ride.jtafla.com/gtfs-archive/gtfs.zip";
  const zipFile = join(cacheDir(), `jta-gtfs-${createHash("sha1").update(feedUrl).digest("hex")}.zip`);
  if (!freshCache(zipFile)) {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`JTA GTFS HTTP ${res.status}`);
    writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
  }
  const stopsCsv = execFileSync("unzip", ["-p", zipFile, "stops.txt"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stops = parseGtfsStops(stopsCsv);
  return { stops, feedUrl };
}

/** Parse GTFS stops.txt → transit stops (location_type 0/blank = boarding stops only). */
export function parseGtfsStops(csv: string): TransitStop[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!);
  const idx = (name: string): number => header.indexOf(name);
  const iId = idx("stop_id");
  const iName = idx("stop_name");
  const iLat = idx("stop_lat");
  const iLon = idx("stop_lon");
  const iType = idx("location_type");
  const out: TransitStop[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]!);
    const locType = iType >= 0 ? (c[iType] ?? "").trim() : "";
    if (locType !== "" && locType !== "0") continue; // skip stations/entrances
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ stopId: c[iId] ?? "", stopName: c[iName] ?? "", lat, lon });
  }
  return out;
}

/** Minimal RFC-4180 CSV line parser (honours double-quoted fields with escaped ""). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Round to `dp` decimal places (keeps stored distances tidy + comparable). */
export function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
