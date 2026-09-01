-- ============================================================================
-- Generated-content descriptions as a first-class, LOWEST-precedence source.
--
-- WHY: PR #327 copied master_place_generated_content.generated_text directly
-- into master_place.description for 6,548 rows. That violates the documented
-- invariant that recompute_master_place() is the sole writer of master_place,
-- and it is the only reason the clear-branch restore (20260901000200) needed a
-- special-case exemption at all — the value had no provenance, so nothing could
-- distinguish it from a stranded source value.
--
-- This migration removes the need for that exemption entirely. Generated text
-- is delivered through the NORMAL path — a source_record carrying
-- normalized_payload.description, resolved by resolve_field() through
-- field_precedence like any other source. Consequences that fall out for free:
--   - recompute_master_place() writes the column, so the invariant holds.
--   - attribution.description gets a real value ('generated_llm' /
--     'generated_template') instead of being absent.
--   - A genuine source description automatically OUTRANKS generated text,
--     which is exactly the read path master_place_generated_content documented
--     from the start ("show master_place.description when present; fall back to
--     this table only when null. Never both.").
--   - The clear branch needs no exception: resolve_field() returns a candidate,
--     so the clear branch is never reached for these rows.
--
-- TWO SOURCES, NOT ONE. Splitting by generation_method is load-bearing, not
-- cosmetic: ADR docs/decisions/2026-08-21-template-eligibility-provenance-
-- review-decisions.md §2 excludes template-only rows from trip-stop candidacy.
-- pois_along_corridor expressed that as `not (mp.description is null and
-- has_template)`, a predicate that silently STOPS WORKING the moment anything
-- populates mp.description — which is precisely what PR #327 did and what this
-- migration would also do. A distinct source_id lets 20260901000300 re-express
-- the same exclusion on a basis that survives the description being present.
--
-- PRECEDENCE: 20 and 21, below every real description source (padus at 10 is
-- currently the lowest). Generated text must never outrank a real one.
--
-- TEST FIRST. PROD application is a separate, explicitly authorized step.
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'
-- ============================================================================

set search_path = public;

-- ── 1. One place to define what "a generated source" means ───────────────
-- Used by recompute_master_place() (source_count) and compute_prominence()
-- (diversity, recency). An explicit list rather than a LIKE pattern so a real
-- source that happens to be named `generated_*` can never be swept up by
-- accident.

create or replace function public.is_generated_source(p_source_id text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_source_id in ('generated_llm', 'generated_template');
$$;

comment on function public.is_generated_source(text) is
  'True for the synthetic source_ids that carry master_place_generated_content text through the normal precedence path. These are a delivery mechanism, not evidence that a real-world source describes the place, so they are excluded from source_count and prominence.';

-- ── 2. field_precedence — below every real description source ────────────

insert into public.field_precedence (field_name, source_id, priority)
values
  ('description', 'generated_llm', 20),
  ('description', 'generated_template', 21)
on conflict (field_name, source_id) do nothing;

-- ── 3. compute_prominence must not reward having generated text ──────────
-- Unchanged except for the two exclusions. Without them every place with
-- generated text gains +2.0 (one extra distinct source_id) and, for any place
-- whose real sources are all stale, loses the -1 recency penalty — silently
-- reordering pois_along_corridor, which sorts by prominence_score desc.
--
-- The reviews term needs no exclusion: generated records carry no
-- 'review_count' key, so they contribute 0 either way. The official term needs
-- none either: it tests source_id in ('nps','ridb') explicitly.

create or replace function public.compute_prominence(p_master_place_id uuid)
returns double precision
language plpgsql
stable
as $function$
declare
  v_diversity float;
  v_reviews   float;
  v_official  float := 0;
  v_recency   float := 0;
  v_score     float;
begin
  select count(distinct source_id) * 2.0
    into v_diversity
  from public.source_record
  where master_place_id = p_master_place_id
    and is_active = true
    and not public.is_generated_source(source_id);

  select coalesce(sum(coalesce((normalized_payload ->> 'review_count')::integer, 0)), 0) * 0.5
    into v_reviews
  from public.source_record
  where master_place_id = p_master_place_id and is_active = true;

  if exists (
    select 1 from public.source_record
    where master_place_id = p_master_place_id
      and source_id in ('nps', 'ridb')
      and is_active = true
  ) then
    v_official := 3;
  end if;

  if not exists (
    select 1 from public.source_record
    where master_place_id = p_master_place_id
      and is_active = true
      and not public.is_generated_source(source_id)
      and fetch_timestamp > now() - interval '12 months'
  ) then
    v_recency := -1;
  end if;

  v_score := coalesce(v_diversity, 0) + coalesce(v_reviews, 0) + v_official + v_recency;
  return greatest(v_score, 0);
end;
$function$;

comment on function public.compute_prominence(uuid) is
  'Prominence = 2*distinct real sources + 0.5*reviews + 3 if nps/ridb - 1 if all real sources stale, floored at 0. Generated-content sources are excluded from the diversity and recency terms (see is_generated_source) so routing LLM/template text through source_record does not change ranking.';
