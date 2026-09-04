# Reconciliation — the "Place Data — Master Reference" Paper diagram vs. current `main`

**Date:** 2026-09-03
**Branch:** `reconcile-master-reference-diagram`, cut from `origin/main` at
`d2aa785` (`feat(web): wire Auto/Repair to live Mapbox (#394)`).
**Mode:** DIAGRAM-ONLY. No code changes. Read-only re-checks of current
source and merged docs; no DB queries, no live network calls this pass.

**What this is:** the diagram built in PR #388 (still open, unmerged, based
on a now-superseded branch) had drifted behind five real merges since:
`#380`/`#382`/`#384`/`#389` (the taxonomy chain, fully merged to `main` by
`#389`), `#392` (Decision 9's actual UI removal), and `#394` (Auto/Repair
wired to live Mapbox). This pass read the diagram as it currently exists in
Paper, diffed it against `STATE.md`, `BACKLOG.md`, the decisions folder, and
the actual code, and reconciled every stale claim it found — not just the
ones named in the prompt.

**Structure verdict: kept, not restructured.** The five-section shape (data
sources / four surfaces / `resolvePlaces()` / category structure / gaps)
still fits the current model cleanly. What changed is *content* within
Section 1 (Mapbox), Section 2 (Surface 3), Section 4 (category structure —
the largest set of changes), and Section 5 (one gap resolved). No section
needed adding, removing, or reordering.

---

## Changes made, each with its confidence level

### Section 1 — Live Mapbox card

**Literal, directly verified against code this pass.** Read
`mapbox-search-box.ts` in full. It is no longer fuel-only: `MAPBOX_CATEGORY_
FOR_PRIMARY` now maps `car_repair`→`auto_repair` and `car_wash`→`car_wash`
alongside the existing gas mappings, selected by which raw primary category
was requested (`primaryCategories` threaded through `discover()`). The
module's own docstring states `repair_shop` was deliberately excluded after
being live-probed 2026-09-03 and found to return appliance/electronics
repair, not auto shops — carried into the diagram verbatim since it's a
direct quote of the source comment, not a re-derivation.

### Section 2 — Surface 3 (Find Nearby) correction callout

**Literal, directly verified against code this pass.** The diagram's own
prior claim — "zero files under this screen have changed" — is now false.
Read `find-nearby-panel.tsx`: `BUCKETS` is down to 5 groups (`SERVICE` is
gone entirely; `SUPPLY` lost Water fill and now holds only Groceries) and 10
tiles, from the original 6/13. Read `palette.ts` and `category-filter-row.
tsx`: the shared `CategoryFilterRow` (confirmed via grep to be used by both
`find-nearby-panel.tsx` and `category-browse-panel.tsx`) now iterates
`BROWSE_FILTER_CHIP_CATEGORIES`, 8 entries, not `BROWSE_CARD_CATEGORIES`'s 9.
Recolored the callout from amber (correction-in-progress) to green
(resolved) and retitled it as an update rather than a correction, since the
diagram's own history is now part of the story worth keeping visible.

### Section 4 — Category structure (the largest set of changes)

**Literal, directly verified against `palette.ts` this pass**, and this is
the section's central fact: `BROWSE_CARD_CATEGORIES` stays at 9 members
(`urban` included) — the data contract for map layers, icons, API
validation and top-picks. `BROWSE_FILTER_CHIP_CATEGORIES` is a *separate*,
new 8-member export (`BROWSE_CARD_CATEGORIES` minus `urban`) that only the
rendered chip row reads. The comment in `palette.ts` documents this as
deliberate: Decision 9 applying Decision 5's "parent assignment is a data
contract; it does not oblige a chip" rule one level up, from a subtype to a
whole parent category.

- **Section header + top-right badge:** rewritten from a single "DESIGNED,
  NOT BUILT" claim (now false for two of its constituent facts) to "MIXED —
  SEE PER-ITEM TAGS," since the section now genuinely mixes shipped and
  unshipped facts and a single badge would misrepresent one or the other.
