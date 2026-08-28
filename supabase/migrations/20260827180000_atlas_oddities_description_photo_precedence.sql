-- ============================================================================
-- Atlas Obscura oddities — description + photo precedence.
--
-- Companion to the 2026-08-27 manual AO content ingest (data/scripts/
-- atlas-oddities-manual-content-ingest.ts). That script fills
-- source_record.normalized_payload.description (from AO's editorial `about`
-- write-up) and source_record.normalized_payload.photo.url (from AO's CDN
-- hero image) for ~1,789 matched atlas_oddities rows sourced from the
-- manually-supplied OR + CA + LA CSVs in /Users/adamwagner/atlas-obscura-*.
--
-- Two pieces:
--   1. field_precedence — add ('description', 'atlas_oddities', 6). Priority
--      6 sits BELOW the existing chain (nps=1, ridb=2, google=3, ioverlander=4,
--      osm=5) so AO content only fills gaps — it never overwrites a
--      description another linked source resolved. AO's source_quality_score
--      is 0.5 (curated, not authoritative) which matches the low-precedence
--      posture. Flows into master_place.description via recompute_master_place().
--
--   2. backfill_master_place_photo_url() — add atlas_oddities at position 6
--      of the resolution chain. Mirrors the 2026-08-26 Wikipedia extension.
--      New order: nps (1) > ridb (2) > wikipedia (3) > blm (4) > state_parks
--      (5) > atlas_oddities (6). AO photos live at
--      normalized_payload.photo.url — same shape as nps/ridb/wikipedia — so
--      no new coalesce path is needed.
--
-- TEST ONLY (znldzjdatkogdktymtvi). Not applied to PROD; PROD has zero
-- atlas_oddities source_records, so the RPC extension is a no-op there
-- anyway, but the field_precedence row would still be a data change and
-- is deliberately withheld.
-- ============================================================================

set search_path = public;

-- ── 1. description precedence row ─────────────────────────────────────
insert into public.field_precedence (field_name, source_id, priority)
values ('description', 'atlas_oddities', 6);

-- ── 2. photo RPC — extend to atlas_oddities ───────────────────────────
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
           and sr.source_id in ('nps', 'ridb', 'wikipedia', 'blm', 'state_parks', 'atlas_oddities')
           and coalesce(
                 nullif(btrim(sr.normalized_payload -> 'photo' ->> 'url'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'PHOTO_LINK'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'Imagelink'), '')
               ) is not null
         order by
           case sr.source_id
             when 'nps'            then 1
             when 'ridb'           then 2
             when 'wikipedia'      then 3
             when 'blm'            then 4
             when 'state_parks'    then 5
             when 'atlas_oddities' then 6
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
  'Bulk backfill helper for master_place.photo_url. Resolves nps > ridb > wikipedia > blm > state_parks > atlas_oddities. nps/ridb/wikipedia/atlas_oddities from normalized_payload.photo.url; blm/state_parks from raw_payload.props.PHOTO_LINK / .Imagelink. Clears stale values. Not part of any ongoing pipeline.';
