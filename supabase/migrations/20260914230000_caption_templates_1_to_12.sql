-- ============================================================================
-- Widen the caption-template range from 1-8 to 1-12.
--
-- WHY: data/pin-of-the-week/caption.ts grew from 8 fixed caption templates to
-- 12. Two tables pin the old range in a CHECK constraint, and BOTH reject a
-- template number above 8 at INSERT time:
--
--   pin_of_week_caption_history.template_number  -- written by `potw:generate`
--                                                -- on every AUTO-rotated pick
--   pin_of_the_day_post.template_number          -- written by `potw:posts --record`
--                                                -- when a post is approved
--
-- Without this migration, LRU rotation reaching template 9-12 fails the
-- caption-history insert, and recording an approved post built from templates
-- 9-12 fails too. The TypeScript range guards were widened in the same commit;
-- this keeps the database in step with them.
--
-- The constraints were created inline (unnamed in the source, auto-named by
-- Postgres as <table>_<column>_check), so each is dropped by that generated
-- name and re-added with the new bound. `if exists` keeps the drop idempotent.
--
-- Range only. No column, type, index, RLS, or row change.
-- ============================================================================

set search_path = public;

alter table public.pin_of_week_caption_history
  drop constraint if exists pin_of_week_caption_history_template_number_check;
alter table public.pin_of_week_caption_history
  add constraint pin_of_week_caption_history_template_number_check
  check (template_number between 1 and 12);

alter table public.pin_of_the_day_post
  drop constraint if exists pin_of_the_day_post_template_number_check;
alter table public.pin_of_the_day_post
  add constraint pin_of_the_day_post_template_number_check
  check (template_number between 1 and 12);

comment on table public.pin_of_week_caption_history is
  'Append-only log of which caption template (1-12) each Pin of the Week generate used, for least-recently-used template rotation. One row per auto-selected caption; forced (--caption-template) picks are not logged. Not read by any corpus path.';
