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

### Image — two-step pipeline (photo treatment → deterministic composite)

The image is built in **two steps** so the place name is always spelled exactly
and the typography is the real `DESIGN.md` fonts. This replaced the earlier
single-step "let the model draw the text" approach, which garbled the name
(PR #407: "Cameground"/"Prairre"; a retry gave "Camprgound") — image models do
not reliably render exact long text or hit specific fonts.

1. **Nano Banana photo treatment (`nano-banana.ts`)** — "Nano Banana" is Google's
   Gemini image model (`gemini-2.5-flash-image`). It performs an **image-to-image**
   enhancement of the place's real `photo_url` into a **bright, natural** look
   (preserving true daylight exposure — no darkening; the earlier dark/moody grade
   was dropped so the top of the frame reads at full brightness).
   The prompt (`PHOTO_TREATMENT_BRIEF`) contains **NO text instructions** — it
   explicitly forbids any letters/logos/overlays, so the model only produces the
   graded photo (`base.png`). `generationConfig.imageConfig.aspectRatio` forces
   the portrait shape (without it the model inherits the landscape reference's
   aspect — verified 2026-09-10).
2. **Deterministic chrome (`composite.ts`)** — `@napi-rs/canvas` draws the brand
   chrome over the treatment at exactly `1080×1350`: the **real brand header
   asset** full-width at the top (see below) and the **black caption bar** at the
   bottom, which uses the **real place name straight from the SELECT row** (never
   model text) in the bundled fonts (Barlow Condensed 700 title, Barlow subline)
   with the amber `#c8a96e` accent on the "Verified" mark. Fonts are bundled under
   `pin-of-the-week/fonts/` (OFL) so rendering is identical on any machine.

Renders only when `GEMINI_API_KEY` / `GOOGLE_API_KEY` is set; otherwise the
render step dry-runs and the caption/prompt/spec artifacts are still written.

#### Verified render (2026-09-10, billed key) — blocker resolved

A real two-step render of *Gold Bluffs Beach Campground* succeeded and both
stages were **visually inspected** against `DESIGN.md`. Samples:
`output/gold-bluffs-…/base.png` (treatment) and `.../image.png` (final).

- **Step 1 `base.png`** — clean graded photo of the real campsite, **zero text /
  logos / graphics**. Confirms text is kept out of the model. *Literal /
  visually verified.*
- **Step 2 `image.png` — place name pixel-correct.** Renders
  "Gold Bluffs Beach Campground - Prairie Creek Redwoods State Park" spelled
  **exactly** as the source row — the PR #407 garbling is gone. *Literal /
  visually verified.*
- **Title typography exact** — Barlow Condensed 700 title (wrapped to two lines),
  Barlow subline. *Literal / visually verified.*
- **Bottom caption bar** — near-black scrim whose gradient **ends 33% up from the
  bottom** (covers only the bottom third, fading out at that line), caption in the
  lower third, 4:5 portrait (1080×1350). Order is **subline ("Category, State")
  ABOVE the title**; the standalone "Verified" line was removed (verification is
  in the header badge now). *Literal / visually verified.*

#### Brand header — the REAL asset (2026-09-10, corrected)

The header is the **actual brand asset**, composited directly — not a
recreation. Earlier passes approximated the bands with hex guesses and a
stand-in rounded font (Baloo 2); that has been **removed entirely**.

- **Source asset** `assets/socailmedia/branding.png` (folder misspelled
  "socailmedia"; the `assets/social media/` path does **not** exist). The operator
  has iterated on it; the current version is a **1080×148 horizontal header
  strip** that now includes the **verified badge** — a **green filled circle with
  a white checkmark** left of the **"yoTrippin!"** wordmark, followed by
  **"verified"** in a lighter weight. Bands: **yellow** (`#fdc930`),
  **coral/brick-red** (`#cf3c2a`), **dark** strip (`#42363c`). *Confidence:
  literal / pixel-sampled + visually verified.*
- **The badge + "verified" are part of the real asset — NOT built as fresh UI.**
  The checkmark circle and "verified" text are baked into `branding.png`, so they
  match the reference exactly (they are the reference asset). *Confidence: literal
  / visually verified.*
- It is bundled at `brand/header.png` and drawn full-width across the top
  (`drawHeader` in `composite.ts`), preserving aspect (1080-wide → 148 tall).
  Because it is the real image, the **colors, wordmark, badge, and font are exact,
  not approximated**. *Confidence: literal / visually verified.*
- This replaced the old "PIN OF THE WEEK" kicker and every prior approximated
  header. The removed pieces: the from-scratch `drawHeader` bands + `BRAND.header`
  hexes, the Baloo 2 font (`Baloo2-VF.ttf`), and the interim PNG-extraction path
  (`extract-wordmark.ts`).
- The **"Yo Trippin" brand label was removed from the bottom caption bar** (brand
  now lives only in the header; the reference omits it). *Flagged deviation from
  a literal "bottom stays as-is".*

#### Exposure — fixed (2026-09-10)

Earlier renders were underexposed because `PHOTO_TREATMENT_BRIEF` asked for a
"dark, cinematic, moody" grade (measured: `base.png` upper sky **57/255**, mid
**20/255**, foreground **13/255** — the darkness was the base output, not the
scrim). The brief was rewritten to **bright/natural, no darkening**. Re-measured
after the change: `base.png` upper sky **226/255**, mid **196/255**, foreground
**96/255** — the top of the frame now reads at full brightness, matching the
reference. *Confidence: literal / directly verified (pixel-measured before &
after).* The bottom scrim still darkens only the caption area (bottom third).

---

## Confidence notes (per the task's request)

- Eligibility counts, `with_numeric_rating: 0`, the 161,431 row total, and the
  selected candidate: **literal / directly computed** against TEST this session.
- `rating` NULL corpus-wide, `featured_at` absent, photo/description/recompute
  semantics: **directly verified** in the migrations + a live query.
- The caption format and image style guide: **authored this session** (no prior
  standard existed) — first drafts, flagged as such.
- The two-step render succeeds end-to-end with a billed key, is 4:5 portrait
  (1080×1350), the place name is spelled exactly, and the typography/palette
  match `DESIGN.md`: **literal / directly verified** (rendered + both stages
  visually inspected 2026-09-10).
- Text is now composited deterministically (not model-rendered), which is what
  guarantees exact spelling + fonts: **literal / directly verified** — `base.png`
  carries no text; `composite.ts` draws the SELECT row's name in the bundled
  fonts.
- The adapter is a separate, net-new implementation (no prior Yo Trippin Nano
  Banana adapter exists): **strong inference** — comprehensive negative grep
  across the repo (only Mapbox map-pin icon helpers matched).
- The header is the **real brand asset** (`brand/header.png`, from the operator's
  `branding.png`, now 1080×148 with the verified badge) composited full-width —
  colors, wordmark, and badge are exact, not approximated: **literal / visually
  verified + pixel-sampled** (2026-09-10).
- The photo exposure was fixed by rewriting `PHOTO_TREATMENT_BRIEF` to bright/
  natural: **literal / directly verified** — `base.png` upper-sky 57→**226**/255
  after the change; the scrim still darkens only the bottom third.
