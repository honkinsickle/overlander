# Full refresh — the `resolvePlaces()` Paper diagram

**Date:** 2026-09-03
**Branch:** `refresh-resolver-diagram`, cut from `origin/main` at **`0dae80c`**
(`fix(er): matcher category-compatibility gaps + wide-radius rescue routing (#365)`)
**Mode:** DIAGRAM-ONLY. No code changes. One TEST read (column population
counts, read-only). `npm install` + two `node:test` runs, both read-only.

**Target:** node `3R4-0`, *"resolvePlaces() — verified current state"* /
*"resolvePlaces() — built vs. wired, as it stands today"*, Paper file **"Card
data model and ofrmation"**.

**Source of truth for this pass:** #361 (three-surface trace), #364 (category
× source audit), #366 (live-coverage sampling), #367 (re-verify Aug 25
findings) — all still open, unmerged PRs at the time of this pass. Every claim
below was **re-checked directly against current `main`** (grep, `git log`,
executed tests, one TEST query), not copied from those reports' prose, per the
standing lesson in this thread: source-checking catches real errors,
introspection invents them.

A prior, narrower pass (referenced in the diagram's own history, commit
`60f2b226` on the `reverify-aug25-findings` branch) had already landed changes
in isolation. Diffing the diagram's state at the start of this session against
its state after that pass shows exactly 3 differences: the LIVE sources box
(added Mapbox), the Day Column badge (`NOT WIRED` → `NO ENDPOINT`), and the
resolver-suite count (36/36 → 43/43). This pass verifies those still hold and
updates everything else.

---

## What was verified, and what changed on the diagram

### 1. `resolvePlaces()` importers — was "additive only — imported by nothing"

**Fresh grep, `web/src` + `web/scripts`:** 3 importers in `src/app`, 0 in
`src/components`:

| File | Imports |
|---|---|
| `app/api/trip-browse/[tripId]/[dayId]/handler.ts:30` | `resolvePlaces` (direct) |
| `app/api/search-area/handler.ts:32` | `resolvePlaces` (direct, destructured with `LIVE_SLIDE_FOR_PRIMARY`) |
| `app/api/places/details/handler.ts:23` | `enrichByGoogleId` (different export, same module) |

`grep -rl "resolve-places\|resolvePlaces" web/src/components` returns nothing.

**Diagram change:** the line now states the importer split by file, and its
color changed from the warning-red it had (`#E08872`) to the box's normal body
color — it is no longer a red flag, just a fact.

### 2–3. Date Detail / Search / Day-scoped browse wiring, and the three flags

All three cutover flags are real `process.env` reads, confirmed by grep:

- `SEARCH_AREA_USE_RESOLVER` — `app/api/search-area/route.ts:34-35`
- `TRIP_BROWSE_USE_RESOLVER` — `app/api/trip-browse/[tripId]/[dayId]/route.ts:39-40`
- `DATE_DETAIL_USE_RESOLVER` — `app/api/places/details/route.ts:35-36`

None is set in `web/.env.local` or `web/.env.development.local` — all three
default OFF locally (Vercel's environment is not readable from the repo; this
makes no claim about it).

The cutover commits are all real, all ancestors of `origin/main`, all
committed 2026-08-23 PDT (re-verified via `git log`, not copied):

| PR | Commit | Committer date (PDT) |
|---|---|---|
| #255 (tiering) | `476f052` | 2026-08-23 13:05:49 |
| #256 (tiering) | `d7faf5e` | 2026-08-23 13:14:10 |
| #259 (hydrate fix) | `9c212a6` | 2026-08-23 14:14:23 |
| #260 (Search cutover) | `d62f660` | 2026-08-23 14:30:48 |
| #266 (Date Detail cutover) | `a086cb8` | 2026-08-23 16:15:51 |
| #267 (Day Column plan — no cutover) | `4757067` | 2026-08-23 16:28:06 |
| #269 (Day-scoped browse cutover) | `b227e65` | 2026-08-23 17:07:07 |

All seven hashes and dates pulled fresh this pass via `git log --format`, not
copied from #367.

**So all three surfaces already call `resolvePlaces()` (or `enrichByGoogleId`)
when their flag is on.** They are wired, not unwired — the previous "NOT
WIRED" badges were stale (this matches #367's finding, independently
reproduced here).

**Diagram change:** all three badges flipped from `NOT WIRED` (implying no
code path exists) to `WIRED · FLAG OFF` (code path exists, gated, default
off). Each box gained a caption naming its flag and cutover PR
(e.g. `SEARCH_AREA_USE_RESOLVER, default off locally — #260 merged
2026-08-23`), matching the caption Search's box already had. The stale
`CORRECTION` callout ("no SEARCH_AREA_USE_RESOLVER flag exists") was rewritten
as `FLAGS`, stating the real, current state of all three.

