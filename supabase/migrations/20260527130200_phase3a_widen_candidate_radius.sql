-- ============================================================================
-- Phase 3a: widen find_master_place_candidates default radius 200m → 500m
--
-- Diagnostic on the 5 JT campground fixtures showed cross-source pairs
-- drift up to 347m apart for NPS↔RIDB↔Google with identical names. The
-- previous 200m default excluded Jumbo Rocks RIDB↔NPS (341m), NPS↔Google
-- (347m), Sheep Pass RIDB↔Google (216m), and Sheep Pass RIDB↔NPS (248m)
-- from candidate retrieval entirely.
--
-- CREATE OR REPLACE only changes the default — function signature stays
-- the same so all existing callers (matcher.ts findCandidates) remain
-- compatible. Callers that pass explicit radius (amenity rollup at 100m,
-- fed_exact at 10m) are unaffected.
-- ============================================================================

set search_path = public;

create or replace function public.find_master_place_candidates(
  p_source_record_id uuid,
  p_radius_meters float default 500,
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
