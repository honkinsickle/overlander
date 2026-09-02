-- Add 'nevada_state_parks' to master_place_search_export's photo lateral.
--
-- Mirrors 20260902003100 (pois_along_corridor). Priority 9, after
-- oregon_state_parks at 8. Photo credit rendered as "Nevada State Parks";
-- license label is "Nevada State Parks" (no "government publication"
-- framing — see BACKLOG.md for the risk-acceptance note).
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
--   2. npm run -w data search:sync   (to land the photo_url values)

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
    and sr.source_id in ('nps', 'ridb', 'wikipedia', 'atlas_oddities', 'family_destinations', 'editorial_food', 'state_parks_web', 'state_parks_web_wa', 'oregon_state_parks', 'nevada_state_parks')
    and sr.normalized_payload->'photo'->>'url' is not null
  order by case sr.source_id
    when 'nps' then 0
    when 'ridb' then 1
    when 'wikipedia' then 2
    when 'atlas_oddities' then 3
    when 'family_destinations' then 4
    when 'editorial_food' then 5
    when 'state_parks_web' then 6
    when 'state_parks_web_wa' then 7
    when 'oregon_state_parks' then 8
    when 'nevada_state_parks' then 9
    else 10
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
  'Phase 2 Typesense sync source. photo_url from nps/ridb/wikipedia/atlas_oddities/family_destinations/editorial_food/state_parks_web/state_parks_web_wa/oregon_state_parks/nevada_state_parks via LEFT JOIN LATERAL, NPS preferred.';
