/**
 * Query API routes for property search and single-property detail.
 * T053 — GET /api/properties/search, GET /api/properties/:parcel_id
 */

import { Hono } from 'hono';
import { query, queryOne } from '../lib/db.js';

const queryRoutes = new Hono();

// ---------------------------------------------------------------------------
// Query type definitions
// ---------------------------------------------------------------------------

type QueryType =
  | 'roof_age_gt_15'
  | 'water_view'
  | 'ownership_tenure_gt_10'
  | 'regional_owners'
  | 'transit_walking'
  | 'starbucks_walking';

interface QueryDefinition {
  label: string;
  where: string;
  signalColumn: string;
  signalLabel: string;
}

const QUERY_DEFINITIONS: Record<QueryType, QueryDefinition> = {
  roof_age_gt_15: {
    label: 'Roofs older than 15 years',
    where: "(derived_signals->>'roof_age_years')::int > 15",
    signalColumn: "derived_signals->>'roof_age_years'",
    signalLabel: 'Roof Age (yrs)',
  },
  water_view: {
    label: 'View of water',
    where: "(derived_signals->>'is_waterfront')::boolean = true",
    signalColumn: "derived_signals->>'water_proximity_ft'",
    signalLabel: 'Water Distance (ft)',
  },
  ownership_tenure_gt_10: {
    label: 'No ownership change in 10+ years',
    where: "(derived_signals->>'ownership_tenure_years')::int > 10",
    signalColumn: "derived_signals->>'ownership_tenure_years'",
    signalLabel: 'Tenure (yrs)',
  },
  regional_owners: {
    label: 'Regional owners',
    where: "(derived_signals->>'is_regional_owner')::boolean = true",
    signalColumn: "current_owner->>'mailing_address'",
    signalLabel: 'Owner Location',
  },
  transit_walking: {
    label: 'Walking distance to public transit',
    where: "(derived_signals->>'within_walking_transit')::boolean = true",
    signalColumn: "derived_signals->>'transit_distance_mi'",
    signalLabel: 'Transit (mi)',
  },
  starbucks_walking: {
    label: 'Walking distance to Starbucks',
    where: "(derived_signals->>'within_walking_starbucks')::boolean = true",
    signalColumn: "derived_signals->>'starbucks_distance_mi'",
    signalLabel: 'Starbucks (mi)',
  },
};

// ---------------------------------------------------------------------------
// GET /api/properties/search?query=<type>&page=<n>&limit=<n>
// ---------------------------------------------------------------------------

queryRoutes.get('/api/properties/search', async (c) => {
  const queryType = c.req.query('query') as QueryType | undefined;

  if (!queryType || !QUERY_DEFINITIONS[queryType]) {
    return c.json(
      {
        error: 'Invalid query type',
        valid_types: Object.keys(QUERY_DEFINITIONS),
      },
      400,
    );
  }

  const def = QUERY_DEFINITIONS[queryType];
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  try {
    // Count total matching rows
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM properties WHERE ${def.where}`,
    );
    const total = parseInt(countResult?.count ?? '0', 10);

    // Fetch results
    const { rows } = await query<Record<string, unknown>>(
      `SELECT
        parcel_id,
        address->>'full' as address,
        assessed_value,
        ${def.signalColumn} as signal_value,
        jsonb_array_length(COALESCE(provenance->'contributing_sources', '[]'::jsonb)) as source_count,
        provenance,
        derived_signals
      FROM properties
      WHERE ${def.where}
      ORDER BY parcel_id
      LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return c.json({
      query_type: queryType,
      query_label: def.label,
      signal_label: def.signalLabel,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      results: rows,
    });
  } catch (err) {
    console.error('[query-routes] search error:', err);
    return c.json({ error: 'Search query failed', detail: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/properties/search/types — list available query types
// ---------------------------------------------------------------------------

queryRoutes.get('/api/properties/search/types', (c) => {
  const types = Object.entries(QUERY_DEFINITIONS).map(([key, def]) => ({
    type: key,
    label: def.label,
    signal_label: def.signalLabel,
  }));
  return c.json({ types });
});

// ---------------------------------------------------------------------------
// GET /api/properties/:parcel_id — single property detail
// ---------------------------------------------------------------------------

queryRoutes.get('/api/properties/:parcel_id', async (c) => {
  const parcelId = c.req.param('parcel_id');

  try {
    const row = await queryOne<Record<string, unknown>>(
      `SELECT
        uuid,
        parcel_id,
        address,
        county_jurisdiction,
        assessed_value,
        market_value,
        ownership,
        current_owner,
        permits,
        structure,
        lot,
        coordinates,
        tax,
        provenance,
        derived_signals,
        created_at,
        updated_at
      FROM properties
      WHERE parcel_id = $1`,
      [parcelId],
    );

    if (!row) {
      return c.json({ error: 'Property not found' }, 404);
    }

    return c.json({ property: row });
  } catch (err) {
    console.error('[query-routes] detail error:', err);
    return c.json({ error: 'Property lookup failed', detail: String(err) }, 500);
  }
});

export { queryRoutes };
