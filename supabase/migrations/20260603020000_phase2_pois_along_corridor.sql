-- ============================================================================
-- Phase 2 — consumer corridor read: pois_along_corridor()
--
-- The FIRST consumer-facing read over master_place. Trip-browse will call this
-- to populate real POIs along a trip's route corridor, replacing the live
-- external-API fanout for the federated path.
--
-- Design (decided 2026-06-03):
--   * SECURITY DEFINER RPC, NOT a view. master_place keeps RLS enabled with no
--     public-read policy — anon/authenticated clients still see zero rows
--     directly. This function is the ONLY door: it bypasses RLS as the owner
--     and returns ONLY corridor-filtered, searchable, non-land_status rows.
--     No blanket public-read surface is opened.
--   * Parameterized spatial query: caller passes a route LineString + buffer,
--     gets back the master_places within the buffer. Distinct from the
--     ingestion-corridor objects (active_corridor_buffer / point_in_active_
--     corridor), which are bound to the single active ingestion corridor and
--     return a boolean/bbox — not reusable for an arbitrary trip's route.
--
-- ── CRITICAL: ::geography casts in ST_DWithin are load-bearing. ──
-- On raw SRID-4326 geometry, ST_DWithin(a, b, 16000) reads 16000 as DEGREES,
-- not meters, and returns essentially everything. Cast both args to
-- ::geography so the buffer threshold is METERS. (Same units trap documented
-- in 20260603010000_phase2_mvum_corridor.sql.)
--
-- This is a NEW, additive function. It does NOT touch recompute_master_place
-- (no recompute change → no SOLE-writer apply-path runbook required here) and
-- does NOT touch the ingestion-corridor objects.
--
-- APPLY-PATH (additive RPC, no master_place write):
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'   (so PostgREST surfaces the new RPC)
-- ============================================================================

set search_path = public;

-- geometry_polygon and the route input are exchanged as GeoJSON jsonb, matching
-- the codebase convention (active_corridor_buffer.geometry_geojson,
-- master_place_search_export's ST_X/ST_Y split): PostgREST can't call PostGIS
-- accessors in a .select()/.rpc() projection, so all geometry crosses the
-- boundary server-side-converted. Raw geometry would serialize as WKB hex and
-- break the [lng,lat] GeoJSON contract the web client expects.
create or replace function public.pois_along_corridor(
  p_route jsonb,
  p_buffer_m integer default 16000,
  p_categories text[] default null
)
returns table (
  id                uuid,
  canonical_name    text,
  primary_category  text,
  lng               double precision,
  lat               double precision,
  prominence_score  float,
  mvum_corridor     boolean,
  overlander_tags   text[],
  amenities         jsonb,
  hours             jsonb,
  contact           jsonb,
  access            jsonb,
  services          jsonb,
  capacity          jsonb,
  seasonality       jsonb,
  cell_signal       jsonb,
  geometry_polygon  jsonb,
  description       text,
  attribution       jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_route geometry;
begin
  -- Stamp SRID 4326 explicitly: ST_GeomFromGeoJSON honors a crs member if
  -- present but defaults to 0 otherwise. Matches upsert_mvum_road's idiom.
  v_route := st_setsrid(st_geomfromgeojson(p_route::text), 4326);

  return query
  select
    mp.id,
    mp.canonical_name,
    mp.primary_category,
    ST_X(mp.geometry)::double precision as lng,
    ST_Y(mp.geometry)::double precision as lat,
    mp.prominence_score,
    mp.mvum_corridor,
    mp.overlander_tags,
    mp.amenities,
    mp.hours,
    mp.contact,
    mp.access,
    mp.services,
    mp.capacity,
    mp.seasonality,
    mp.cell_signal,
    -- GeoJSON jsonb, null when the place has no polygon footprint.
    st_asgeojson(mp.geometry_polygon)::jsonb as geometry_polygon,
    mp.description,
    -- Per-field provenance. Non-negotiable: the schema invariant says no field
    -- displays without its attribution available.
    mp.attribution
  from public.master_place mp
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    -- land_status rows are containment context, not selectable POIs; they also
    -- carry is_searchable = false, but exclude by category too for clarity.
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. SECURITY DEFINER — the only consumer door into master_place; RLS stays closed.';

-- The RPC is the sanctioned read path; the underlying table stays RLS-locked.
grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
