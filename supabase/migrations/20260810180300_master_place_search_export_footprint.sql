-- ============================================================================
-- master_place_search_export: repoint the geometry predicate from
-- six_state_scope() to the tighter six_state_footprint().
--
-- Identical to 20260810180200 EXCEPT the st_intersects() argument.
-- is_searchable and source_count > 0 are unchanged.
--
-- WHY. six_state_scope() (20260810180000) uses a coarse WA bbox whose eastern
-- edge sits at -116.90, admitting a strip of the Idaho panhandle (Priest Lake,
-- Pend Oreille, Moscow/Lewiston). Measured 2026-08-10: 9 view rows fell inside
-- six_state_scope() but outside six_state_footprint() — all in Idaho, all
-- ridb/nps, all live in places_prod search. six_state_footprint()
-- (20260810130000) draws WA's eastern edge at the true meridian -117.04 and
-- follows the real WA/BC (Haro Strait), CA/MX (1848 treaty) and AZ/MX (Gadsden)
-- borders, so it admits no Idaho, Canada, or Mexico. Repointing drops exactly
-- those 9 rows: expected 16,661 -> 16,652.
--
-- READ-ONLY DDL (create or replace view). Touches no data.
-- ============================================================================

set search_path = public;

create or replace view public.master_place_search_export as
select
  mp.id,
  mp.canonical_name,
  mp.alternative_names,
  mp.primary_category,
  mp.secondary_categories,
  mp.overlander_tags,
  mp.description,
  ST_X(mp.geometry)::double precision as lng,
  ST_Y(mp.geometry)::double precision as lat,
  mp.prominence_score,
  mp.source_count,
  mp.amenities,
  mp.updated_at
from public.master_place mp
where mp.is_searchable
  and mp.source_count > 0
  and st_intersects(mp.geometry, public.six_state_footprint());

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles. Filters: is_searchable (Phase 1 land-status exclusion), source_count > 0 (drop MPs with no active source_records), st_intersects(geometry, six_state_footprint()) (tight six-state footprint; supersedes six_state_scope() as of 20260810180300).';

-- six_state_scope() is SUPERSEDED for this view predicate but deliberately NOT
-- dropped: the 2026-08-10 source_record trim classified out-of-scope rows
-- against it (count_source_records_out_of_scope / list_out_of_scope_source_record_ids
-- still reference it), so it must remain for that run to stay reproducible.
comment on function public.six_state_scope() is
  'SUPERSEDED 2026-08-10 by six_state_footprint() (20260810130000) for the master_place_search_export view predicate (see 20260810180300). RETAINED, not dropped, for reproducibility of the 2026-08-10 six-state source_record trim, which classified out-of-scope rows against this (coarser) function. Do not use for new predicates: six_state_footprint() is tighter (true WA meridian + WA/BC, CA/MX, AZ/MX borders).';
