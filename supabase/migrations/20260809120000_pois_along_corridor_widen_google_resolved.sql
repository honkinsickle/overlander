-- ============================================================================
-- Widen pois_along_corridor's google_place_id LEFT JOIN LATERAL to accept
-- BOTH 'google' AND 'google_resolved' source_records.
--
-- Bug: enqueueResolvedPlaces (web/src/lib/itinerary/ingest.ts:31) writes tier-2
-- live-resolved places with source_id = 'google_resolved' — a deliberately
-- distinct string so the thin resolve payload has its own low-priority
-- field_precedence entry (migration 20260723120000) and loses to every
-- pipeline source it co-links with. That distinctness is load-bearing on the
-- write side and MUST NOT be renamed away.
--
-- But the read side hard-coded sr.source_id = 'google' (migrations
-- 20260709120000 → 20260805120000), so every 'google_resolved' row is
-- invisible to the RPC and its master_place tile carries
-- google_place_id = NULL back to the card — the /api/places/details hydrate
-- key never fires on resolved-only tiles.
--
-- Fix: widen the lateral's predicate to IN ('google','google_resolved').
-- The external_id shape is identical for both — 'google:<place_id>' — so
-- the regexp_replace stays unchanged. The lateral is `limit 1`, so if a
-- master_place is co-linked to both, either row's place_id is a valid
-- hydrate key (they point at the same Google Place). Field_precedence for
-- google_resolved stays untouched — this migration only affects the
-- hydrate-key surface on the RPC, not the resolved-row's contribution
-- to master_place field values.
--
-- ADDITIVE + null-safe: the second lateral (nps_photo_url) and the RETURNS
-- TABLE shape are unchanged from 20260805120000. This migration exists only
-- to shift ONE `and sr.source_id = ...` clause.
--
-- A RETURNS TABLE / body change on a plpgsql function still requires the
-- DROP + CREATE dance (CREATE OR REPLACE cannot change the return type;
-- keeping the drop makes body edits mechanically identical to schema edits).
-- Argument signature is unchanged, so the drop targets (jsonb, integer, text[]).
--
-- APPLY-PATH (additive RPC, no master_place write):
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
    -- (tier-2 live-resolve write-back) — both carry the same external_id shape
    -- 'google:<place_id>', so either row's id is a valid hydrate key. NULL when
    -- this master_place has neither.
    regexp_replace(g.external_id, '^google:', '') as google_place_id,
    -- NPS-native photo url (Route A). NULL when no nps source carries a photo.
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
      and sr.source_id = 'nps'
      and sr.normalized_payload->'photo'->>'url' is not null
    limit 1
  ) n on true
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. google_place_id is the linked google/google_resolved source_record external_id (place_id), NULL when absent. nps_photo_url is the linked nps source_record normalized_payload.photo.url (Route A corpus imagery), NULL when absent. SECURITY DEFINER — the only consumer door into master_place; RLS stays closed.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
