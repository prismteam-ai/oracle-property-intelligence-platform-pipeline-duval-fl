/**
 * Enrichment: water-view / waterfront proximity.
 *
 * For every loaded parcel point, compute the distance to the nearest OSM water feature
 * (natural=water lakes/ponds/rivers, natural=coastline, waterway riverbank/river/stream/canal),
 * fetched from Overpass scoped to the parcels' bounding box (public; not geo-blocked). Writes to
 * `property_enrichment`:
 *   - water_view                : boolean  (nearest water within the proximity threshold)
 *   - nearest_water_name        : text     (feature name/type)
 *   - nearest_water_distance_m  : numeric
 *   - water_basis               : jsonb    (feature, distance, band, method — inspectable)
 *
 * `water_view` is a coordinate-proximity proxy: the parcel point is close enough to a mapped
 * water feature to plausibly have water frontage / a water view. It is NOT a line-of-sight
 * determination — that needs parcel polygons + elevation, which are out of scope here — so the
 * exact distance and feature are stored for inspection rather than asserting a true "view".
 *
 * Run: DATABASE_URL=... npx tsx enrich/water-view.ts
 */
import type { Client } from "pg";
import {
  bboxOf,
  ensureEnrichmentTable,
  haversineMeters,
  loadParcelPoints,
  overpass,
  pointToSegmentMeters,
  round,
  upsertEnrichment,
  withDb,
  type OverpassElement,
  type ParcelPoint,
} from "./lib.ts";

// Proximity threshold (metres) for the water_view flag. 150 m ≈ frontage / immediate view band.
const WATER_VIEW_THRESHOLD_M = 150;

interface WaterLine {
  pts: { lat: number; lon: number }[];
  name: string;
  kind: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Proximity band from a distance in metres (recorded in the basis). */
function waterBand(m: number): string {
  if (m <= 30) return "waterfront"; // essentially on the water
  if (m <= 150) return "water_view"; // frontage / immediate view band
  if (m <= 500) return "near_water";
  return "inland";
}

function makeLine(pts: { lat: number; lon: number }[], name: string, kind: string): WaterLine {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of pts) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  return { pts, name, kind, minLat, maxLat, minLon, maxLon };
}

/** Fetch water features within the bbox and flatten to named polylines. */
async function fetchWaterLines(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<WaterLine[]> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query =
    `[out:json][timeout:150];(` +
    `way["natural"="water"](${b});` +
    `relation["natural"="water"](${b});` +
    `way["natural"="coastline"](${b});` +
    `way["waterway"~"^(riverbank|river|stream|canal|tidal_channel)$"](${b});` +
    `);out geom;`;
  const { elements } = await overpass(query);
  const lines: WaterLine[] = [];
  for (const e of elements as OverpassElement[]) {
    const label =
      e.tags?.name ?? e.tags?.natural ?? e.tags?.water ?? e.tags?.waterway ?? "water";
    if (e.type === "way" && e.geometry && e.geometry.length > 0) {
      lines.push(makeLine(e.geometry, label, e.tags?.waterway ?? e.tags?.natural ?? "water"));
    } else if (e.type === "relation" && e.members) {
      for (const m of e.members) {
        if (m.geometry && m.geometry.length > 0) {
          lines.push(makeLine(m.geometry, label, e.tags?.water ?? e.tags?.natural ?? "water"));
        }
      }
    }
  }
  return lines;
}

/** Nearest water feature to a parcel, in metres, with a per-polyline bbox pre-filter. */
function nearestWater(p: ParcelPoint, lines: WaterLine[]): { distM: number; name: string; kind: string } | null {
  let best: { distM: number; name: string; kind: string } | null = null;
  const degPad = (m: number): number => m / 111_000; // rough deg per metre for the bbox reject
  for (const line of lines) {
    // Cheap reject: if the parcel is outside the line bbox by more than the current best, skip.
    if (best !== null) {
      const pad = degPad(best.distM);
      if (
        p.lat < line.minLat - pad ||
        p.lat > line.maxLat + pad ||
        p.lon < line.minLon - pad ||
        p.lon > line.maxLon + pad
      ) {
        continue;
      }
    }
    const g = line.pts;
    for (let i = 0; i + 1 < g.length; i++) {
      const d = pointToSegmentMeters(p.lat, p.lon, g[i]!.lat, g[i]!.lon, g[i + 1]!.lat, g[i + 1]!.lon);
      if (best === null || d < best.distM) best = { distM: d, name: line.name, kind: line.kind };
    }
    if (g.length === 1) {
      const d = haversineMeters(p.lat, p.lon, g[0]!.lat, g[0]!.lon);
      if (best === null || d < best.distM) best = { distM: d, name: line.name, kind: line.kind };
    }
  }
  return best;
}

async function main(): Promise<void> {
  await withDb(async (client: Client) => {
    await ensureEnrichmentTable(client);
    const parcels = await loadParcelPoints(client);
    if (parcels.length === 0) throw new Error("no geocoded parcels found in `geometries`");

    const bbox = bboxOf(parcels, 0.1);
    const lines = await fetchWaterLines(bbox);
    // eslint-disable-next-line no-console
    console.log(`sources: ${lines.length} OSM water polylines in the parcel bbox`);

    let waterViewHits = 0;
    const bandCounts: Record<string, number> = {};
    for (const p of parcels) {
      const nw = nearestWater(p, lines);
      if (nw === null) throw new Error("no water features returned by Overpass");
      const dist = round(nw.distM);
      const isView = nw.distM <= WATER_VIEW_THRESHOLD_M;
      const band = waterBand(nw.distM);
      bandCounts[band] = (bandCounts[band] ?? 0) + 1;
      if (isView) waterViewHits++;

      const basis = {
        parcel: { lat: p.lat, lon: p.lon, source: "geometries (US Census geocode on appraiser RE#)" },
        method: "min distance parcel point → nearest OSM water polyline segment (equirectangular)",
        nearest_water: { name: nw.name, kind: nw.kind, distance_m: dist, source: "OSM Overpass (natural=water / coastline / waterway)" },
        threshold_m: WATER_VIEW_THRESHOLD_M,
        band,
        note: "coordinate-proximity proxy, not a line-of-sight view determination",
      };

      await upsertEnrichment(client, p.propertyId, p.folio, {
        water_view: isView,
        nearest_water_name: nw.name,
        nearest_water_distance_m: dist,
        water_basis: JSON.stringify(basis),
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `water-view: ${parcels.length} parcels | water_view=${waterViewHits} ` +
        `(<= ${WATER_VIEW_THRESHOLD_M} m) | bands ${JSON.stringify(bandCounts)}`,
    );
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
