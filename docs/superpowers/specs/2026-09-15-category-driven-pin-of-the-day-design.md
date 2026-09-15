# 2026-09-15 — Category-driven Pin of the Day (Sheet-only) — design

> **STATUS: DESIGN, NOT BUILT.** Nothing in this document is implemented. It is
> the agreed design for Adam's review before an implementation plan is written.

## Problem

Two things are hardcoded in the Pin of the Day pipeline, and both are wrong for
any category other than campground:

1. **The overlay art is a single file.** `composite.ts` loads one
   `brand/header.png`, and the category chip ("Campground") is **painted into
   that artwork** — the code never draws a category `[verified: read
   `composite.ts`; it draws only the place name and region line]`. Every post
   therefore says "Campground" regardless of what the place is. Two posts made
   on 2026-09-14 demonstrate it: Blind Island is a `facility` and Queens Garden
   Trailhead is a `trailhead`; both published with a "Campground" chip.
2. **The captions are one flat list.** `caption.ts` exports a single
   `CAPTION_TEMPLATES` array of 12, shared by every post regardless of subject.

Adam wants to expand beyond campgrounds — scenic first, others later — with each
category carrying its own overlay art and its own voice, driven from the Google
Sheet that already builds posts.

## Scope decision: Sheet-only

**The Google Sheet flow (`from-sheet.ts`) is the only flow this touches.**
`caption.ts` and the database flow (`potw:select` / `potw:generate`) are NOT
modified.

This was the pivotal decision. It removes:

- any change to `CAPTION_TEMPLATES`, an interface shared by two flows,
- the need for a per-category LRU rotation column and its migration,
- all risk to the DB path.

**Consequence, accepted:** the DB flow keeps the wrong-chip bug. A trailhead
generated via `potw:generate` will still say "Campground". That is knowingly
left broken.

## The model

**A category is a pair of tabs. The tab name is the category.** There is no
registry, no enum, and no category column — nothing to keep in sync, and nothing
to typo per row.

| Tab | Purpose | Shape |
|---|---|---|
| `<category> posts` | the queue | `photo_url · place · state · country · posted` |
| `<category>` | its look and voice | `art_url` in B1; then `n \| template` from row 3 |

Live example (already built at the sheet below): `campground posts`,
`campground`, `scenic posts`, `scenic`.

Adding a category is three spreadsheet actions and **no repo change**:

1. Duplicate both campground tabs → `scenic`, `scenic posts`
2. Set `scenic`'s `art_url` and rewrite its 12 captions
3. Add rows to `scenic posts`

### Caption templates

Same three tokens as today — `{place}`, `{category}`, `{state}` — interpolated by
the existing `interpolate()`. Twelve is a convention, not a rule: rotation wraps
at however many templates the tab defines, so a category can start with four.

`{category}` renders the humanized label derived from the tab name (`scenic` →
`Scenic`), matching today's `categoryLabel()` behaviour.

### Rotation

Per category, by row order within that category's queue. The third scenic post
uses scenic template 3, independent of what campground is doing. No shared
counter, no database.

## Sheet access — measured mechanics

All of the following were **measured on 2026-09-15** against the real sheet, not
assumed. They are the load-bearing facts of this design.

**Endpoint.** `https://docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&headers=0&sheet=<tab>`

