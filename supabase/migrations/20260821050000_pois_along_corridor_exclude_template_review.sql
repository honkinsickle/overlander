-- ============================================================================
-- Exclude template-only descriptions and flagged rows from trip-stop
-- candidacy in pois_along_corridor.
--
-- Combined eligibility + provenance + review pass, 2026-08-21. Decision:
-- template descriptions count as eligible/resolved for description
-- purposes (this session's eligibility.ts change folds
-- has_template_description into isStrong), but template content is
-- meaningfully thinner than real source-derived content, so it should NOT
-- be offered as a trip stop by default. Separately, any row a spot-check
-- has flagged (needs_review = true) shouldn't be offered until resolved,
-- regardless of its description_source.
--
-- Exclusion condition mirrors master_place_search_export's
-- description_source precedence exactly (20260821040000): a row only
-- counts as "template-only" when mp.description IS NULL/empty AND a
-- template row exists. A row with a real mp.description that ALSO happens
-- to carry a template row (the "dual" rows found in the prior pass —
-- docs/measurements/2026-08-21-three-part-cleanup.md Part 2, e.g. WEAK-
-- bucket rows with a thin-but-present real description plus a template
-- backup) is NOT excluded — its effective description_source is 'source',
-- not 'template', and it is not offered any differently than before this
-- migration. needs_review is checked independently and unconditionally
-- (excludes regardless of description_source, per the ask).
--
-- Same-shape body edit as every prior pois_along_corridor migration (6
-- prior revisions) — DROP + CREATE. RETURNS TABLE shape and argument
-- signature (jsonb, integer, text[]) are unchanged — this migration only
-- adds a lateral join and a WHERE predicate.
--
-- TEST ONLY (znldzjdatkogdktymtvi). PROD application is a separate,
-- explicitly authorized step.
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
  nps_photo_url     text
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
    -- Google place_id for hydrate-by-place_id (strip the 'google:' external_id
    -- prefix). Accepts BOTH 'google' (rich corridor sweep) and 'google_resolved'
    -- (tier-2 live-resolve write-back).
    regexp_replace(g.external_id, '^google:', '') as google_place_id,
    -- Corpus-native photo url (Route A). Accepts BOTH 'nps' and 'ridb', with
    -- NPS preferred when both are present. Column alias retained for backward
    -- compat with existing baked payloads and card consumers.
    n.photo_url as nps_photo_url
  from public.master_place mp
  left join lateral (
    select sr.external_id
    from public.source_record sr
    where sr.master_place_id = mp.id
      and sr.source_id in ('google', 'google_resolved')
    limit 1
  ) g on true
  left join lateral (
    select sr.normalized_payload->'photo'->>'url' as photo_url
    from public.source_record sr
    where sr.master_place_id = mp.id
      and sr.source_id in ('nps', 'ridb')
      and sr.normalized_payload->'photo'->>'url' is not null
    -- Prefer NPS over RIDB when a master_place carries both (see header).
    order by case sr.source_id when 'nps' then 0 when 'ridb' then 1 else 2 end
    limit 1
  ) n on true
  left join lateral (
    select
      bool_or(gc.needs_review) as any_flagged,
      bool_or(gc.generation_method = 'template') as has_template
    from public.master_place_generated_content gc
    where gc.master_place_id = mp.id
      and gc.field_name = 'description'
  ) desc_gc on true
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    -- Closes the generation-exposure gap (20260818160000): a place
    -- deactivated via source_record.is_active = false (fire_pit/peak/spring
    -- pattern) drops to source_count = 0 on recompute but stays
    -- is_searchable = true — exclude it here the same way
    -- master_place_search_export already does, so generation and
    -- browse/search agree.
    and mp.source_count > 0
    -- Template-only descriptions are eligible/resolved (see
    -- lib/eligibility.ts's has_template_description) but meaningfully
    -- thinner than real source content — excluded from trip-stop
    -- candidacy by default. Only when NO real description exists (matches
    -- description_source='template' on master_place_search_export exactly,
    -- 20260821040000) — a row with a real description plus an unused
    -- template backup is unaffected.
    and not (mp.description is null and coalesce(desc_gc.has_template, false))
    -- Any generated_content row flagged for review (any field_name, any
    -- description_source) excludes the place from candidacy until
    -- resolved.
    and coalesce(desc_gc.any_flagged, false) = false
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status, source_count > 0 master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. Excludes template-only descriptions (no real mp.description, only a master_place_generated_content template row) and any place with a needs_review=true generated_content row. google_place_id sources from ''google'' or ''google_resolved''. nps_photo_url sources from ''nps'' or ''ridb'' (NPS preferred). SECURITY DEFINER — the only consumer door into master_place; RLS stays closed.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
