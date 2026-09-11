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

### Caption — 8 fixed templates (rotated)

The IG caption is one of **8 fixed templates** (`caption.ts`, `CAPTION_TEMPLATES`),
each interpolating `{place}` / `{category}` / `{state}` from the selected place.
The caption text goes to `caption.txt` / `caption.json` — it is **NOT** burned
into the composited image (the image shows only the place name + "Category ·
State"; verified in `composite.ts`). This replaced the earlier hook→payoff→CTA
composer and the `--llm` rewrite.

- **`{category}`** uses the humanized label ("Campground", "Park Feature") — the
  same one on the image subline — because the raw enum (`park_feature`) reads
  unnaturally in the sentences.
- **Rotation:** by default the generator picks the **least-recently-used**
  template (`pickLruTemplate`) from a durable history table
  (`pin_of_week_caption_history`, migration `20260911010000`), then logs the
  pick. This is the caption-level analog of how `featured_at` tracks place
  history — but because a template is chosen *per generate* and the rotation is
  *global*, it is a small append-only log table, not a per-place column. LRU
  guarantees no immediate repeat and cycles evenly through all 8.
- **Force a template:** `--caption-template N` (1–8). Forced picks are **not**
  logged (they are a manual/test override), so they don't perturb the rotation.
- The history table tolerates being absent (migration not applied) — generate
  still runs, just without rotation/persistence.

#### Edge cases

- **Null state — FIXED (2026-09-11).** When `state` is null (~788 eligible
  places), `interpolate()` drops the `{state}` token *together with its leading
  separator* (" · " / " in " / ", "), so there is no dangling "· ." / "in ." /
  ", .". Verified on a real null-state place (*Beaverhead Rock State Park*,
  `park_feature`) across all three separator styles:
  - #1 → "…so you don't have to guess. Park Feature. Want the full route notes…"
  - #4 → "…verified stop: Beaverhead Rock State Park. Park Feature. We're building…"
  - #6 → "…Beaverhead Rock State Park. Park Feature, checked before it made the feed…"
  *Confidence: literal / directly verified (real place, tests cover all 8).*
- **Category/name redundancy — LEFT (awkward-but-readable, not broken).** When a
  place name already contains a category-like word, the separate `{category}`
  label repeats it — e.g. *Beaverhead Rock State **Park*** + category "**Park**
  Feature" → "…State Park. Park Feature." Softening reliably would require either
  dropping `{category}` (breaks the fixed template sentence structure) or
  rewording the verbatim templates — both worse than the mild repetition, and
  detecting "close overlap" is a fragile heuristic. Left as-is per the task's
  judgment call; confirmed it produces readable (not broken) output.
  *Confidence: literal / observed.*
- **Long place names** make some templates wordy (a 63-char name in template 1 is
  a mouthful before the first period) — grammatical, but long. *Literal /
  observed.*

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

### Manual photo override

`potw:override-photo` lets you pin your own photo to a place; `generate` uses it
in place of the corpus-resolved photo and falls back to the corpus photo when
none exists.

- **Storage — a dedicated table `master_place_photo_override`** (migration
  `20260911000000`), one row per place (PK = `master_place_id`). *Why a table,
  not a column on `master_place`:* `master_place` is written only by
  `recompute_master_place()` and its columns are precedence-resolved
  source-of-truth; a hand-picked override is neither. This mirrors the
  `master_place_photo_candidate` precedent (20260901000600). Unlike
  photo_candidate (never read by a live path), this table **is** read — but only
  by the Pin of the Week generator, **not** by the corpus read paths, so the
  corpus boundary is unchanged.
- **Provenance required:** `source` + `license` are `NOT NULL` (free text);
  `attribution` optional — the same discipline as the photo-backfill pilot,
  applied to manual overrides too.
- **Image:** a URL (`--url`) or a local file (`--file`, stored inline as base64
  in `image_data` + `mime_type`). A CHECK enforces exactly one. *Why inline bytes
  for `--file`:* the existing photo patterns are URL-only because they come from
  web sources; a local file has no URL, so rather than stand up a Supabase
  Storage bucket (new infra), the bytes are stored inline — self-contained and
  durable. **Flagged scale-up path:** move `--file` uploads to Storage (URL-only)
  if overrides become large or numerous.
- **Eligibility:** an override makes the "has photo" check pass (generate
  re-evaluates with the override photo), so a place whose only problem was a
  missing photo becomes featurable; all other eligibility rules still apply.
- **CLI:** `--place-id` + (`--url` | `--file`) + `--source` + `--license`
  [+ `--attribution`] to set; `--list` to show; `--clear` to remove.

Verified end-to-end on TEST (2026-09-11, all *literal / directly verified*):
- migration applied via `db:push-verify -- --test`; table existence + the
  one-source CHECK confirmed by direct query (DDL is "not verified" by the v1
  migration verifier, so this was checked independently).
- `--url` override on **Boulder Basin** → `generate --render` produced a post
  showing the override photo (a lighthouse) under the "Boulder Basin" caption;
  `--clear` → `generate` fell back to the corpus campground photo.
- `--file` override on **Point Bonita** (local image, stored inline) →
  `generate --render` used the uploaded bytes; then cleared. 0 override rows
  remain on TEST.

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
