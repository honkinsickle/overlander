-- ============================================================================
-- master_place_generated_content — LLM- and template-generated field content,
-- structurally separate from source-of-truth data.
--
-- Proposed in docs/measurements/2026-08-20-llm-description-generation-pilot.md
-- §6 (LLM-only at the time), now built with a second generation method
-- (deterministic templates — docs/measurements/2026-08-21-none-bucket-
-- reduction-strategy.md §3b) added before this table was ever applied. A
-- column on master_place would need recompute_master_place/field_precedence
-- to somehow know not to treat it as a normal precedence-resolved field —
-- exactly the "never confused with source-of-truth content" risk the
-- original proposal called out. A separate table makes that boundary
-- structural, not a naming convention.
--
-- Changes from the original single-purpose (LLM-only) proposal, made before
-- first use rather than as a later migration:
--   - generation_method ('template' | 'llm') replaces the original
--     llm_generated boolean. A boolean that's always true by construction
--     for the LLM case becomes actively wrong once template rows exist
--     (a template row is not "llm_generated=true"), and keeping both a
--     boolean and a method string invites the two disagreeing. One
--     provenance field, not two.
--   - model_version is now NULLABLE — meaningless for generation_method =
--     'template' (a template has no model). Still NOT NULL-equivalent in
--     practice for 'llm' rows by application-level convention, not a DB
--     constraint (a partial NOT NULL via CHECK was considered and rejected
--     as more complexity than the guarantee is worth for one column).
--   - prompt_version is repurposed to mean "prompt version" for LLM rows or
--     "template version" for template rows — one versioning column, not two
--     near-duplicate ones for the two methods.
--
-- Read path (app layer, not enforced here): show master_place.description
-- when present; fall back to this table only when null. Never both.
--
-- TEST ONLY (znldzjdatkogdktymtvi) as of this migration. PROD application is
-- a separate, later, explicitly authorized step.
-- ============================================================================

set search_path = public;

create table public.master_place_generated_content (
  id uuid primary key default gen_random_uuid(),
  master_place_id uuid not null references public.master_place(id) on delete cascade,
  field_name text not null,                      -- 'description' today; extensible
  generated_text text not null,
  generation_method text not null check (generation_method in ('template', 'llm')),
  model_version text,                             -- null for generation_method='template'
  generated_at timestamptz not null default now(),
  grounded_on_source_record_ids uuid[] not null,  -- lets a future pass detect when the
                                                   -- underlying source data has changed
  prompt_version text,                            -- LLM prompt version, or template
                                                   -- version when generation_method='template'

  unique (master_place_id, field_name)
);

create index on public.master_place_generated_content (master_place_id);

alter table public.master_place_generated_content enable row level security;
-- Zero policies — service-role only, same posture as source_record /
-- master_place / place_match. No anon/authenticated grants.

comment on table public.master_place_generated_content is
  'Generated (template or LLM) field content, structurally separate from source_record/master_place so it is never treated as source-of-truth by recompute_master_place or field_precedence. Read path: master_place.<field_name> wins when present; this table is a fallback only, never merged with real source data.';
