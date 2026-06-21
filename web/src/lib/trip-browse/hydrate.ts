import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  mapMasterPlaceRow,
  primaryCategoryToSlideKey,
  isSuppressedCategory,
  type MasterPlaceRow,
} from "@/lib/trip-browse/federated";
import type { BrowsePlace } from "@/lib/trip-browse/places";

/**
 * Hydrate a list of master_place IDs (the thin output of the Typesense
 * matcher in `lib/search`) into full BrowsePlace cards, reusing the same
 * `mapMasterPlaceRow` projector the federated corridor path uses — but
 * WITHOUT the corridor spatial filter, because search is corpus-wide.
 *
 * Shared by `/api/places/hydrate` (the in-panel slide search) and
 * `/api/search-area` (the top-level merged search) so both project corpus
 * rows identically.
 *
 * Why service-role, not a SECURITY DEFINER RPC like pois_along_corridor:
 * master_place keeps RLS closed with no public-read policy. The corridor
 * RPC is the sanctioned anon door for the *corridor* read. A by-arbitrary-id
 * read is a different shape; rather than open a new permanent anon door into
 * the table, this server-only read uses the service-role key — the same
 * pattern data/search/sync-typesense.ts already uses. It returns only the
 * fields the card needs (the same fields the public corridor RPC exposes),
 * so no new data is surfaced.
 *
 * Geometry: the base table's PostGIS column can't be projected through
 * PostgREST (.select() can't call ST_X/ST_Y). The
 * `master_place_search_export` view already splits it into lng/lat doubles —
 * so lng/lat come from the view and the rest of the (plain/jsonb) card fields
 * come from the base table, merged by id.
 *
 * Throws on a Supabase read error (callers decide whether to 502 or degrade
 * to []). Returns results in the caller's (Typesense-ranked) id order,
 * dropping ids that didn't resolve in both reads.
 */

const MAX_IDS = 50;

type HydrateRow = {
  id: string;
  canonical_name: string;
  primary_category: string;
  prominence_score: number;
  mvum_corridor: boolean | null;
  overlander_tags: string[] | null;
  contact: Record<string, unknown> | null;
  description: string | null;
  attribution: Record<string, string> | null;
  hours: Record<string, unknown> | null;
};

export async function hydratePlacesByIds(
  rawIds: string[],
): Promise<BrowsePlace[]> {
  // De-dupe while preserving the caller's (Typesense-ranked) order.
  const ids = Array.from(new Set(rawIds)).slice(0, MAX_IDS);
  if (ids.length === 0) return [];

  const supabase = createSupabaseServiceClient();

  // Base table: every card field except the PostGIS-derived lng/lat. Mirror
  // the corridor RPC's exclusions (searchable, non-land_status) so the
  // search corpus and the panel corpus stay identical.
  const baseQuery = supabase
    .from("master_place")
    .select(
      "id,canonical_name,primary_category,prominence_score,mvum_corridor,overlander_tags,contact,description,attribution,hours",
    )
    .in("id", ids)
    .eq("is_searchable", true)
    .neq("primary_category", "land_status");

  // View: geometry split into lng/lat doubles.
  const geoQuery = supabase
    .from("master_place_search_export")
    .select("id,lng,lat")
    .in("id", ids);

  const [baseRes, geoRes] = await Promise.all([baseQuery, geoQuery]);

  if (baseRes.error) {
    throw new Error(`master_place read failed: ${baseRes.error.message}`);
  }
  if (geoRes.error) {
    throw new Error(`search_export read failed: ${geoRes.error.message}`);
  }

  const baseById = new Map<string, HydrateRow>(
    (baseRes.data as HydrateRow[]).map((r) => [r.id, r]),
  );
  const geoById = new Map<string, { lng: number; lat: number }>(
    (geoRes.data as { id: string; lng: number; lat: number }[]).map((r) => [
      r.id,
      { lng: r.lng, lat: r.lat },
    ]),
  );

  // Project in the caller's order. Drop ids that didn't resolve in both reads
  // (filtered out by is_searchable, or missing geometry) rather than emitting
  // a broken card.
  const places: BrowsePlace[] = [];
  for (const id of ids) {
    const base = baseById.get(id);
    const geo = geoById.get(id);
    if (!base || !geo) continue;
    // Suppress standalone amenities (dump_station, water, toilet, …): they are
    // infrastructure, not destinations, so they never render as their own card.
    if (isSuppressedCategory(base.primary_category)) continue;
    const row: MasterPlaceRow = {
      id: base.id,
      canonical_name: base.canonical_name,
      primary_category: base.primary_category,
      lng: geo.lng,
      lat: geo.lat,
      prominence_score: base.prominence_score,
      mvum_corridor: base.mvum_corridor,
      overlander_tags: base.overlander_tags,
      contact: base.contact,
      description: base.description,
      attribution: base.attribution,
      hours: base.hours,
      amenities: null,
      access: null,
      services: null,
      capacity: null,
      seasonality: null,
      cell_signal: null,
      geometry_polygon: null,
    };
    places.push(
      mapMasterPlaceRow(row, primaryCategoryToSlideKey(base.primary_category)),
    );
  }

  return places;
}
