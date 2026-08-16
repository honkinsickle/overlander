# 2026-08-16 — Matcher gates `name_dominant` auto-link on `combined_confidence` (0.70 floor)

[PR #227](https://github.com/honkinsickle/overlander/pull/227) (`a17bce8` fix +
`208bbae` routing test), merged into the stacked PR
[#224](https://github.com/honkinsickle/overlander/pull/224) — **not yet on `main`**
as of this writing. Closes BACKLOG "Matcher Bug 2 — `name_dominant` bypasses
`combined_confidence`."

## Context

`matchOne`'s waterfall Step 3 (`name_dominant`, `data/entity-resolution/matcher.ts`)
auto-linked whenever `distance ≤ 500 m AND name_similarity ≥ 0.85 AND
category_compatibility ≥ 0.8` — it **never checked the resulting
`combined_confidence`**. Because `scoreMatch`'s `distance_score` clips at 100 m
(`0.4 × distance_score + 0.4 × name + 0.2 × category`), an identical-name /
identical-category pair scores exactly **0.60 beyond 100 m** and **0.70 at ~75 m**.
So at range, name + category alone cannot distinguish "same complex named differently
by two agencies" from "adjacent-but-distinct feature" — and `name_dominant` auto-linked
both, silently.

This became load-bearing on the USFS `EDW_RecInfraRecreationSites_02` campground chunk.
The **pre-fix v1 dry-run** (2,312 campground SRs; from the handoff, a prior session —
`[handoff, unverified]`): `name_dominant` produced **1,414 auto-links, of which 771 (55%)
sat below 0.70 and 213 below the 0.60 `manual_review` floor** — landing as auto-links
anyway; the `--dry-run-report`'s `auto_link_low_confidence` flag (fires `< 0.70`) counted
771. (The post-fix **v2** re-run, `[measured 2026-08-16]`, is in Consequences.) Sample
low-conf pairs from the v2 report `[measured 2026-08-16]`:
`Oak Flat Campground/Gravel Bar ↔ Oak Flat Campground` (137 m, conf 0.541),
`Billy Creek, Lower Campground ↔ Billy Creek Trailhead` (125 m) — pre-fix, these were
silent merges.

## Decision

`name_dominant` now branches on `combined_confidence` after its existing name/category/
distance gates. A new exported constant `NAME_DOMINANT_CONFIDENCE_FLOOR = 0.70`:

- **`combined_confidence ≥ 0.70` → `auto_link`** (`method='name_dominant'`), unchanged.
- **`combined_confidence < 0.70` → `manual_review`** (`method='name_dominant_low_conf'`),
  **returned directly, no fall-through.**

### Why 0.70, not 0.85 and not 0.60

For the identical-name/identical-category population `name_dominant` acts on,
`combined_confidence` is a monotonic function of distance — so a floor **is** a distance
ceiling in disguise: `0.70 ≈ 75 m`, `0.65 ≈ 87.5 m`, `0.60 = ≥100 m` (the clip floor).

- **0.85 was rejected** — for the identical-name population it maps to a ~37.5 m ceiling,
  which cuts every pair beyond the clip and makes `name_dominant` **redundant with the
  Step-5 blended fallback** (which already auto-links `≥ 0.85`). The path exists precisely
  to catch the 40–75 m identical-name band the blended formula structurally underscores.
- **0.70 keeps that band** ([0.70, 0.85) — the ~40–75 m identical-name pairs the blended
  fallback would only send to review) while routing the ambiguous ≥ ~75 m tail to a human.
  It also equals the `--dry-run-report`'s existing `low_confidence_auto_link` threshold,
  so post-fix that flag goes to **0** by construction.
- **0.65 was held in reserve** as a fallback if trailhead calibration showed the floor
  sweeping correct merges. It did not change the call — see below.

### Why below-floor routes to `manual_review`, not `new_master_place`

A bare `continue` (fall-through) would send the `[0.60, 0.70)` band to Step-5
`manual_review` but the **`< 0.60` tail to `new_master_place`** — a silent "these are
different places" verdict the evidence cannot support (name_sim ≥ 0.85 at distance is
*ambiguous*, not distinct). Emitting `manual_review` directly keeps the operator principle
"rather have 'can't tell' than a confident wrong label." (`close_nameless` cannot catch
these — it requires `name_sim < 0.85`.)

### Why the 100 m distance clip is left untouched

The clip is the *root* of why distant pairs cap at 0.60, but the cap is **correct and
protective**, and changing it has the wrong blast radius and the wrong sign:

- `combined_confidence` is the gate for Step-5 blended, which runs for **every source**
  (osm, ridb, nps, padus, google) — a clip change alters ER corpus-wide, not just USFS.
- Raising/removing the clip makes *distant* pairs score **higher**, so Step-5 would
  auto-link **more** at distance — the opposite of the goal.
- The clip is pinned by `matcher.test.ts` calibration (100 m → 0.60, 250 m → 0.60) and the
  documented same-place cases (Sheep Pass 248 m → 0.60). The defect is that `name_dominant`
  *ignored* the correct cap, not the cap itself. Fix the path, leave the cap.

## Consequences

- **Campground dry-run (2,312 SRs): auto_link 1,427 → 657, manual_review 157 → 945;
  `auto_link_low_confidence` 771 → 0; min surviving auto-link conf exactly 0.70.** 803
  pairs now route to `manual_review` (`name_dominant_low_conf`) instead of merging silently.
  **Not a controlled A/B:** the "before" (1,427 / 157 / 771) is the handoff's v1 snapshot
  with **1,414** name_dominant candidates `[handoff, unverified]`; the "after"
  (657 / 945 / 803 / 0) is this session's v2 with **1,454** candidates
  `[measured 2026-08-16]` — the corpus drifted ~40 candidates between the two runs, so
  read the shift as directional, not row-exact.
- **Trailhead calibration** (measured against the live-materialized trailhead outcomes, not
  re-run): of 620 `name_dominant` auto-links, **226 (36.5%) sit below 0.70** — but 154 of
  those are ≥ 100 m, i.e. the ambiguous same-vs-adjacent population the floor is *meant* to
  route. The 0.65 counterfactual moved only **59 campground rows** (0.65 ≤ conf < 0.70), so
  0.65 buys almost nothing on the target chunk. **0.70 kept.**
- **Picnic dry-run byte-identical** (382 / 0 / 138 / 50) — confirms only the `name_dominant`
  path moved; picnic has zero name_dominant auto-links.
- **No migration.** `place_match.match_method` is unconstrained `text`; `apply_match_outcomes`
  reads `outcome.method` dynamically. The RPC's `manual_review` branch was exercised with a
  **hand-built** `name_dominant_low_conf` outcome (inserted, asserted `pending` + unlinked,
  cleaned up), and `promote.applyMatches` was verified to ship `MatchOutcome`s **verbatim**
  (a pass-through). The full `matchOne → promote → apply` chain has **not** run as one flow —
  that first happens at a live materialize.
- **CI guard.** The routing is guarded only by a mocked-DB unit test in `matcher.test.ts`
  (`matchOne — name_dominant floor routing`); the `phase3a` integration suite is excluded
  from the default/CI run. The mock couples to `fetchSourceRecord`/`findCandidates` query
  shapes — a pure-function extraction is filed in `BACKLOG.md`.
- **Queue impact, unresolved.** The fix converts silent merges into review rows; the
  manual-review queue (5,089 measured 2026-08-16, 95% osm `blended_residual`) has **no
  processing framework**. That — not the matcher — now blocks a live campground materialize.
