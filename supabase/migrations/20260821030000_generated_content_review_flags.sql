-- ============================================================================
-- Review/re-queue flag on master_place_generated_content.
--
-- Combined eligibility + provenance + review pass, 2026-08-21. Manual and
-- automated spot-checks on template descriptions (this session found the
-- Astoria Column WA/OR border-state mislabel this way) need a way to mark a
-- specific generated_content row as wrong and pull a worklist of everything
-- flagged. Two things this needs to support:
--   (a) flag a specific row by id when a human/automated check catches a
--       problem
--   (b) later query "give me everything flagged for review" as a worklist
--
-- Shape decision: 4 columns directly on master_place_generated_content, NOT
-- a companion table. Considered a companion table (e.g.
-- generated_content_review with a FK) for cleaner separation of
-- "generation" vs "review-state" concerns, but rejected: the actual need is
-- a single CURRENT flag per row (one row = one current review state), not a
-- flag history/audit log. A companion table would just add a join for both
-- the flag-write and the worklist-read with no capability this session
-- needs. If a flag HISTORY becomes a real requirement later, that's the
-- point to introduce a companion table — not before.
--
-- needs_review boolean default false: the worklist predicate. Partial index
-- below makes "give me everything flagged" cheap regardless of table size.
-- review_reason text, nullable: free text, e.g. "manual spot-check:
-- description doesn't match location" or "border-state ambiguity" — no
-- fixed vocabulary asked for, none imposed.
-- flagged_at timestamptz, nullable: null until first flagged.
-- flagged_by text, nullable: freeform source tag ("manual",
-- "automated_check", etc.) — no real user-auth wiring, as scoped.
--
-- TEST ONLY (znldzjdatkogdktymtvi). PROD application is a separate,
-- explicitly authorized step.
-- ============================================================================

set search_path = public;

alter table public.master_place_generated_content
  add column needs_review boolean not null default false,
  add column review_reason text,
  add column flagged_at timestamptz,
  add column flagged_by text;

-- Worklist query ("everything flagged for review") only ever filters
-- needs_review = true — a partial index keeps that cheap as the table
-- grows, without indexing the (usually false) common case.
create index on public.master_place_generated_content (flagged_at)
  where needs_review = true;

comment on column public.master_place_generated_content.needs_review is
  'True when a manual or automated check has flagged this generated row as wrong/needing regeneration. Default false. Worklist query: WHERE needs_review = true.';
comment on column public.master_place_generated_content.review_reason is
  'Free-text reason for the flag (e.g. "manual spot-check: description doesn''t match location", "border-state ambiguity"). Null until flagged.';
comment on column public.master_place_generated_content.flagged_at is
  'Timestamp of the flag. Null until flagged.';
comment on column public.master_place_generated_content.flagged_by is
  'Freeform source of the flag ("manual", "automated_check", etc.) — not wired to real user auth. Null until flagged.';
