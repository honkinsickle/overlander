-- ============================================================================
-- pois_along_corridor: keep ADR 2026-08-21 §2 working once generated
-- descriptions live on master_place.description, and stop description_source
-- reporting 'source' for generated text.
--
-- Two edits, nothing else. Same DROP + CREATE shape as every prior
-- pois_along_corridor migration; argument signature and RETURNS TABLE are
-- UNCHANGED.
--
-- 1. TEMPLATE EXCLUSION. The existing predicate is
--        not (mp.description is null and has_template)
--    which encodes "exclude rows whose ONLY description is a template" by
--    testing that the column is empty. That test is correct only while nothing
--    populates the column. PR #327 populated it directly and the exclusion
--    silently stopped firing (measured: a template row went from not-returned
--    to returned). Routing template text through source_record populates it
--    too, so the same predicate would break the same way. Fixed by ALSO
--    excluding on attribution.description = 'generated_template', which is
--    true exactly when recompute_master_place() resolved the description from
--    the template generator. Both predicates are kept so rows that have not
--    been rerouted are still covered.
--
-- 2. description_source. The CASE tested mp.description first, so once a
--    generated description landed in the column it reported 'source' — i.e. it
--    claimed LLM text was source-derived. Attribution is now consulted first,
--    so generated rows report 'llm'/'template' truthfully. The old branches
--    are kept beneath as the fallback for rows not yet rerouted.
--
-- TEST FIRST. PROD application is a separate, explicitly authorized step.
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'
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
  description_source text,
  operational_status text
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
      when mp.attribution->>'description' = 'generated_llm' then 'llm'
      when mp.attribution->>'description' = 'generated_template' then 'template'
      when mp.description is not null and mp.description <> '' then 'source'
      when coalesce(desc_gc.has_llm, false) then 'llm'
      when coalesce(desc_gc.has_template, false) then 'template'
      else null
    end as description_source,
    mp.operational_status
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
    -- ADR 2026-08-21 §2, re-expressed. The line above keys the template
    -- exclusion on `mp.description is null`, which silently STOPS EXCLUDING the
    -- moment anything populates the column — exactly what routing template text
    -- through source_record does. Both lines are kept: the original still
    -- covers rows not yet rerouted, this one covers rows that have been.
    and coalesce(mp.attribution->>'description', '') <> 'generated_template'
    and coalesce(desc_gc.any_flagged, false) = false
    and (p_categories is null or mp.primary_category = any(p_categories))
    and (mp.operational_status is null
         or mp.operational_status not in ('CLOSED', 'DECOMMISSIONED'))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status, source_count > 0, non-closed master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. Excludes template-sourced descriptions (both the legacy mp.description-is-null form and attribution.description = generated_template), needs_review rows, and operational_status CLOSED/DECOMMISSIONED. description_source derived same as master_place_search_export, attribution-first so generated text reports llm/template rather than source. google_place_id from google/google_resolved. nps_photo_url from nps/ridb/wikipedia/atlas_oddities/family_destinations/editorial_food (NPS preferred). photo_credit from the winning photo source. operational_status from the structured source field (NULL = open or unknown). SECURITY DEFINER.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;

