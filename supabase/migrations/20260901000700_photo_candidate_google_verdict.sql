-- ============================================================================
-- master_place_photo_candidate — Google-verified auto-adjudication columns.
--
-- The CA-campground photo pilot stages license-clear candidates (Commons / NPS)
-- with a name+geo match_status. This adds an automated verification pass: each
-- candidate photo is compared against a LIVE Google reference photo of the same
-- place using a vision model, and the comparison VERDICT is stored here.
--
-- COMPLIANCE (standing rule "Google Places — live-fetch-at-render is compliant;
-- warehousing is not"): the Google reference image is fetched live, held only in
-- process memory for the comparison, and discarded. NONE of it — no image bytes,
-- no photo URL, no Google photo/place identifier — is written to this table or
-- anywhere else. Only the model's verdict/confidence/reasoning is persisted.
-- `google_reasoning` is the model's textual rationale (it may describe what the
-- Google reference showed) — that is a verdict, not image data.
--
-- match_status is widened to allow 'rejected': the verification pass rejects
-- clear mismatches AND ambiguous cases (conservative default, per instruction).
-- "Couldn't verify" cases (no Google result, or API error after retries) do NOT
-- get rejected — they keep their prior match_status and are flagged via
-- google_verdict ('no_google_result' | 'unverified').
--
-- TEST ONLY (znldzjdatkogdktymtvi) as of this migration.
-- ============================================================================

set search_path = public;

alter table public.master_place_photo_candidate
  add column if not exists google_verdict text,        -- match | no_match | ambiguous | no_google_result | unverified
  add column if not exists google_confidence text,     -- high | medium | low (model-reported)
  add column if not exists google_reasoning text,       -- brief rationale for the verdict
  add column if not exists google_ref_source text,      -- how the live reference was obtained (e.g. 'google_places_text_search'); NOT an image URL/id
  add column if not exists google_checked_at timestamptz;

alter table public.master_place_photo_candidate
  add constraint master_place_photo_candidate_google_verdict_check
    check (google_verdict is null or google_verdict in
      ('match', 'no_match', 'ambiguous', 'no_google_result', 'unverified'));

alter table public.master_place_photo_candidate
  add constraint master_place_photo_candidate_google_confidence_check
    check (google_confidence is null or google_confidence in ('high', 'medium', 'low'));

-- Widen match_status: the Google pass sets 'rejected' for mismatch/ambiguous.
alter table public.master_place_photo_candidate
  drop constraint master_place_photo_candidate_match_status_check;
alter table public.master_place_photo_candidate
  add constraint master_place_photo_candidate_match_status_check
    check (match_status in ('accepted', 'manual_review', 'rejected'));

create index if not exists master_place_photo_candidate_google_verdict_idx
  on public.master_place_photo_candidate (google_verdict);

comment on column public.master_place_photo_candidate.google_reasoning is
  'Vision-model rationale for the Google-comparison verdict. A verdict/description, never Google image data — no Google image bytes, URL, or identifier is stored anywhere per the live-fetch-not-warehouse rule.';
