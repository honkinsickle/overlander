-- ============================================================================
-- backfill_master_place_photo_url() — set-based backfill helper for the
-- master_place.photo_url column added in 20260821060000.
--
-- Same posture as backfill_state_for_ids() (20260821020000): a per-row UPDATE
-- loop from the client over thousands of rows is slow and pushes logic that
-- belongs in SQL into app code. The client chunks ids; this does the resolve
-- and the write server-side in one statement per chunk.
--
-- RESOLUTION ORDER — nps > ridb > blm > state_parks.
--   nps, ridb        `normalized_payload->'photo'->>'url'`. This mirrors the
--                    photo LEFT JOIN LATERAL already in
--                    master_place_search_export (20260810180400) and
--                    pois_along_corridor (20260809130000), including its
--                    "NPS preferred over RIDB" rule — deliberately the same
--                    precedence so the column and the view agree on the rows
--                    they both cover.
--   blm              `raw_payload->'props'->>'PHOTO_LINK'`.
--   state_parks      `raw_payload->'props'->>'Imagelink'`.
--
-- ⚠ blm and state_parks photos are read from raw_payload because NEITHER
-- normalizer maps them into normalized_payload — measured 2026-08-21 by a
-- full scan of all 876 blm and all 1,736 state_parks source_records
-- (data/scripts/investigate-enrichment-fields-2026-08-21.ts): 102 blm rows
-- carry a non-empty PHOTO_LINK and 138 state_parks rows carry a non-empty
-- Imagelink, and none of it reaches normalized_payload. This is the same
-- shape as the BLM WEB_LINK miss fixed on 2026-08-20. The durable fix is to
-- map them in blm-rec.ts / state-parks.ts and re-normalize, which would also
-- put them in the export view's lateral; that is a separate follow-up and is
-- NOT done here. Reading raw_payload keeps this backfill honest about where
-- the data actually lives rather than silently dropping 221 real photos.
--
-- TIE-BREAKER. Source order first, then source_quality_score DESC, then
-- external_id ASC. The first two mirror resolve_field()'s determinism fix
-- (20260601010000); external_id is the third key because, unlike
-- resolve_field (which orders by source_id and can only ever tie ACROSS
-- sources), a single master_place can link several source_records from the
-- SAME source — so source_id alone is not a total order here.
--
-- IDEMPOTENT + SELF-CORRECTING. The UPDATE is guarded on `is distinct from`,
-- so a second run over the same ids reports 0 changed. Ids whose sources no
-- longer resolve a photo are set back to NULL rather than left stale, so
-- passing the currently-populated id set re-clears anything that has since
-- been deactivated.
--
-- NOT part of any ongoing pipeline. photo_url is a SNAPSHOT: it is not wired
-- into recompute_master_place(), so a later deactivation/materialize will not
-- refresh it until this is re-run. Wiring it into the resolver would require
-- a `photo`/`photo_url` row in field_precedence for each contributing source,
-- and seeding field_precedence is a product decision reserved for Adam
-- (CLAUDE.md §"When uncertain"). Flagged, deliberately not decided here —
-- exactly the open question already recorded for master_place.state.
--
-- NOT SECURITY DEFINER, matching backfill_state_for_ids(). master_place has
-- RLS enabled with no policies, so an anon/authenticated caller updates zero
-- rows; only the service role can actually write through this.
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
           and sr.source_id in ('nps', 'ridb', 'blm', 'state_parks')
           and coalesce(
                 nullif(btrim(sr.normalized_payload -> 'photo' ->> 'url'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'PHOTO_LINK'), ''),
                 nullif(btrim(sr.raw_payload -> 'props' ->> 'Imagelink'), '')
               ) is not null
         order by
           case sr.source_id
             when 'nps'         then 1
             when 'ridb'        then 2
             when 'blm'         then 3
             when 'state_parks' then 4
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
  'Bulk backfill helper for master_place.photo_url. Resolves nps > ridb > blm > state_parks (nps/ridb from normalized_payload.photo.url, blm/state_parks from raw_payload.props.PHOTO_LINK / .Imagelink, neither of which its normalizer maps). Sets NULL when no active linked source carries a photo, so it also clears stale values. Not part of any ongoing pipeline — called by data/scripts/backfill-master-place-enrichment.ts.';
