-- ============================================================================
-- Add operational_status to master_place_search_export and exclude
-- CLOSED/DECOMMISSIONED rows from the index.
--
-- Per decision #3: closed/decommissioned rows are excluded entirely from
-- the Typesense index (not just filtered at display time).
--
-- CREATE OR REPLACE VIEW — column list gains operational_status.
--
-- TEST FIRST, then PROD after validation.
--
-- APPLY-PATH:
--   1. echo y | npm run -w data db:push-verify -- --test
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
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles + photo_url (corpus photo from nps/ridb/wikipedia/atlas_oddities/family_destinations/editorial_food via LEFT JOIN LATERAL, NPS preferred). Filters: is_searchable, source_count > 0, st_intersects(geometry, six_state_footprint()), operational_status not CLOSED/DECOMMISSIONED. description_source derived from mp.description + master_place_generated_content precedence.';
