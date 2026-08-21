-- ============================================================================
-- Close the generation-exposure gap: add `mp.source_count > 0` to
-- pois_along_corridor's WHERE clause, alongside the existing
-- `is_searchable = true` and `primary_category <> 'land_status'` checks.
--
-- Found in commit 609fcec (peak/spring deactivation) and scoped in the
-- follow-up investigation: pois_along_corridor has NEVER checked
-- source_count, in any of its 5 prior revisions. A place deactivated via
-- the fire_pit/peak/spring pattern (source_record.is_active = false on
-- every linked source → recompute_master_place() drops source_count to 0,
-- but the master_place row and is_searchable stay untouched — this is the
-- established, intentional "not deleted" shape, not a bug in the
-- deactivation itself) is correctly hidden from browse/Typesense via
-- master_place_search_export's `source_count > 0` filter
-- (20260810180200_master_place_search_export_six_state.sql), but
-- pois_along_corridor reads geometry straight off master_place.geometry
-- (bypassing that view entirely) and never applies the equivalent check —
-- so a zeroed-out place is still offered as a trip stop during generation.
--
-- Option (a) (this migration) over option (b) (set is_searchable = false
-- as part of the deactivation pattern instead): recompute_master_place()'s
-- Step 6 sets `is_searchable = (primary_category is distinct from
-- 'land_status')` UNCONDITIONALLY on every single call — confirmed against
-- the LIVE function via pg_get_functiondef before writing this migration
-- (not just the migration file — this codebase has documented history of
-- those diverging), word-for-word identical to
-- 20260603010000_phase2_mvum_corridor.sql. Any manually-backfilled
-- is_searchable = false on a non-land_status row would be silently reset to
-- true the next time recompute_master_place() runs on that row for ANY
-- unrelated reason (an ER re-match, a field_precedence change, an amenities
-- backfill touching a co-linked source — recompute runs constantly).
-- source_count has no such durability problem: it is freshly recalculated
-- from source_record.is_active on every recompute call, so it can never go
-- stale, and no backfill is needed — every currently-deactivated row
-- already has source_count = 0 as a side effect of the deactivation
-- pattern that already exists.
--
-- Safety check performed before writing this migration (queried TEST
-- directly): master_place rows with source_count = 0 today are ALL
-- peak/spring (64,305 of them, from 609fcec) and is_searchable = true on
-- every one — zero rows exist with source_count = 0 for any other reason.
-- Architecturally, apply_match_outcomes's new_master_place path INSERTs the
-- master_place and links its triggering source_record in the same
-- transaction, before recompute_master_place is ever called on that id —
-- so a legitimately-new, not-yet-resolved place cannot observably have
-- source_count = 0. The only way to reach source_count = 0 today is the
-- deliberate is_active = false deactivation path.
--
-- Traced every other consumer of is_searchable / source_count (web/src,
-- every SQL migration) — this is the ONLY gap. master_place_search_export
-- already checks source_count > 0; hydrate.ts's base query doesn't check it
-- directly but is indirectly protected via its geometry join to that same
-- view; web/src/lib/search.ts's source_count is a display-only pass-through
-- from the Typesense document, never a filter. No other surface needs a
-- change.
--
-- Same-shape body edit as every prior pois_along_corridor migration
-- (5 prior revisions) — DROP + CREATE (a body change on a plpgsql function
-- still requires this; CREATE OR REPLACE cannot change the return type, and
-- keeping the drop makes body edits mechanically identical to shape edits).
-- RETURNS TABLE shape and argument signature (jsonb, integer, text[]) are
-- unchanged — this migration only edits the WHERE clause.
--
-- TEST ONLY (znldzjdatkogdktymtvi). PROD application (including the
-- still-unverified fire_pit 138 from 2026-08-11) is a separate decision.
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
  where ST_DWithin(mp.geometry::geography, v_route::geography, p_buffer_m)
    and mp.is_searchable = true
    and mp.primary_category <> 'land_status'
    -- Closes the generation-exposure gap (see header): a place deactivated
    -- via source_record.is_active = false (fire_pit/peak/spring pattern)
    -- drops to source_count = 0 on recompute but stays is_searchable = true
    -- — exclude it here the same way master_place_search_export already
    -- does, so generation and browse/search agree.
    and mp.source_count > 0
    and (p_categories is null or mp.primary_category = any(p_categories))
  order by mp.prominence_score desc;
end;
$$;

comment on function public.pois_along_corridor(jsonb, integer, text[]) is
  'Phase 2 consumer corridor read. Returns searchable, non-land_status, source_count > 0 master_place POIs within p_buffer_m meters (::geography) of a GeoJSON LineString route, optionally filtered to p_categories, ordered by prominence. google_place_id sources from ''google'' or ''google_resolved''. nps_photo_url sources from ''nps'' or ''ridb'' (NPS preferred). SECURITY DEFINER — the only consumer door into master_place; RLS stays closed.';

grant execute on function public.pois_along_corridor(jsonb, integer, text[])
  to anon, authenticated;
