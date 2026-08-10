-- ============================================================================
-- Artboard C: surface the corpus photo url on master_place_search_export.
--
-- Photos live on source_record.normalized_payload.photo and were joined at query
-- time only by pois_along_corridor's lateral (20260809130000). The search-sync
-- source (this view) and hydratePlacesByIds had no photo, so the same place
-- showed an image in corridor browse and none in search. This adds the SAME
-- photo lateral to the export view.
--
-- Mirrors the nps_photo_url lateral in 20260809130000 exactly: source_id in
-- ('nps','ridb'), NPS preferred (order by case), first non-null photo url,
-- LIMIT 1. No is_active filter, matching that lateral.
--
-- Predicates unchanged from 20260810180300: is_searchable, source_count > 0,
-- st_intersects(geometry, six_state_footprint()). ADDITIVE — LEFT JOIN so the
-- row count is unchanged; photo_url is null where no nps/ridb photo exists.
-- photo_url is appended last so CREATE OR REPLACE VIEW is legal.
--
-- The hardcoded source list ('nps','ridb') is carried forward from the pois
-- lateral, not eliminated — field_precedence could drive it but deliberately
-- does not (see the 20260809130000 header).
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
  photo.photo_url
from public.master_place mp
left join lateral (
  select sr.normalized_payload->'photo'->>'url' as photo_url
  from public.source_record sr
  where sr.master_place_id = mp.id
    and sr.source_id in ('nps', 'ridb')
    and sr.normalized_payload->'photo'->>'url' is not null
  -- Prefer NPS over RIDB when a master_place carries both.
  order by case sr.source_id when 'nps' then 0 when 'ridb' then 1 else 2 end
  limit 1
) photo on true
where mp.is_searchable
  and mp.source_count > 0
  and st_intersects(mp.geometry, public.six_state_footprint());

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles + photo_url (corpus photo from nps/ridb via LEFT JOIN LATERAL, NPS preferred). Filters: is_searchable, source_count > 0, st_intersects(geometry, six_state_footprint()).';
