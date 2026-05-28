-- Phase 2: master_place search export view.
--
-- Exposes the columns the Typesense sync script needs, with the PostGIS
-- geometry split into lng/lat doubles via ST_X/ST_Y. PostgREST cannot call
-- ST_X/ST_Y inside a .select() clause, so we project them through a view.
--
-- Read-only projection of master_place. The underlying table has RLS
-- enabled with no policies, so anon/authenticated clients see zero rows;
-- the service-role key (used by data/search/sync-typesense.ts) bypasses
-- RLS and sees the full set.

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
from public.master_place mp;

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles.';