### 4. Shared client cache — reconfirmed still NOT BUILT

- `web/package.json` has no `swr` / `react-query` / `@tanstack` / `apollo` /
  `urql` dependency.
- No cache keyed by canonical id anywhere — `resolve-places.ts` and
  `place-id.ts` mention "cache" only in doc comments describing the absence
  (`resolve-places.ts:20-22, 538-539`; `place-id.ts:171`).
- The only caches that exist are three per-route, server-side, in-process ones
  in the three route handlers — the opposite of the ADR's per-client, shared,
  canonical-id-keyed design.

**Diagram change:** none — this box was already accurate.

### 5. `rating` / `review_count` / `price_tier` / `photo_url` — GAP note nuance

**Measured fresh on TEST** (`master_place`, non-null counts):

| column | non-null rows |
|---|--:|
| total rows | 161,431 |
| `rating` | 0 |
| `review_count` | 0 |
| `price_tier` | 0 |
| `photo_url` | 10,311 |

`resolve-places.ts:27-29` confirms neither corpus reader (`hydrate.ts:72-73`
base select, `:87` export-view select) selects any of the four. So the
original claim ("real columns, unselected") is still literally true, but three
of the four are empty by design — nothing is lost by not selecting them.
`photo_url` is the one column carrying real, currently-unread data.

**Diagram change:** the GAP note now states the 161,431 / 0 / 0 / 0 / 10,311
split and says plainly that only `photo_url` is the actual gap.

### 6. Polyline / curved-route support — reconfirmed unsupported; **added to the diagram**

This item had **no corresponding element on the diagram at all** — it isn't a
stale box, it's a missing one. Verified fresh:

- `resolve-places.ts:114-120` — `day-corridor` scope is still
  `{ start: Coord; end: Coord; ... }`, two points.
- `federated.ts:305-307` — `fetchFederatedPois` builds "the SAME straight
  day-segment LineString ... start→end — exact parity with the current
  corridor, not the real per-day polyline (deferred)."
- `bake-corridors.ts:122` — `fetchCorpusForPolyline` takes a real
  `coordinates: [number, number][]` array and is used by the generation path
  (`itinerary/facts.ts:24,238`), not by `resolvePlaces()`.
- `docs/BACKLOG.md:760` — the migration item is still present, still marked
  deferred.

**Diagram change:** added a new `POLYLINE` callout under the four-surface row,
citing the same evidence above and the open backlog line.

### 7. Day Column — reconfirmed already correct, plus one clarity fix

`docs/architecture/resolve-places-day-column-cutover-plan.md` confirms Day
Column is a **passive renderer of the baked `Trip.days` JSONB**, calls no live
endpoint, and the plan explicitly recommends against a cutover PR. Closed by
PR #267 (`4757067`, merged 2026-08-23 16:28:06 PDT). The diagram's `NO
ENDPOINT` badge (added in the prior pass) already reflects this correctly.

**Diagram change:** recolored the badge and box border from amber
(`#C77429`, shared with the "wired, flag off" boxes) to a neutral steel gray
(`var(--steel-400)`), and added a matching swatch to the legend. "No endpoint
to wire" and "wired but flagged off" are different claims; they no longer
share a color.

---

## Additional stale/missing items found during verification (not on the original list)

- **Header pinned no commit, only a date that had gone stale.** Updated to
  `verified against origin/main @0dae80c, 2026-09-03 — not local branch`.
- **The arrow-caption legend** ("solid = real connection today · dashed =
  proposed, not wired") was stale in the same way the badges were — dashed no
  longer means "doesn't exist," it now also covers "exists, flag-gated off."
  Reworded.
- **Structural nuance in the arrow topology, not fixed by badge text alone:**
  the dashed lines run `resolvePlaces() → (unbuilt) shared cache → four
  surfaces`. That is the ADR's proposed *future* path and is still accurate
  as a diagram of intent — but it is not how the code reaches these surfaces
  *today*. Each of the three wired surfaces actually imports `resolvePlaces()`
  (or `enrichByGoogleId`) **directly**, with no cache in between. Rather than
  redraw the arrow topology, the previously-stale Search-only `STATUS` callout
  (whose own content — "route swap not merged" — was itself stale, since #260
  merged) was repurposed into a `READING THE ARROWS` note stating this
  explicitly.

---

## Scope and limits

- Column counts are **TEST only**; PROD was not measured.
- Test run counts (43/43, 27/27) were executed fresh this pass
  (`npx tsx --test src/lib/places/resolve-places.test.ts` and
  `.../place-id.test.ts`), not copied from #367.
- This is a **diagram-only** pass. No application code, migration, or script
  was changed. One scratch verification script
  (`web/scripts/_scratch_check_master_place_columns.ts`) was written, run
  against TEST, and deleted before commit — it is not part of this PR's diff.
