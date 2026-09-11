-- ============================================================================
-- pin_of_the_day_post — reusable post history for the "Pin of the Day" skill,
-- the interactive wrapper around the Pin of the Week pipeline. One row per
-- APPROVED post: recorded only after the operator approves a generated post
-- (never at generate time).
--
-- WHY A TABLE (same reasoning as the other Pin of the Week tables):
--   - This is post-history metadata, not a corpus attribute — it must not be a
--     column on master_place, and it is never read by any corpus path
--     (recompute_master_place / pois_along_corridor / master_place_search_export
--     / field_precedence).
--   - It is a sequence of events (a log of posts made), like
--     pin_of_week_caption_history, so it is a small append-oriented table with a
--     synthetic identity key, not a per-place stamp.
--
-- METADATA ONLY. The composited image lives on disk in a committed archive
-- (data/pin-of-the-week/posts/<date>-<slug>/image.png + manifest.json), NOT in
-- the DB — an image is reproducible from place + template + photo bytes, and a
-- 2 MB blob does not belong in Postgres. archive_dir points at that folder so
-- `potw:posts --reuse <id>` can locate the archived image.
--
-- canonical_name is a SNAPSHOT (denormalized) so the post history survives a
-- later merge/removal of the place; master_place_id is a soft reference
-- (on delete set null), matching pin_of_week_caption_history.
-- ============================================================================

set search_path = public;

create table if not exists public.pin_of_the_day_post (
  id bigint generated always as identity primary key,
  master_place_id uuid references public.master_place(id) on delete set null,
  canonical_name text not null,            -- snapshot of the place name at post time
  caption_text text not null,
  template_number smallint not null check (template_number between 1 and 8),
  photo_source text not null,              -- 'corpus' | 'override:url' | 'override:file'
  photo_ref text,                          -- source URL (corpus / override:url) or the marker for a file override
  archive_dir text not null,               -- relative path to the committed archive folder for this post
  status text not null default 'created',  -- lifecycle marker (future: 'posted', 'archived', ...)
  created_at timestamptz not null default now()
);

create index if not exists pin_of_the_day_post_created_at_idx
  on public.pin_of_the_day_post (created_at desc);

comment on table public.pin_of_the_day_post is
  'Reusable post history for the Pin of the Day skill. One row per approved post (recorded on approval, never at generate time). Metadata only — the composited image lives on disk in the committed archive at data/pin-of-the-week/posts/<date>-<slug>/ (archive_dir). canonical_name is a snapshot; master_place_id is a soft reference. Not read by any corpus path.';

alter table public.pin_of_the_day_post enable row level security;
-- No policies: service-role only, matching the other Pin of the Week tables.
