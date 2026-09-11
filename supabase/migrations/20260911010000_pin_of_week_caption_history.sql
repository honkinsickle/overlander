-- ============================================================================
-- pin_of_week_caption_history — append-only log of which caption template each
-- Pin of the Week `generate` used, so the generator can ROTATE templates and
-- avoid immediate repeats (least-recently-used).
--
-- WHY A TABLE (analog of how featured_at tracks place history):
--   featured_at is a per-PLACE stamp (one column, one timestamp per place). A
--   caption template, by contrast, is chosen per GENERATE run and the rotation
--   is GLOBAL (avoid repeating the last template across posts, regardless of
--   place). That is a sequence of events, not a per-place attribute, so it is a
--   small append-only log table rather than a column. It reads back the same
--   way the place-diversity logic reads recent featured picks. Not read by any
--   corpus path (recompute / pois_along_corridor / search_export).
-- ============================================================================

set search_path = public;

create table if not exists public.pin_of_week_caption_history (
  id bigint generated always as identity primary key,
  template_number smallint not null check (template_number between 1 and 8),
  master_place_id uuid references public.master_place(id) on delete set null,
  used_at timestamptz not null default now()
);

create index if not exists pin_of_week_caption_history_used_at_idx
  on public.pin_of_week_caption_history (used_at desc);

comment on table public.pin_of_week_caption_history is
  'Append-only log of which caption template (1-8) each Pin of the Week generate used, for least-recently-used template rotation. One row per auto-selected caption; forced (--caption-template) picks are not logged. Not read by any corpus path.';

alter table public.pin_of_week_caption_history enable row level security;
-- No policies: service-role only, matching the other Pin of the Week tables.
