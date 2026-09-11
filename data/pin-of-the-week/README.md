# Pin of the Week

Instagram content pipeline — **SELECT** a place, **GENERATE** a post
(caption + branded Nano Banana image). Posting is out of scope.

Full design, eligibility rules, measured counts, and flagged deviations:
**`docs/content/pin-of-the-week.md`**.

TEST-only. Guarded to the TEST Supabase ref; the only write is `--commit`.

```bash
# how many candidates are eligible right now, and why the rest aren't
npm run -w data potw:select -- --count

# pick one eligible place (diversity-weighted vs the last N featured picks)
npm run -w data potw:select
npm run -w data potw:select -- --commit        # also stamp featured_at

# manual photo override (persistent; generate uses it in place of the corpus photo)
npm run -w data potw:override-photo -- --place-id <uuid> --url <url> --source "..." --license "..."
npm run -w data potw:override-photo -- --place-id <uuid> --file <path> --source "..." --license "..."
npm run -w data potw:override-photo -- --place-id <uuid> --list
npm run -w data potw:override-photo -- --place-id <uuid> --clear

# generate caption + image prompt/spec (+ image if a Gemini key is set)
npm run -w data potw:generate -- --from-select
npm run -w data potw:generate -- --id <uuid> --render               # uses a photo override if one is set
npm run -w data potw:generate -- --id <uuid> --caption-template 3   # force caption template 1-8 (default rotates)
```

A **photo override** (table `master_place_photo_override`, one row per place)
swaps in your own photo for a place; `generate` uses it in place of the
corpus-resolved photo and falls back to the corpus photo when none exists.
`--source` + `--license` are **required** (provenance discipline). The image is a
URL or a local `--file` (stored inline as base64). See `docs/content/pin-of-the-week.md`.

| File | Role |
|---|---|
| `eligibility.ts` | read-only eligibility model + full-corpus scan |
| `select.ts` | SELECT CLI (`--count` / `--commit` / `--recent N` / `--json`) |
| `caption.ts` | 8 fixed caption templates + interpolation + LRU rotation (pure) |
| `caption-history.ts` | template-use log read/write (`pin_of_week_caption_history`) |
| `style-guide.ts` | brand tokens (from `DESIGN.md`) + photo-treatment brief |
| `image-prompt.ts` | per-place treatment prompt + overlay-text spec |
| `nano-banana.ts` | step 1 — Gemini `gemini-2.5-flash-image` photo treatment (no text; magic-byte mime detect; dry-runs without a key) |
| `composite.ts` | step 2 — composites the real header asset + caption bar via `@napi-rs/canvas`, real name + `DESIGN.md` fonts |
| `photo-override.ts` | manual per-place photo override read/write (`master_place_photo_override`) |
| `override-photo.ts` | override CLI (`--url` / `--file` / `--source` / `--license` / `--list` / `--clear`) |
| `brand/header.png` | the REAL brand header asset (yellow/coral bands + "yoTrippin!" wordmark), drawn full-width |
| `fonts/` | bundled OFL fonts (Space Mono, Barlow, Barlow Condensed) |
| `generate.ts` | GENERATE CLI — checks for a photo override, writes `base.png` + `image.png` to `output/<slug>/` |

**Two-step image pipeline:** Nano Banana renders the graded hero photo with **no
text**, then the **real brand header asset** (`brand/header.png`) and the black
caption bar are composited deterministically with the real place name from
SELECT — so the name is spelled exactly, the header colors/wordmark are the true
brand asset (not approximated), and the caption typography is the real brand
fonts. See `docs/content/pin-of-the-week.md`.

Exposure: `PHOTO_TREATMENT_BRIEF` renders the photo **bright/natural** (the earlier
dark grade was dropped); the bottom scrim darkens only the caption area.

Requires the `featured_at` column:
`supabase/migrations/20260910140000_master_place_featured_at.sql`
(apply to TEST via `npm run -w data db:push-verify -- --test`).
