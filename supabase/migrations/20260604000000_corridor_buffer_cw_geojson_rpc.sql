-- Corridor-buffer-clipping support — server-side CW GeoJSON of the active
-- corridor buffer, for the ESRI loaders' spatial filter.
--
-- The ESRI loaders (padus / usfs / mvum) default to clipping by the active
-- corridor BUFFER POLYGON instead of the bbox envelope (the rectangle pulled
-- ~2-4x too many features). Two integration gotchas this RPC solves:
--   1. Getting raw PostGIS geometry through PostgREST as usable coordinates is
--      awkward; returning ST_AsGeoJSON(...) text gives the JS client
--      ready-to-parse rings.
--   2. ESRI treats a COUNTER-clockwise exterior ring as a HOLE and returns ~0
--      features. ST_ForcePolygonCW orients the exterior ring clockwise (and any
--      interior rings counter-clockwise) — exactly ESRI's convention.
--
-- Read-only: a STABLE function that only SELECTs the active corridor buffer.
-- Returns NULL when no corridor is active (callers then require an explicit
-- --bbox). No writes, no DDL beyond the function itself.

set search_path = public;

create or replace function public.active_corridor_buffer_cw_geojson()
returns text
language sql
stable
as $$
  select st_asgeojson(st_forcepolygoncw(buffer_geom))
  from public.active_corridor_buffer
  limit 1;
$$;

comment on function public.active_corridor_buffer_cw_geojson is
  'Returns the active corridor buffer polygon as GeoJSON (text) with a '
  'CLOCKWISE exterior ring (ST_ForcePolygonCW), ready for use as an ESRI '
  'esriGeometryPolygon spatial filter. NULL when no corridor is active. '
  'Read-only; used by the data-workspace ESRI loaders for corridor clipping.';
