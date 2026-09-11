# Pin of the Week

Instagram content pipeline — **SELECT** a place, **GENERATE** a post
(caption + branded Nano Banana image). Posting is out of scope.

Full design, eligibility rules, measured counts, and flagged deviations:
**`docs/content/pin-of-the-week.md`**.

TEST-only. Guarded to the TEST Supabase ref; the only write is `--commit`.

```bash
# how many candidates are eligible right now, and why the rest aren't
npm run -w data potw:select -- --count

# pick one eligible place (ranked: diversity-weighted vs the last N featured picks)
npm run -w data potw:select
npm run -w data potw:select -- --commit        # also stamp featured_at

# MANUAL selection by id or name (same eligibility checks; ineligible picks reported + exit 1)
npm run -w data potw:select -- --place-id <uuid> [--json] [--commit]
npm run -w data potw:select -- --search "gold bluffs"    # one match selects; several are listed

# manual photo override (persistent; generate uses it in place of the corpus photo)
npm run -w data potw:override-photo -- --place-id <uuid> --url <url> --source "..." --license "..."
npm run -w data potw:override-photo -- --place-id <uuid> --file <path> --source "..." --license "..."
npm run -w data potw:override-photo -- --place-id <uuid> --list
npm run -w data potw:override-photo -- --place-id <uuid> --clear

# generate caption + branded image
npm run -w data potw:generate -- --id <uuid>                        # caption + spec only
npm run -w data potw:generate -- --id <uuid> --render               # + image from the REAL photo (no key needed)
npm run -w data potw:generate -- --id <uuid> --treat                # + AI-graded image (optional; needs Gemini key)
npm run -w data potw:generate -- --id <uuid> --render --caption-template 3

# POST HISTORY — record an approved post, then browse / re-open past ones
npm run -w data potw:posts -- --record --from pin-of-the-week/output/<slug>  # DB row + committed archive
npm run -w data potw:posts -- --list [--json]                       # recorded posts, newest first
npm run -w data potw:posts -- --reuse <id> [--json]                 # show a past post (metadata + archive paths)
```

The interactive **`/pin-of-the-day`** skill (`.claude/skills/pin-of-the-day/`)
orchestrates SELECT → (override) → GENERATE → mark-used → record over these
CLIs, one post at a time. `potw:posts --record` reads the generator's own
`place.json` + `caption.json` from `--from`, inserts a `pin_of_the_day_post`
row, and copies `image.png` + a self-contained `manifest.json` into the
**committed** archive `pin-of-the-week/posts/<date>-<slug>/` (unlike the scratch
`output/` dir). Only metadata lives in the DB; the image lives on disk.
`--reuse` is show-only (no re-render, no writes).

Manual and ranked picks share the same eligibility gate and the same
`set_master_place_featured_at` commit path; `generate --id <uuid>` feeds a manual
pick into the composite pipeline. `--search` is a case-insensitive substring
match on `canonical_name` — an **unindexed sequential scan**, fine for occasional
CLI use, not a hot path.

The image is the **real corpus (or override) photo** composited under the brand
header + caption bar — **no AI/API key by default** (the compositor cover-fits
the photo to 4:5). `--treat` optionally runs a Gemini re-grade/reframe first.

A **photo override** (table `master_place_photo_override`, one row per place)
swaps in your own photo for a place; `generate` uses it in place of the
corpus-resolved photo and falls back to the corpus photo when none exists.
`--source` + `--license` are **required** (provenance discipline). The image is a
URL or a local `--file` (stored inline as base64). See `docs/content/pin-of-the-week.md`.

| File | Role |
|---|---|
| `eligibility.ts` | read-only eligibility model + full-corpus scan + by-id / by-name lookups |
| `select.ts` | SELECT CLI — ranked or manual (`--place-id` / `--search` / `--count` / `--commit` / `--json`) |
| `caption.ts` | 8 fixed caption templates + interpolation + LRU rotation (pure) |
| `caption-history.ts` | template-use log read/write (`pin_of_week_caption_history`) |
| `style-guide.ts` | brand tokens (from `DESIGN.md`) + photo-treatment brief |
| `image-prompt.ts` | per-place treatment prompt + overlay-text spec |
| `nano-banana.ts` | OPTIONAL Gemini `gemini-2.5-flash-image` photo treatment (`--treat`; not used by default) |
| `composite.ts` | composites the real photo + header asset + caption bar via `@napi-rs/canvas`, real name + `DESIGN.md` fonts |
| `photo-override.ts` | manual per-place photo override read/write (`master_place_photo_override`) |
| `override-photo.ts` | override CLI (`--url` / `--file` / `--source` / `--license` / `--list` / `--clear`) |
| `post-history.ts` | post-history read/write + artifact→row mapping (`pin_of_the_day_post`) |
| `posts.ts` | POST CLI — `--record --from <dir>` / `--list` / `--reuse <id>` (Pin of the Day) |
| `brand/header.png` | the REAL brand header asset (yellow/coral bands + "yoTrippin!" wordmark), drawn full-width |
| `fonts/` | bundled OFL fonts (Space Mono, Barlow, Barlow Condensed) |
| `generate.ts` | GENERATE CLI — checks for a photo override, writes `base.png` + `image.png` to `output/<slug>/` |

**Image pipeline:** the real corpus (or override) photo is composited under the
**real brand header asset** (`brand/header.png`) and the black caption bar, with
the real place name from SELECT — name spelled exactly, header colors/wordmark
are the true brand asset, caption typography is the real brand fonts. No AI by
default (`--render`); `--treat` optionally re-grades the photo via Gemini first.
See `docs/content/pin-of-the-week.md`.

Exposure: `--treat`'s `PHOTO_TREATMENT_BRIEF` renders the photo **bright/natural** (the earlier
dark grade was dropped); the bottom scrim darkens only the caption area.

Requires the `featured_at` column:
`supabase/migrations/20260910140000_master_place_featured_at.sql`
(apply to TEST via `npm run -w data db:push-verify -- --test`).