- Fetch **by tab name works**, including names containing spaces
  (`campground%20posts`) — HTTP 200 with that tab's own content `[measured, all
  four tabs]`. The existing code's `gid`-based `/export?format=csv` cannot
  address tabs by name and is replaced for this flow.
- The sheet must be shared **"anyone with the link can view."** Before sharing,
  every endpoint returned **HTTP 401** `[measured]`.

**⚠️ Trap 1 — a missing tab does NOT error.** `?sheet=nosuchtab` returns
**HTTP 200 containing the first tab's data** `[measured; reproduced twice, once
with a genuinely absent name and once with a tab that had been renamed away]`.

A typo'd or renamed tab therefore yields plausible, wrong content rather than a
failure — scenic's build would silently receive campground's queue. This is the
same failure class as the wrong chip: silently wrong is worse than loudly broken.

**Mitigation (to be verified during implementation):** once per run, probe a
deliberately bogus tab name to capture the fallback payload, then reject any
requested tab whose payload is identical to it. No sheet-side clutter, and a
typo cannot defeat it. `[UNVERIFIED — designed, not yet tested]`

**⚠️ Trap 2 — gviz invents headers.** Without `headers=0`, gviz merged rows 1 and
3 of a category tab into a single fused header: `"art_url n"` and
`"…campground.png  template"` `[measured]`. **`headers=0` is mandatory on every
fetch.**

**Photo and art sources.** `photo_url` and `art_url` each accept an http(s) URL
**or a local file path** — `from-sheet.ts` already supports local paths for
photos. Adam's campground `art_url` is currently a local path
(`/Users/adamwagner/yoTrippin_assets/instagram/camping/overlay/campground.png`),
which means **the build is not portable off his machine**. Accepted, noted.

## The build

### Validation gate — all rows, before any rendering

Nothing renders until every one of these passes. One failure produces **zero
output** and a precise, row-referenced error list. No partial batches, and no
silent fallback to campground art.

1. every `<x> posts` tab has a matching `<x>` tab
2. no tab fetch fell back to the first tab (Trap 1 guard)
3. every `art_url` resolves, is an **image content-type**, and is **1080×1350**
4. every category has at least one caption, numbered contiguously from 1
5. every template uses only `{place}`, `{category}`, `{state}`
6. every queued row has a `place` and a `photo_url`

Check 3 is deliberately strict about content-type and dimensions: a Google Drive
*share* link returns an HTML page, not a PNG, and a 200 response alone would let
it through to the compositor.

### Per row

- **image** — the photo, composited under that category's `art_url` overlay
- **title** — place name, auto-fit, plus the "State, Country" region line
- **caption** — that category's template *n*, interpolated

Art is fetched **once per category per run**, not once per row.

### Output contract

One folder per post:

```
<out>/<category>/<slug>/
  image.png      1080×1350 composite
  caption.txt    the interpolated caption, verbatim
  meta.json      category, template n, art_url used, source row, place/state/country
```

`meta.json` records the `art_url` because art lives behind a URL that can change:
the rendered `image.png` preserves what was published, and `meta.json` records
what produced it.

**The auto-attach invariant:** staging reads `image.png` and `caption.txt` from
this folder and transports the caption **verbatim**. The staging step never
composes, edits, trims, or re-wraps caption text. This is what makes captions
attach to the post automatically, and it is a hard rule.

## Posting flow

`/pin-of-the-day <category>`:

1. next row in `<category> posts` where `posted` is empty — **row order is the
   queue**
2. build it (above)
3. stage on Instagram per the skill's step 9 — upload, Original crop, paste
   caption, screenshot
4. **STOP at the confirmation gate.** Publishing requires a fresh explicit yes,
   and the cross-post-to-Facebook state is named in the question. This is
   unchanged from the current skill and is not negotiable.
5. on an explicit yes → Share, then write today's date into that row's `posted`
   cell
6. queue empty → say so and stop. **Never wrap around and repeat a post.**

**Write-back mechanics.** The CSV endpoint is read-only, so `posted` is written
through the browser. Filling cells programmatically was measured on 2026-09-15:
`Input.insertText` does **not** reach the Sheets canvas grid, but a **synthetic
`paste` event carrying TSV does**, and fills a whole range in one dispatch
`[measured — three methods compared; insertText failed, paste and character-level
key events both worked]`.

If the browser is unavailable, the build reports which row to tick rather than
losing track of it.

## Explicitly out of scope

- **The DB flow.** Unchanged, and keeps the wrong-chip bug.
- **Producing the artwork.** Each category needs a 1080×1350 overlay with its
  chip baked in. That is design work; a typo in a chip means re-exporting the PNG.
- **Recurrence protection across flows.** The Sheet flow does not stamp
  `featured_at`, so a place posted from the Sheet can still be picked later by
  the DB flow. Pre-existing gap, unchanged here.
- **Caption copy review.** Copy now lives in the Sheet, outside git: no diff, no
  review, no test catching a bad token before it renders. Validation catches
  structural errors only. This tradeoff was raised and accepted.

## Open inputs (not blocking implementation)

- `scenic`'s `art_url`
- `scenic`'s 12 captions

## Reference

- Sheet: `Pin of the Day — posts + categories`
  (`10d_Ho3FupLTldBpNIfnjappcOqNyAoZU0YksPYIa89U`)
- Diagram: Paper artboard *"Pin of the Day — category-driven build
  (design 2026-09-15)"* in the `Design Tokens` file
- Code this touches: `data/pin-of-the-week/from-sheet.ts`,
  `data/pin-of-the-week/composite.ts` (overlay source becomes a parameter)
- Code this must NOT touch: `data/pin-of-the-week/caption.ts`, `generate.ts`,
  `select.ts`, `posts.ts`
