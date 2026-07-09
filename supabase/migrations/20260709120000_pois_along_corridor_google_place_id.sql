-- ============================================================================
-- Add google_place_id to pois_along_corridor() — for corridor-tile
-- hydrate-by-place_id (rich Google ratings/photos fetched live at day-select).
--
-- ADDITIVE + null-safe: existing consumers (browse + search via
-- mapMasterPlaceRow) read fields by name off a manual cast and ignore the
-- extra key — they cannot break on a new column.
--
-- The place_id already exists as `source_record.external_id` ('google:<id>')
-- for google-sourced records, linked via `source_record.master_place_id`.
-- Surfaced here via a LEFT JOIN LATERAL; NULL when the master_place has no
-- google source (OSM/RIDB-only) → that tile stays essentials, no hydrate.
-- place_id is a public, cache-exempt Google identifier — no sensitive data
-- is surfaced through the anon door.
--
-- A RETURNS TABLE change requires DROP + CREATE (CREATE OR REPLACE cannot
-- change a function's return type) and a re-GRANT. Argument signature is
-- unchanged, so the drop targets (jsonb, integer, text[]).
--
-- APPLY-PATH (additive RPC, no master_place write):
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'
-- ============================================================================

set search_path = public;

drop function if exists public.pois_along_corridor(jsonb, integer, text[]);

create function public.pois_along_corridor(
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
  attribution       jsonb,
  google_place_id   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_route geometry;
begin
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
    st_asgeojson(mp.geometry_polygon)::jsonb as geometry_polygon,
    mp.description,
    mp.attribution,
    -- Google place_id for hydrate-by-place_id (strip the 'google:' external_id
    -- prefix). NULL when this master_place has no google source_record.
    regexp_replace(g.external_id, '^google:', '') as google_place_id
  from public.master_place mp
  left join lateral (
    select sr.external_id
    from public.source_record sr
    where sr.master_place_id = mp.id
      and sr.source_id = 'google'
    limit 1
  ) g on true
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read + google_place_id for tile hydrate. Returns searchable, non-land_status master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. google_place_id is the linked google source_record external_id (place_id), NULL when absent. SECURITY DEFINER — the only consumer door into master_place; RLS stays closed.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
