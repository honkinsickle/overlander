-- ============================================================================
-- master_place_search_export: description_source must not report 'source' for
-- generated text.
--
-- Same one-line-of-intent change as 20260901000300 makes to
-- pois_along_corridor, applied to the Typesense sync source so the two agree.
-- Once generated descriptions are resolved onto master_place.description by
-- recompute_master_place(), the old CASE's first branch (`mp.description is
-- not null`) matches them and reports 'source' — claiming LLM/template text is
-- source-derived. Attribution is consulted first instead.
--
-- ADDITIVE to the projection: no column added or removed, no filter changed,
-- so row count and every other column are identical. Typesense needs a
-- re-sync to pick up the corrected description_source values.
--
-- TEST FIRST. PROD application is a separate, explicitly authorized step.
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
--   2. npm run -w data search:sync   (to land the corrected values)
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
    when mp.attribution->>'description' = 'generated_llm' then 'llm'
    when mp.attribution->>'description' = 'generated_template' then 'template'
    when mp.description is not null and mp.description <> '' then 'source'
    when desc_gc.has_llm then 'llm'
    when desc_gc.has_template then 'template'
    else null
  end as description_source,
  mp.operational_status
from public.master_place mp
left join lateral (
  select sr.normalized_payload->'photo'->>'url' as photo_url
  from public.source_record sr
  where sr.master_place_id = mp.id
    and sr.source_id in ('nps', 'ridb', 'wikipedia', 'atlas_oddities', 'family_destinations', 'editorial_food')
    and sr.normalized_payload->'photo'->>'url' is not null
  order by case sr.source_id
    when 'nps' then 0
    when 'ridb' then 1
    when 'wikipedia' then 2
    when 'atlas_oddities' then 3
    when 'family_destinations' then 4
    when 'editorial_food' then 5
    else 6
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
  and st_intersects(mp.geometry, public.six_state_footprint())
  and (mp.operational_status is null
       or mp.operational_status not in ('CLOSED', 'DECOMMISSIONED'));

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles + photo_url (corpus photo from nps/ridb/wikipedia/atlas_oddities/family_destinations/editorial_food via LEFT JOIN LATERAL, NPS preferred). Filters: is_searchable, source_count > 0, st_intersects(geometry, six_state_footprint()), operational_status not CLOSED/DECOMMISSIONED. description_source derived attribution-first (generated_llm/generated_template report llm/template rather than source), then mp.description, then master_place_generated_content.';

