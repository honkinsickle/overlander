-- ============================================================================
-- Editorial food-guide source — description + photo precedence.
--
-- Test-only companion to the 2026-08-28 multi-publisher ingest of
-- California road-trip food articles under `source_id = 'editorial_food'`.
-- Ingester: `data/ingestion/sources/editorial-food.ts`. Content posture:
-- TEST-only per Adam's 2026-08-28 directive.
--
-- Two pieces (parallels 20260828110000 for `family_destinations` and
-- 20260827180000 for `atlas_oddities`):
--
--   1. field_precedence — add ('description', 'editorial_food', 8).
--      Priority 8 sits BELOW the existing chain including
--      family_destinations (priority 7), so this source only fills
--      description gaps and never displaces a real description another
--      linked source resolved. Reflects the lower source_quality_score
--      (0.35) documented in the ingester.
--
--   2. backfill_master_place_photo_url() — add editorial_food at
--      position 8 of the resolution chain. Existing chain per PR #316
--      (20260828110000):
--        nps > ridb > wikipedia > blm > state_parks > atlas_oddities >
--        family_destinations.
--      New chain:
--        nps > ridb > wikipedia > blm > state_parks > atlas_oddities >
--        family_destinations > editorial_food.
--      editorial_food photos live at normalized_payload.photo.url, same
--      shape as the other photo-carrying sources.
--
-- TEST ONLY. Not applied to PROD.
-- ============================================================================

set search_path = public;

-- ── 1. description precedence row ─────────────────────────────────────
insert into public.field_precedence (field_name, source_id, priority)
values ('description', 'editorial_food', 8);

-- ── 2. photo RPC — extend to editorial_food ───────────────────────────
create or replace function public.backfill_master_place_photo_url(p_ids uuid[])
returns integer
language sql
as $$
  with resolved as (
    select
      mp.id,
      (
        select coalesce(
                 nullif(btrim(sr.normalized_payload -> 'photo' ->> 'url'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'PHOTO_LINK'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'Imagelink'), '')
               )
          from public.source_record sr
         where sr.master_place_id = mp.id
           and sr.is_active = true
           and sr.source_id in ('nps', 'ridb', 'wikipedia', 'blm', 'state_parks', 'atlas_oddities', 'family_destinations', 'editorial_food')
           and coalesce(
                 nullif(btrim(sr.normalized_payload -> 'photo' ->> 'url'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'PHOTO_LINK'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'Imagelink'), '')
               ) is not null
         order by
           case sr.source_id
             when 'nps'                  then 1
             when 'ridb'                 then 2
             when 'wikipedia'            then 3
             when 'blm'                  then 4
             when 'state_parks'          then 5
             when 'atlas_oddities'       then 6
             when 'family_destinations'  then 7
             when 'editorial_food'       then 8
           end asc,
           sr.source_quality_score desc nulls last,
           sr.external_id asc
         limit 1
      ) as photo_url
    from public.master_place mp
    where mp.id = any(p_ids)
  ),
  updated as (
    update public.master_place mp
       set photo_url = r.photo_url
      from resolved r
     where mp.id = r.id
       and mp.photo_url is distinct from r.photo_url
    returning mp.id
  )
  select count(*)::integer from updated;
$$;

comment on function public.backfill_master_place_photo_url(uuid[]) is
  'Bulk backfill helper for master_place.photo_url. Resolves nps > ridb > wikipedia > blm > state_parks > atlas_oddities > family_destinations > editorial_food. Reads normalized_payload.photo.url for nps/ridb/wikipedia/atlas_oddities/family_destinations/editorial_food; raw_payload.props.PHOTO_LINK / .Imagelink for blm/state_parks. Clears stale values. Not part of any ongoing pipeline.';
