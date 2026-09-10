# Pin of the Week — content pipeline (SELECT + GENERATE)

An Instagram content pipeline that picks one high-quality place from the corpus
each week and produces a branded post (caption + image). **Scope of this doc /
this PR: SELECT and GENERATE only. Posting/publishing is intentionally out of
scope.**

> ⚠️ **No prior brief existed.** The task referenced "the Yo Trippin IG content
> brief" and "the existing Nano Banana pipeline and style guide." A full search
> found **none of these in the repo** — no content brief, no caption/hook/CTA
> spec, no IG voice guide, and no image-generation code of any kind. This
> pipeline is net-new. The caption format below is taken from the task prompt
> itself (hook first → rating as payoff → CTA last); the image style guide is
> derived from the app's own design system (`DESIGN.md`). Both are first drafts
> to react to, not a codification of an existing standard.

## Where it lives

- Code: `data/pin-of-the-week/`
- Migration: `supabase/migrations/20260910140000_master_place_featured_at.sql`
- Run (TEST only): `npm run -w data potw:select` / `npm run -w data potw:generate`

Everything is **TEST-only** and guarded — `assertTestProject()` refuses to run
unless `SUPABASE_URL` points at the TEST ref (`znldzjdatkogdktymtvi`). No PROD
writes. The only write the pipeline ever performs is `select --commit`, which
stamps `featured_at` on the chosen place via the `set_master_place_featured_at()`
RPC.

---

## SELECT

### Eligibility definition

A place is an eligible "Pin of the Week" candidate when **all** hold:

| Requirement | Grounded rule |
|---|---|
| Resolved photo | `photo_url` is a non-empty snapshot column (nps>ridb>blm>state_parks) |
| Non-template description | description present AND `attribution->>'description'` ∉ {`generated_template`, `generated_llm`} — i.e. `master_place_search_export.description_source = 'source'` |
| Verification signal | official source (`nps`/`ridb`) contributed a field, **and/or** `prominence_score > 0` |
| Publishable | `is_searchable = true` (excludes `land_status`) and `operational_status` ∉ {CLOSED, TEMPORARILY CLOSED, DECOMMISSIONED, UNREACHABLE} |
| Never repeat | `featured_at IS NULL` (excludes places already featured) |

### ⚠️ Deviation — "valid rating/verification signal"

The task asked for "a valid rating/verification signal." **`master_place.rating`,
`review_count`, and `price_tier` are NULL corpus-wide** — no ingested source
carries a numeric rating, and Google ratings are prohibited from storage by the
caching policy. This was measured, not assumed: `--count` reports
`with_numeric_rating: 0`. So a literal rating filter would match **zero** rows.

The pipeline substitutes a **grounded verification proxy**: presence of an
official source (NPS / Recreation.gov) and/or a positive prominence score. This
is the closest real signal to "verified" the corpus has (it also matches the
product's own "yoTrippin Verified" concept).

### Measured eligibility (TEST, computed 2026-09-10 — not estimated)

- `master_place` rows scanned: **161,431**
- Eligible candidates: **10,063**
- Rows with a numeric rating: **0**
- Dominant disqualifier: no resolved photo (**151,120**)

Re-run anytime: `npm run -w data potw:select -- --count`.

### Selection + diversity

`potw:select` returns **one** eligible place per call. Candidates are ranked by:

```
score = prominence_score
      + 100 if state    not in the last N featured picks
      +  50 if category not in the last N featured picks
```

with a deterministic tie-break by id. `N` defaults to 8 (`--recent N`). This is
the cheap diversity weighting the task allowed for: it steers consecutive picks
toward new states/categories without a heavy optimizer. **Follow-up (flagged, not
built):** truly maximizing spatial spread (e.g. PostGIS distance from recent
pins) would be a richer approach than the state/category set-difference used
here.

### featured_at column

`featured_at timestamptz` is added as a **curation snapshot column**, the same
posture as `master_place.state` and `photo_url`: it is **not** wired into
`recompute_master_place()`, so recompute never sets or clears it and the stamp
survives every recompute. It is written only through
`set_master_place_featured_at()`. Seeding `field_precedence` to make it a
recomputed field is a product decision reserved for Adam — deliberately not done.

> The migration is written and typechecks but was **not applied** in the build
> session (no DB password / linked CLI available). Apply to TEST with
> `npm run -w data db:push-verify -- --test`. Until then, `select`/`generate`
> still run (they tolerate the missing column); only `--commit` needs it.

---

## GENERATE

`potw:generate --id <uuid>` (or `--from-select`) writes, per place, to
`data/pin-of-the-week/output/<slug>/`:

- `caption.txt` / `caption.json`
- `image-prompt.txt` / `image-spec.json`
- `place.json`
- `image.png` (only when a render key is present — see below)

### Caption format (hook → payoff → CTA)

```
<HOOK>            category-flavored opener + place name

<BODY>            verbatim excerpt of the real description (no invented facts)

<PAYOFF>          ✅ Yo Trippin Verified — cross-checked against <official sources>
                  (the "rating" slot, grounded in verification, NOT a star rating)

<CTA>             save-this-pin + plan-with-Yo-Trippin + engagement question

<HASHTAGS>        overlanding + category + state
```

An optional `--llm` mode rewrites only the hook/body into brand voice via the
Anthropic SDK, **constrained to add no new facts**, and falls back to the
deterministic template when no `ANTHROPIC_API_KEY` is set.

### Image (Nano Banana)

"Nano Banana" is Google's Gemini image model (`gemini-2.5-flash-image`). No image
pipeline existed, so `nano-banana.ts` is the net-new adapter: an **image-to-image**
render that sends the place's real `photo_url` as the hero reference plus the
brand prompt composed from `DESIGN.md` tokens (base `#0a0b0c`, amber accent
`#c8a96e`, Space Mono / Barlow / Barlow Condensed, 4:5 portrait). It renders only
when `GEMINI_API_KEY` / `GOOGLE_API_KEY` is set; otherwise it dry-runs so the
rest of the pipeline still produces reviewable artifacts.

> In the build session no valid render credential was available (Viewmax needs a
> paid plan; the repo's `GOOGLE_PLACES_API_KEY` is service-restricted and
> returns `API_KEY_SERVICE_BLOCKED`). The adapter was verified end-to-end up to
> the API call — it fetched the real reference photo, built the multimodal
> request, and surfaced the live 403. A properly-scoped key renders the image
> with no code change.

---

## Confidence notes (per the task's request)

- Eligibility counts, `with_numeric_rating: 0`, the 161,431 row total, and the
  selected candidate: **literal / directly computed** against TEST this session.
- `rating` NULL corpus-wide, `featured_at` absent, photo/description/recompute
  semantics: **directly verified** in the migrations + a live query.
- The caption format and image style guide: **authored this session** (no prior
  standard existed) — first drafts, flagged as such.
- That a properly-scoped Gemini key renders the image cleanly: **strong
  inference** — the request path is verified to the point of the auth failure,
  but a successful render was not observed.
