-- RPC: utah_state_parks_gis_index
--
-- Returns every existing `state_parks:UT:park:*` source_record with its
-- geometry serialized as EWKT (SRID + POINT), for the
-- `utah_state_parks` ingester's name-based lookup.
--
-- Why: stateparks.utah.gov does NOT expose lat/lon on park pages
-- (0/46 rows have coordinates), and `source_record.geometry` is
-- NOT NULL. The ingester borrows geometry from the matching GIS park
-- boundary record at ingest time, keyed by normalized name.
--
-- Service-role only — the ingester runs under the service key.
-- No grant to anon/authenticated.

set search_path = public;

create or replace function public.utah_state_parks_gis_index()
returns table (
  external_id      text,
  name             text,
  geometry_ewkt    text,
  master_place_id  uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sr.external_id,
    sr.name,
    st_asewkt(sr.geometry) as geometry_ewkt,
    sr.master_place_id
  from public.source_record sr
  where sr.source_id = 'state_parks'
    and sr.external_id like 'state_parks:UT:park:%'
$$;

comment on function public.utah_state_parks_gis_index() is
  'Lookup for utah_state_parks ingester: returns state_parks:UT:park:* records with EWKT geometry so visitor-content rows can borrow coords (UT scrape has no lat/lon).';
