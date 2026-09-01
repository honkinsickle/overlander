-- ============================================================================
-- master_place_photo_candidate — support a 'no_candidate' outcome.
--
-- The NPS-direct pass matches an NPS-sourced master_place to its NPS unit by the
-- structured campground id captured at ingestion (external_id
-- 'nps:campground:<id>'), pulls the unit's `images`, and accepts a usable photo
-- directly (NPS = first-party / U.S. government public domain). Two outcomes have
-- no usable image and must still be recorded rather than silently skipped:
--   - the matched unit's images are ALL non-photo (maps/signs/logos), or
--   - the structured id no longer resolves in the current NPS API (unit removed
--     or renamed upstream since ingestion).
-- Both are stored as match_status='no_candidate' with a match_reason. Such rows
-- carry no image, so:
--   1. image_url becomes NULLABLE (a no_candidate row has no image), and
--   2. match_status gains 'no_candidate'.
--
-- Additive and backward-compatible: existing accepted/rejected/manual_review rows
-- and the Google-verdict columns are untouched. NOT wired into rendering.
--
-- TEST ONLY (znldzjdatkogdktymtvi) as of this migration.
-- ============================================================================

set search_path = public;

alter table public.master_place_photo_candidate
  alter column image_url drop not null;

alter table public.master_place_photo_candidate
  drop constraint master_place_photo_candidate_match_status_check;
alter table public.master_place_photo_candidate
  add constraint master_place_photo_candidate_match_status_check
    check (match_status in ('accepted', 'manual_review', 'rejected', 'no_candidate'));

comment on column public.master_place_photo_candidate.image_url is
  'Display image URL. NULL only for match_status=''no_candidate'' rows (no usable image was found — all source images non-photo, or the source unit no longer resolves).';
