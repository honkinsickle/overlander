-- ============================================================================
-- Extend master_place_search_export's photo_url lateral to include
-- wikipedia and atlas_oddities.
--
-- Motivation. `pois_along_corridor`'s photo lateral has already been
-- extended twice — first to include wikipedia (20260826160000, PR #299)
-- and then atlas_oddities (20260827180100, PR #314). But the
-- corresponding lateral on `master_place_search_export` (the source
-- the Typesense sync reads, and the source `hydratePlacesByIds` reads
-- for the /search hit-hydration path) was left on the original
-- `('nps', 'ridb')` filter from 20260810180400.
--
-- Effect of the gap: on TEST and PROD, /search-driven cards for
-- wikipedia-photoed or atlas_oddities-photoed master_places rendered
-- with no photo, even though the corridor-browse tiles for the same
-- master_place did render one. Post-PR #314 (atlas_oddities live on
-- PROD), this became a visible product-shape gap on ~2,806 AO POIs.
--
-- Fix. Extend the source list to
-- ('nps', 'ridb', 'wikipedia', 'atlas_oddities') and align the
-- precedence-order case with the corridor RPC:
--   nps 0 > ridb 1 > wikipedia 2 > atlas_oddities 3
-- No other lateral or predicate changes; the description_source
-- lateral from 20260821040000 is preserved verbatim.
--
-- CREATE OR REPLACE VIEW is legal because column list and column
-- order are unchanged.
--
-- ADDITIVE for the doc pipeline. After this lands, `search:sync` must
-- run to re-import the corpus so the `photo_url` field of each doc
-- reflects the newly-widened lateral. That sync is the mechanism
-- (documented in the sync script header, applied for wikipedia
-- previously per the 20260826160000 header pattern).
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
  mp.updated_at,
  photo.photo_url,
  case
    when mp.description is not null and mp.description <> '' then 'source'
    when desc_gc.has_llm then 'llm'
    when desc_gc.has_template then 'template'
    else null
  end as description_source
from public.master_place mp
left join lateral (
  select sr.normalized_payload->'photo'->>'url' as photo_url
  from public.source_record sr
  where sr.master_place_id = mp.id
    and sr.source_id in ('nps', 'ridb', 'wikipedia', 'atlas_oddities')
    and sr.normalized_payload->'photo'->>'url' is not null
  order by case sr.source_id
    when 'nps' then 0
    when 'ridb' then 1
    when 'wikipedia' then 2
    when 'atlas_oddities' then 3
    else 4
  end
  limit 1
) photo on true
left join lateral (
  select
    bool_or(gc.generation_method = 'llm') as has_llm,
    bool_or(gc.generation_method = 'template') as has_template
  from public.master_place_generated_content gc
  where gc.master_place_id = mp.id
    and gc.field_name = 'description'
) desc_gc on true
where mp.is_searchable
  and mp.source_count > 0
  and st_intersects(mp.geometry, public.six_state_footprint());

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles + photo_url (corpus photo from nps/ridb/wikipedia/atlas_oddities via LEFT JOIN LATERAL, NPS preferred). Filters: is_searchable, source_count > 0, st_intersects(geometry, six_state_footprint()). description_source derived from mp.description + master_place_generated_content precedence.';
