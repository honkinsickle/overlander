-- ============================================================================
-- Family Destinations Guide — description + photo precedence.
--
-- Test-run companion to the 2026-08-28 ingest of the first Family
-- Destinations Guide article ("Foodie Road Trip California",
-- data/ingestion/sources/family-destinations.ts). Test-only editorial
-- content per Adam's 2026-08-28 directive.
--
-- Two pieces, both mirroring PR #314's atlas_oddities migration
-- (20260827180000) exactly:
--
--   1. field_precedence — add ('description', 'family_destinations', 7).
--      Priority 7 sits BELOW the existing chain:
--        nps=1, ridb=2, google=3, ioverlander=4, osm=5, atlas_oddities=6,
--        family_destinations=7
--      so this source only fills gaps and never displaces a real
--      description another linked source resolved. Reflects the
--      lower source_quality_score (0.4) documented in the ingester.
--
--   2. backfill_master_place_photo_url() — add family_destinations at
--      position 7 of the resolution chain. Existing precedence chain
--      (per PR #314's 20260827180000):
--        nps > ridb > wikipedia > blm > state_parks > atlas_oddities.
--      New chain:
--        nps > ridb > wikipedia > blm > state_parks > atlas_oddities >
--        family_destinations.
--      family_destinations photos live at normalized_payload.photo.url,
--      same shape as nps/ridb/wikipedia/atlas_oddities.
--
-- TEST ONLY. Not applied to PROD; PROD has zero family_destinations
-- source_records so the field_precedence row + RPC extension are no-op
-- there anyway, but the field_precedence row would still be a data
-- change and is deliberately withheld.
-- ============================================================================

set search_path = public;

-- ── 1. description precedence row ─────────────────────────────────────
insert into public.field_precedence (field_name, source_id, priority)
values ('description', 'family_destinations', 7);

-- ── 2. photo RPC — extend to family_destinations ──────────────────────
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
           and sr.source_id in ('nps', 'ridb', 'wikipedia', 'blm', 'state_parks', 'atlas_oddities', 'family_destinations')
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
  'Bulk backfill helper for master_place.photo_url. Resolves nps > ridb > wikipedia > blm > state_parks > atlas_oddities > family_destinations. nps/ridb/wikipedia/atlas_oddities/family_destinations from normalized_payload.photo.url; blm/state_parks from raw_payload.props.PHOTO_LINK / .Imagelink. Clears stale values. Not part of any ongoing pipeline.';
