-- ============================================================================
-- Phase 3a: candidate-finder RPC for matcher.ts
--
-- Returns master_places near a source_record, optionally filtered to a set
-- of primary_categories. PostgREST doesn't natively support ST_DWithin in
-- query filters, so the spatial join lives here.
--
-- Used by matcher.ts for:
--   - standard candidate retrieval (radius=200m, no filter)
--   - amenity rollup (radius=100m, filter=AMENITY_PARENT_CATEGORIES)
--   - federal exact-match (radius=10m, no filter; caller checks source diversity)
-- ============================================================================

set search_path = public;

create or replace function public.find_master_place_candidates(
  p_source_record_id uuid,
  p_radius_meters float default 200,
  p_category_filter text[] default null
)
returns table (
  id uuid,
  canonical_name text,
  primary_category text,
  distance_m float
)
language sql
stable
as $$
  select
    m.id,
    m.canonical_name,
    m.primary_category,
    st_distance(s.geometry::geography, m.geometry::geography) as distance_m
  from public.source_record s
  join public.master_place m
    on st_dwithin(s.geometry::geography, m.geometry::geography, p_radius_meters)
  where s.id = p_source_record_id
    and (p_category_filter is null or m.primary_category = any(p_category_filter))
  order by distance_m asc
  limit 10;
$$;
