-- ============================================================================
-- Widen pois_along_corridor's nps_photo_url LEFT JOIN LATERAL to accept BOTH
-- 'nps' AND 'ridb' source_records. The alias `nps_photo_url` in the RETURNS
-- TABLE is retained (renaming it would ripple through every consumer + all
-- baked corridors); the *field* now represents "corpus photo url from any
-- image-family source", with 'nps' preferred by ORDER BY and 'ridb' filling
-- in when NPS has no image for the master_place.
--
-- Route A for RIDB: the ridb ingester now fetches /facilities/{id}/media and
-- /recareas/{id}/media at ingest time and promotes the primary Image entry to
-- `source_record.normalized_payload.photo = { url, altText, credit }`, mirroring
-- the NPS shape. This lateral is what surfaces those photos on the card.
--
-- Preference: 'nps' first, then 'ridb'. Achieved via `ORDER BY case ... end`
-- + `LIMIT 1`. If both sources supply a photo for the same master_place, NPS
-- wins — it is the higher-authority image source (NPS credits are usually
-- public-domain; RIDB media is a mix of USDA / concessionaire / permitted-
-- user content). Field_precedence is unaffected — this is a read-side hydrate
-- key, not a resolve-time contribution to master_place fields.
--
-- Discussion of "why not parameterize as a source_ids text[] RPC arg":
-- the two laterals now serve distinct semantic roles — google_place_id for
-- hydrate keys, nps_photo_url for corpus imagery. Making membership a caller
-- argument re-couples callers to a distinction pois_along_corridor was built
-- to hide (one door into master_place). A source_photo_priority table would
-- similarly add a join per row for gains that materialize once every 6+ months.
-- Widening the string list in-place stays the minimum-cost fix. If a fourth
-- image-family source appears we should promote both laterals into a single
-- `master_place_hydration_index` view instead of parameterizing further.
--
-- ADDITIVE + null-safe: the first lateral (google_place_id) and the RETURNS
-- TABLE shape are unchanged from 20260809120000. This migration only edits
-- the second lateral.
--
-- A body change on a plpgsql function still requires DROP + CREATE (CREATE
-- OR REPLACE cannot change the return type; the returns-table shape is stable
-- here but keeping the drop makes body edits mechanically identical to shape
-- edits). Argument signature is unchanged: (jsonb, integer, text[]).
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
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. google_place_id sources from ''google'' or ''google_resolved''. nps_photo_url sources from ''nps'' or ''ridb'' (NPS preferred). SECURITY DEFINER — the only consumer door into master_place; RLS stays closed.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
