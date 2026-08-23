# LLM-generated descriptions are eligible for trip-stop suggestion; template-only descriptions are not

**Status:** Decided 2026-08-23 — **recorded, not yet in effect** (see Consequences)
**Date:** 2026-08-23
**Relates to:** `docs/decisions/2026-08-21-template-eligibility-provenance-review-decisions.md` §5 (the template exclusion this decision deliberately does not extend), `supabase/migrations/20260821050000_pois_along_corridor_exclude_template_review.sql`

## Context

`pois_along_corridor()` — the only consumer door into `master_place` for trip
generation — excludes template-only-description places from trip-stop
candidacy. The predicate is:

```sql
and not (mp.description is null and coalesce(desc_gc.has_template, false))
```

and the lateral that feeds it computes exactly two flags:

```sql
bool_or(gc.needs_review)                      as any_flagged,
bool_or(gc.generation_method = 'template')    as has_template
```

There is **no `has_llm`**. So a place whose only `master_place_generated_content`
description row is `generation_method = 'llm'` is not excluded, while the
template equivalent is. Read cold, that asymmetry looks like an oversight — a
missing `or gc.generation_method = 'llm'` — and the obvious "fix" is to add it.

It is not an oversight. This ADR exists so nobody adds that clause.

The distinction is about content quality, not provenance-for-its-own-sake. A
template description is `"{name} is a {category} in {parent}, {state}."` — built
only from fields already on the row, deliberately zero-fabrication, and
meaningfully thinner than real source content. That thinness is precisely why
the 2026-08-21 decision excluded it from suggestions while still counting it as
"resolved" for eligibility bucketing. An LLM description is a grounded prose
summary of the source facts, produced under the validated anti-fabrication
prompt. Those are different kinds of artifact and they do not warrant the same
treatment at the suggestion boundary.

## Decision

**LLM-generated descriptions (`generation_method = 'llm'` in
`master_place_generated_content`) are good enough for trip-stop suggestion
eligibility.**

The template-only exclusion in `pois_along_corridor`'s predicate
**deliberately does not apply to LLM-only descriptions. This is intentional,
not an oversight.**

- Template-only places **remain excluded** from suggestions.
- LLM-only places **are not excluded**.

The `needs_review` exclusion is unaffected and continues to apply to **any**
generated_content row regardless of `generation_method` — an LLM row flagged
for review still removes its place from candidacy.

## Consequences

**This decision is recorded but not yet in effect.** Nothing about the current
system changes as a result of writing it down. As verified by the 2026-08-23
investigation of the pilot run (the run itself executed 2026-08-21):

- The pilot wrote **7,433** `llm` rows to `master_place_generated_content` on
  TEST. The script that produced them is committed on branch
  `corpus-address-field-survey`.
- `master_place_search_export` computes an `llm` bucket for **6,548** of them
  (the other 885 report `source`, because the view's `CASE` checks
  `mp.description` first and those places carry a short real description).
- **Typesense has not been synced since.** The live `places_test` index reports
  `description_source` facets of `source` and `template` only — **no `llm`
  bucket at all**.
- **No app code reads any of it.** A repo-wide grep of `web/src` for
  `generated_content` / `description_source` / `generation_method` returns
  nothing.
- The generated text is exposed by **no SQL object**: the export view selects
  `mp.description` and computes only a provenance *label*, and
  `pois_along_corridor` likewise returns `mp.description`. The LLM prose has
  never left its table.

So the practical effect of this decision is currently nil: the LLM-only places
were already candidates before the pilot ran (they had `mp.description IS NULL`
and no generated_content row, so the predicate admitted them), and they still
return a NULL description to the caller. **The decision takes effect only once
search sync and app-code wiring happen — both separate, future work, neither
authorized here.**

Two things to carry into that work:

1. **Do not "fix" the asymmetry.** If a future reader adds
   `or gc.generation_method = 'llm'` to the `has_template` flag, they will
   silently reverse this decision and drop ~6,548 places out of trip-stop
   candidacy. The predicate should stay as written.
2. **Quality of the specific corpus is separately established, not assumed
   here.** The 2026-08-23 investigation found the 7,433 rows sound at
   population scale — 0 empty, 0 missing grounding ids, 1:1 with
   `master_place_id`, no duplicates — with five cosmetic defects (four rows
   wrapped in literal markdown fences, one row containing a reasoning scaffold
   instead of a description) and 456 duplicate low-information texts across
   near-identical places. This ADR decides the *category* is eligible; it does
   not certify any particular row, and it does not supersede the pilot's own
   caveat that its ~4% residual any-fabrication rate was measured on a
   27-row sample and is not certified at corpus scale.
