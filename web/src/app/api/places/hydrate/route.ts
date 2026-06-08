import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  mapMasterPlaceRow,
  primaryCategoryToSlideKey,
  type MasterPlaceRow,
} from "@/lib/trip-browse/federated";
import type { BrowsePlace } from "@/lib/trip-browse/places";

/**
 * POST /api/places/hydrate  { ids: string[] }  →  BrowsePlace[]
 *
 * Hydrates a list of master_place IDs (the thin output of the Typesense
 * matcher in `lib/search`) into full BrowsePlace cards, reusing the same
 * `mapMasterPlaceRow` projector the federated corridor path uses — but
 * WITHOUT the corridor spatial filter, because search is corpus-wide.
 *
 * Why service-role, not a SECURITY DEFINER RPC like pois_along_corridor:
 * master_place keeps RLS closed with no public-read policy. The corridor
 * RPC is the sanctioned anon door for the *corridor* read. A by-arbitrary-
 * id read is a different shape; rather than open a NEW permanent anon door
 * into the table (a prod schema + security-surface change), this server-
 * only route reads via the service-role key — the SAME pattern
 * data/search/sync-typesense.ts already uses to read master_place. The
 * route returns only the fields the card needs, which are the same fields
 * the public corridor RPC already exposes, so no new data is surfaced.
 *
 * Geometry: the base table's PostGIS `geometry` column can't be projected
 * through PostgREST (.select() can't call ST_X/ST_Y). The
 * `master_place_search_export` view already splits it into lng/lat doubles
 * — so lng/lat come from the view and the rest of the (plain/jsonb) card
 * fields come from the base table, merged by id.
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

function parseIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  if (!ids.every((x): x is string => typeof x === "string" && x.length > 0)) {
    return null;
  }
  // De-dupe while preserving the caller's (Typesense-ranked) order.
  return Array.from(new Set(ids)).slice(0, MAX_IDS);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = parseIds(body);
  if (ids === null) {
    return NextResponse.json(
      { error: "Body must be { ids: string[] }" },
      { status: 400 },
    );
  }
  if (ids.length === 0) {
    return NextResponse.json({ places: [] });
  }

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
    return NextResponse.json(
      { error: `master_place read failed: ${baseRes.error.message}` },
      { status: 502 },
    );
  }
  if (geoRes.error) {
    return NextResponse.json(
      { error: `search_export read failed: ${geoRes.error.message}` },
      { status: 502 },
    );
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

  // Project in the caller's order (Typesense relevance ranking). Drop ids
  // that didn't resolve in both reads (filtered out by is_searchable, or
  // missing geometry) rather than emitting a broken card.
  const places: BrowsePlace[] = [];
  for (const id of ids) {
    const base = baseById.get(id);
    const geo = geoById.get(id);
    if (!base || !geo) continue;
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
      // Real opening-hours (projector emits a HOURS stat when it's a string).
      hours: base.hours,
      // Card projector doesn't read these; hydrate doesn't fetch them.
      amenities: null,
      access: null,
      services: null,
      capacity: null,
      seasonality: null,
      cell_signal: null,
      geometry_polygon: null,
    };
    places.push(mapMasterPlaceRow(row, primaryCategoryToSlideKey(base.primary_category)));
  }

  return NextResponse.json({ places });
}
