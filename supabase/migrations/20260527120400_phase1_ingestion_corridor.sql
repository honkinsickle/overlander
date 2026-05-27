-- Phase 1: ingestion_corridor
-- A LineString geometry + buffer distance defining which area sources should be ingested for.
-- Spatial filter step in every source ingester reads from the active corridor's buffered polygon.

set search_path = public;

create table if not exists public.ingestion_corridor (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  geometry geometry(LineString, 4326) not null,
  buffer_meters integer not null default 80000,  -- ~50mi
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ingestion_corridor_geom_idx
  on public.ingestion_corridor using gist (geometry);

create index if not exists ingestion_corridor_active_idx
  on public.ingestion_corridor (active)
  where active = true;

alter table public.ingestion_corridor enable row level security;

-- Helper view: pre-buffered corridor geometry for spatial filters.
--
-- Returns one row per active corridor with:
--   - buffer_geom              — buffered polygon for ST_Contains / ST_Within checks
--                                 (used by point_in_active_corridor() below)
--   - geometry_geojson         — the original LineString as GeoJSON jsonb
--                                 (app code reads this directly; no WKB parsing)
--   - bbox_west / south / east / north — the buffered polygon's bbox extracted
--                                 server-side via ST_Envelope, so app code can
--                                 tile without recomputing buffers
create or replace view public.active_corridor_buffer as
with corridor as (
  select
    id,
    name,
    geometry,
    buffer_meters,
    st_buffer(geometry::geography, buffer_meters)::geometry as buffer_geom
  from public.ingestion_corridor
  where active = true
)
select
  id,
  name,
  buffer_meters,
  buffer_geom,
  st_asgeojson(geometry)::jsonb as geometry_geojson,
  st_xmin(st_envelope(buffer_geom)) as bbox_west,
  st_ymin(st_envelope(buffer_geom)) as bbox_south,
  st_xmax(st_envelope(buffer_geom)) as bbox_east,
  st_ymax(st_envelope(buffer_geom)) as bbox_north
from corridor;

-- Helper function: is a point inside any active corridor buffer?
-- Used as a defense-in-depth check after spatial filtering in app code.
create or replace function public.point_in_active_corridor(lng float, lat float)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.active_corridor_buffer
    where st_contains(buffer_geom, st_setsrid(st_makepoint(lng, lat), 4326))
  );
$$;
