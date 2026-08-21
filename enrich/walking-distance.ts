/**
 * Enrichment: walking-distance amenity facts.
 *
 * For every loaded parcel point (geometries → US Census geocode on the appraiser RE#), find
 * the nearest JTA transit stop (JTA GTFS `stops.txt`, public) and the nearest Starbucks POI
 * (OSM/Overpass, public). Writes to `property_enrichment`:
 *   - near_transit    : boolean  (nearest JTA stop within the transit walkshed)
 *   - near_starbucks  : boolean  (nearest Starbucks within walking distance)
 *   - dist_band       : text     (walkability band of the nearest amenity — transit or Starbucks)
 * plus the exact nearest stop / cafe and their distances, and a `distance_basis` JSON so the
 * "distance calculation basis" is inspectable per property (which POI, which coordinate, how far).
 *
 * Distances are haversine great-circle metres from the parcel point to the POI point.
 * Run: DATABASE_URL=... npx tsx enrich/walking-distance.ts
 */
import type { Client } from "pg";
import {
  ensureEnrichmentTable,
  haversineMeters,
  jtaStops,
  loadParcelPoints,
  overpass,
  round,
  upsertEnrichment,
  withDb,
  type OverpassElement,
  type ParcelPoint,
  type TransitStop,
} from "./lib.ts";

// Walkshed thresholds (metres). 800 m ≈ the standard half-mile transit/amenity walkshed.
const TRANSIT_WALKSHED_M = 800;
const STARBUCKS_WALKSHED_M = 800;

/** Walkability band from a distance in metres (used for `dist_band`). */
function distBand(m: number): string {
  if (m <= 400) return "very_close"; // ≲5 min walk
  if (m <= 800) return "close"; // ≲10 min walk
  if (m <= 1600) return "moderate"; // ≲20 min walk
  return "far";
}

interface Poi {
  name: string;
  lat: number;
  lon: number;
  osmType?: string;
  osmId?: number;
}

/** Nearest element of a list to a parcel, by haversine metres. */
function nearest<T extends { lat: number; lon: number }>(
  p: ParcelPoint,
  items: T[],
): { item: T; distM: number } | null {
  let best: { item: T; distM: number } | null = null;
  for (const it of items) {
    const d = haversineMeters(p.lat, p.lon, it.lat, it.lon);
    if (best === null || d < best.distM) best = { item: it, distM: d };
  }
  return best;
}

/** Fetch Starbucks POIs within the given bbox from OSM/Overpass. */
async function fetchStarbucks(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<Poi[]> {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const query =
    `[out:json][timeout:60];(` +
    `nwr["brand"="Starbucks"](${b});` +
    `nwr["name"~"Starbucks",i]["amenity"="cafe"](${b});` +
    `);out center;`;
  const { elements } = await overpass(query);
  const seen = new Set<string>();
  const out: Poi[] = [];
  for (const e of elements as OverpassElement[]) {
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const key = `${e.type}/${e.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: e.tags?.name ?? "Starbucks", lat, lon, osmType: e.type, osmId: e.id });
  }
  return out;
}

async function main(): Promise<void> {
  await withDb(async (client: Client) => {
    await ensureEnrichmentTable(client);
    const parcels = await loadParcelPoints(client);
    if (parcels.length === 0) throw new Error("no geocoded parcels found in `geometries`");

    // POI sources (public; scoped to the parcels' bbox + ~11 km margin so a distant nearest
    // amenity is still found).
    const pad = 0.1;
    const bbox = {
      south: Math.min(...parcels.map((p) => p.lat)) - pad,
      west: Math.min(...parcels.map((p) => p.lon)) - pad,
      north: Math.max(...parcels.map((p) => p.lat)) + pad,
      east: Math.max(...parcels.map((p) => p.lon)) + pad,
    };
    const { stops, feedUrl } = await jtaStops();
    const starbucks = await fetchStarbucks(bbox);
    // eslint-disable-next-line no-console
    console.log(`sources: ${stops.length} JTA stops, ${starbucks.length} Starbucks POIs`);

    let transitHits = 0;
    let starbucksHits = 0;
    const bandCounts: Record<string, number> = {};
    for (const p of parcels) {
      const nt = nearest<TransitStop>(p, stops);
      const ns = nearest<Poi>(p, starbucks);
      if (nt === null) throw new Error("no transit stops loaded");

      const transitDist = round(nt.distM);
      const nearTransit = nt.distM <= TRANSIT_WALKSHED_M;
      const starbucksDist = ns ? round(ns.distM) : null;
      const nearStarbucks = ns ? ns.distM <= STARBUCKS_WALKSHED_M : false;
      // dist_band = walkability to the nearest amenity of either type (transit or Starbucks).
      const amenityDist = ns ? Math.min(nt.distM, ns.distM) : nt.distM;
      const amenityKind = ns && ns.distM < nt.distM ? "starbucks" : "transit";
      const band = distBand(amenityDist);
      bandCounts[band] = (bandCounts[band] ?? 0) + 1;
      if (nearTransit) transitHits++;
      if (nearStarbucks) starbucksHits++;

      const basis = {
        parcel: { lat: p.lat, lon: p.lon, source: "geometries (US Census geocode on appraiser RE#)" },
        method: "haversine great-circle distance, parcel point → POI point",
        nearest_transit: {
          stop_id: nt.item.stopId,
          stop_name: nt.item.stopName,
          lat: nt.item.lat,
          lon: nt.item.lon,
          distance_m: transitDist,
          within_walkshed_m: TRANSIT_WALKSHED_M,
          source: `JTA GTFS stops.txt (${feedUrl})`,
        },
        nearest_starbucks: ns
          ? {
              name: ns.item.name,
              lat: ns.item.lat,
              lon: ns.item.lon,
              distance_m: starbucksDist,
              within_walkshed_m: STARBUCKS_WALKSHED_M,
              osm: `${ns.item.osmType}/${ns.item.osmId}`,
              source: "OSM Overpass (brand=Starbucks)",
            }
          : null,
        dist_band_of: { amenity: amenityKind, distance_m: round(amenityDist) },
      };

      await upsertEnrichment(client, p.propertyId, p.folio, {
        near_transit: nearTransit,
        nearest_transit_stop_id: nt.item.stopId,
        nearest_transit_stop_name: nt.item.stopName,
        nearest_transit_distance_m: transitDist,
        near_starbucks: nearStarbucks,
        nearest_starbucks_name: ns ? ns.item.name : null,
        nearest_starbucks_distance_m: starbucksDist,
        dist_band: band,
        distance_basis: JSON.stringify(basis),
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `walking-distance: ${parcels.length} parcels | near_transit=${transitHits} ` +
        `near_starbucks=${starbucksHits} | dist_band ${JSON.stringify(bandCounts)}`,
    );
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
