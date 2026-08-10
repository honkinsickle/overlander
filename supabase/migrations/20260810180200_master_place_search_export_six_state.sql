-- ============================================================================
-- master_place_search_export: add six-state footprint filter + source_count > 0.
--
-- Part of the six-state PROD trim (2026-08-10). Two additive predicates on
-- the existing view:
--
--   1. mp.source_count > 0
--        — exclude master_places that have no active source_records. The
--          source_count column is set by recompute_master_place from the
--          count of active (is_active=true) linked source_records. After
--          the source_record trim (10 min ago), MPs whose sources were all
--          out-of-scope have 0 active sources but their source_count
--          column may still show a stale prior count until they are next
--          recomputed. The geometry filter (predicate 2) is the belt-and-
--          braces backstop: any MP whose geometry is outside the six-state
--          footprint is excluded regardless of source_count.
--
--   2. st_intersects(mp.geometry, public.six_state_scope())
--        — geometry-based filter using the six_state_scope() helper
--          function defined in 20260810180000. WA/OR/CA/AZ/NV/UT bboxes
--          with WA's northern edge stepped to 48.40°N west of -123°W to
--          exclude Vancouver Island. No state polygon shapefile in the
--          repo (searched: TIGER, PADUS).
--
-- Full view definition re-issued (create or replace view). Column list
-- unchanged from 20260602000000_phase1_padus_land_status_is_searchable.
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
  and st_intersects(mp.geometry, public.six_state_scope());

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles. Filters: is_searchable (Phase 1 land-status exclusion), source_count > 0 (drop MPs with no active source_records), st_intersects(geometry, six_state_scope()) (six-state footprint trim, 2026-08-10).';
