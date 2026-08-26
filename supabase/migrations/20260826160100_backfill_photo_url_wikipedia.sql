-- ============================================================================
-- Add 'wikipedia' to the backfill_master_place_photo_url() precedence chain.
--
-- New order: nps (1) > ridb (2) > wikipedia (3) > blm (4) > state_parks (5).
-- Wikipedia photos use normalized_payload.photo.url (same as nps/ridb).
--
-- CREATE OR REPLACE — same signature (uuid[]), so no DROP needed.
--
-- TEST ONLY (znldzjdatkogdktymtvi).
-- ============================================================================

set search_path = public;

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
           and sr.source_id in ('nps', 'ridb', 'wikipedia', 'blm', 'state_parks')
           and coalesce(
                 nullif(btrim(sr.normalized_payload -> 'photo' ->> 'url'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'PHOTO_LINK'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'Imagelink'), '')
               ) is not null
         order by
           case sr.source_id
             when 'nps'         then 1
             when 'ridb'        then 2
             when 'wikipedia'   then 3
             when 'blm'         then 4
             when 'state_parks' then 5
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
  'Bulk backfill helper for master_place.photo_url. Resolves nps > ridb > wikipedia > blm > state_parks. nps/ridb/wikipedia from normalized_payload.photo.url; blm/state_parks from raw_payload.props.PHOTO_LINK / .Imagelink. Clears stale values. Not part of any ongoing pipeline.';
