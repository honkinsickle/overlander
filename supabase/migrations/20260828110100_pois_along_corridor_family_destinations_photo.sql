-- ============================================================================
-- Add 'family_destinations' to pois_along_corridor's photo lateral.
--
-- Mirrors the 2026-08-27 atlas_oddities extension (20260827180100, PR #314)
-- exactly. Chain becomes:
--   nps > ridb > wikipedia > atlas_oddities > family_destinations.
--
-- Column name `nps_photo_url` is preserved for backward compatibility with
-- mapMasterPlaceRow in federated.ts. family_destinations photos live at
-- normalized_payload.photo.url (same shape as nps/ridb/wikipedia/atlas_oddities),
-- so no new coalesce path is needed.
--
-- Same-shape body edit as every prior pois_along_corridor migration.
-- DROP + CREATE; argument signature (jsonb, integer, text[]) unchanged.
-- RETURNS TABLE unchanged.
--
-- TEST ONLY.
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
-- ============================================================================

set search_path = public;

drop function if exists public.pois_along_corridor(jsonb, integer, text[]);

create function public.pois_along_corridor(
  p_route jsonb,
  p_buffer_m integer default 16000,
  p_categories text[] default null
)
returns table (
  id                uuid,
  canonical_name    text,
  primary_category  text,
  lng               double precision,
  lat               double precision,
  prominence_score  float,
  mvum_corridor     boolean,
  overlander_tags   text[],
  amenities         jsonb,
  hours             jsonb,
  contact           jsonb,
  access            jsonb,
  services          jsonb,
  capacity          jsonb,
  seasonality       jsonb,
  cell_signal       jsonb,
  geometry_polygon  jsonb,
  description       text,
  attribution       jsonb,
  google_place_id   text,
  nps_photo_url     text,
  photo_credit      text,
  description_source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_route geometry;
begin
  v_route := st_setsrid(st_geomfromgeojson(p_route::text), 4326);

  return query
  select
    mp.id,
    mp.canonical_name,
    mp.primary_category,
    ST_X(mp.geometry)::double precision as lng,
    ST_Y(mp.geometry)::double precision as lat,
    mp.prominence_score,
    mp.mvum_corridor,
    mp.overlander_tags,
    mp.amenities,
    mp.hours,
    mp.contact,
    mp.access,
    mp.services,
    mp.capacity,
    mp.seasonality,
    mp.cell_signal,
    st_asgeojson(mp.geometry_polygon)::jsonb as geometry_polygon,
    mp.description,
    mp.attribution,
    regexp_replace(g.external_id, '^google:', '') as google_place_id,
    n.photo_url as nps_photo_url,
    n.photo_credit as photo_credit,
    case
      when mp.description is not null and mp.description <> '' then 'source'
      when coalesce(desc_gc.has_llm, false) then 'llm'
      when coalesce(desc_gc.has_template, false) then 'template'
      else null
    end as description_source
  from public.master_place mp
  left join lateral (
    select sr.external_id
    from public.source_record sr
    where sr.master_place_id = mp.id
      and sr.source_id in ('google', 'google_resolved')
    limit 1
  ) g on true
  left join lateral (
    select
      sr.normalized_payload->'photo'->>'url' as photo_url,
      sr.normalized_payload->'photo'->>'credit' as photo_credit
    from public.source_record sr
    where sr.master_place_id = mp.id
      and sr.source_id in ('nps', 'ridb', 'wikipedia', 'atlas_oddities', 'family_destinations')
      and sr.normalized_payload->'photo'->>'url' is not null
    order by case sr.source_id
                when 'nps' then 0
                when 'ridb' then 1
                when 'wikipedia' then 2
                when 'atlas_oddities' then 3
                when 'family_destinations' then 4
                else 5
             end
    limit 1
  ) n on true
  left join lateral (
    select
      bool_or(gc.needs_review) as any_flagged,
      bool_or(gc.generation_method = 'template') as has_template,
      bool_or(gc.generation_method = 'llm') as has_llm
    from public.master_place_generated_content gc
    where gc.master_place_id = mp.id
      and gc.field_name = 'description'
  ) desc_gc on true
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    and mp.source_count > 0
    and not (mp.description is null and coalesce(desc_gc.has_template, false))
    and coalesce(desc_gc.any_flagged, false) = false
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status, source_count > 0 master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. Excludes template-only descriptions and needs_review rows. description_source derived same as master_place_search_export. google_place_id from google/google_resolved. nps_photo_url from nps/ridb/wikipedia/atlas_oddities/family_destinations (NPS preferred). photo_credit from the winning photo source. SECURITY DEFINER.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