- **The `URBAN` category chip:** added a second line, "chip removed
  2026-09-03 / data contract stays (map layer, API)" — `[literal, verified
  against `palette.ts`]`.
- **Services cluster box, Auto/Repair row:** rewritten from "the cleanest
  wiring win available" (an open gap) to "LIVE since 2026-09-03," describing
  the primary-category-aware routing mechanism. `[literal, verified against
  `mapbox-search-box.ts` + `resolve-places.ts`'s `LIVE_SLIDE_FOR_PRIMARY`,
  which maps `car_repair`/`car_wash` → `fuel` with a comment dated
  2026-09-03]`.
- **Services cluster box, Water/Showers/Dump row:** rewritten from "unresolved
  — see the callout below" to "RESOLVED 2026-09-03: removed from Find Nearby
  (#392)." `[literal, verified against `find-nearby-panel.tsx`]`.
- **The big correction callout** (previously "OPEN — NOT DECIDED"): fully
  rewritten to "RESOLVED & SHIPPED." This is the diagram's most consequential
  single change. New content states the "taxonomy stays 9, UI renders 8"
  split explicitly, and draws the distinction the prompt asked for: `urban`
  keeps a real data contract and lost only a chip, while Water fill /
  Showers / Dump stations had no top-level contract to preserve and were
  removed outright (their corpus rows are untouched, not deleted).
  `[literal, verified against `docs/decisions/2026-09-03-nine-category-
  taxonomy-canonical.md` §Decision 9, whose status line now reads "Decisions
  1–9 accepted. Decision 9's UI removal implemented [PR #392]," and against
  the code changes in #392 directly]`.
- **Culture cluster box:** left unchanged. `[literal]` `LIVE_SLIDE_FOR_
  PRIMARY` still maps `museum`/`art_gallery`/`historical_landmark` → `oddity`
  — the "§3.1" routing fix Culture needs to go live has not landed. Verified
  fresh by grep this pass, not carried forward from the old diagram.

### Section 5 — Known gaps and caveats

- **Auto/Repair row:** repurposed from a gap into a resolved item carrying a
  forward-looking lesson (the fuel/auto slide-key collision, and why a
  category sharing an existing slide key with a live source needed the
  source to become primary-category-aware rather than a plain routing-table
  add). `[literal, per the same code reads as Section 4 above]` The specific
  "lesson" framing is my synthesis of the mechanism, not a quote.
- **Museums/Galleries, Trailheads/Viewpoints, Fuel source mismatch rows:**
  left unchanged after re-checking. `[literal for Museums/Galleries — the
  `oddity` mapping above]`. `[carried forward, not re-measured, for
  Trailheads/Viewpoints and the EV/gas mismatch — #366's coverage sampling
  was not re-run this pass; nothing in the affected code paths
  (`google-places.ts`, `mapbox-search-box.ts`'s `ev_charging` mapping, which
  still resolves to `gas_station`) has changed since, so the prior
  measurement still describes current behavior, but the number itself is
  #366's, not re-derived here]`.

### `resolvePlaces()` status (Section 3) and the two legacy-fetch surfaces

**Literal, directly verified this pass, unchanged from before.** Re-grepped
all three route files: `SEARCH_AREA_USE_RESOLVER`, `TRIP_BROWSE_USE_
RESOLVER`, and `DATE_DETAIL_USE_RESOLVER` are all still real `process.env`
reads, none set in `web/.env.local` or `.env.development.local`, and no
commit has touched any of the three route files since PR #373. So: **Search
(Surface 3) and Day-scoped browse (Surface 2) are still the two surfaces on
legacy fetch logic** — the `resolvePlaces()` migration has not landed as a
default for either, and this diagram's Section 3 needed no changes.
`resolvePlaces()`'s importer count (3 in `src/app`, 0 in `src/components`),
its cache-less state, and its 2-point-only day-corridor scope were all
re-verified fresh and are unchanged.

### Header, subtitle, and sources footer

Updated the ref stamp to `@d2aa785` (from `@0dae80c`), and added `#389`,
`#392`, `#394` to both the subtitle's PR list and the footer's source index.

---

## What was NOT changed, and why

- **Section 1's other four source cards** (corpus, Google, Overpass,
  Foursquare): re-scanned for relevant recent commits; none of the merges in
  the prompt's list touch these paths. Left as-is.
- **Surface 1 and Day Column cards:** no code under `day-detail-corridor-
  column.tsx` or the Day Column render path changed in any of the five new
  merges. Left as-is.
- **The routing table's other rows** (`grocery`/`supermarket`,
  `charging_station`): confirmed still unwired via `STATE.md`'s own "Next
  steps" line on the #394 entry ("Follow-on unwired wins remain in the
  routing table"). Not independently re-probed.

## Scope and limits

- No database was queried this pass. No number on the diagram required a
  fresh DB read to update; the two DB-derived figures already on it (161,431
  / 10,311 `master_place` columns) are unchanged from when they were
  measured and are still attributed to that prior pass, not re-verified
  here.
- Live-coverage figures (Trailheads/Viewpoints, the EV/gas ratio) are
  `CITED`, not `VERIFIED THIS PASS` — carried from #364/#366, not re-run.
- Per the task's instruction, the standing self-review pass was skipped —
  this is a documentation-only change with no code or PROD impact.
