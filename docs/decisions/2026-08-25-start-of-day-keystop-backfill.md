# Start-of-day key-stop backfill — a mechanism, after the prompt nudge fell short

**Date:** 2026-08-25 · **Status:** implemented, measured · **Follows:** #274

## Context

#274 added a SPREAD instruction to the generation prompt. Measured then:
mid-corridor and day-end coverage improved, **start-of-day stayed frequently
empty** — the exact case the new prompt text calls out by name. Re-confirmed on
a fresh trip afterwards (Bishop as start showed no curated stop). A prompt
nudge is a preference; nothing made it happen.

Two prior findings constrain any fix: nothing was being *dropped* (the audit's
`droppedPois` was empty across instrumented runs), and which cities get a stop
varies run to run on the same route. So the gap is the model declining to name
one, not machinery eating it.

## Options considered

**Re-ask loop.** Ask the model again when the start city is bare. Keeps its
editorial judgment and note quality. Rejected: it doubles generation latency on
affected trips (generation already runs minutes), costs another LLM call per
trip, is still non-deterministic, and invites the model to comply by padding —
the failure we most want to avoid. It would also interleave with the existing
bounded regeneration loop for structural issues.

**Live Google lookup near the anchor.** `searchNearby` returns ratings and
yields `google:` tiles that carry a `placeId`, so cards would hydrate photos.
Rejected for this PR: it adds a network call per affected day and crosses the
deliberate separation between `itinerary/resolve.ts` (searchText, corpus
category vocabulary) and `discovery/google-places.ts` (slide-bucket
vocabulary), which `resolve.ts` warns about by name. Worth revisiting if corpus
pick quality proves insufficient.

**Post-generation placement from the corpus pool — CHOSEN.** After the audit
grounds the model's own stops, if nothing kept sits near the day's start
anchor, pick one from `facts.poolPOIs` — the palette the model was already
given. Deterministic, no LLM call, no network call, and it runs inside
`audit.ts` where the corridor guard and pool already live.

## Decision

`web/src/lib/itinerary/anchor-backfill.ts` — pure, unit-tested. `audit.ts`
calls it per day after the key-stop loop.

**The bar is all hard gates, never a score that can be overwhelmed:**

- category must be an opener (`scenic`, `food`, `oddity`, `attraction`,
  `camping`). Excludes `interest` (the unmapped junk drawer), `urban` (the town
  is the node), `fuel` (an errand), `overnight` (a different slot).
- within `ANCHOR_NEAR_MI` of the start anchor — a **chosen constant**, far
  tighter than the audit's `GUARD_MI`, which exists to reject wrong-region
  resolutions and is far too loose to mean "near the start".
- must clear the caller's own `onCorridor` guard, unchanged — never a looser
  test than the model's picks faced.
- must not duplicate a stop the model already kept (checked by corpus id *and*
  by name, since pool-hits and live-resolves keep different ref shapes).

**If nothing clears the bar it returns null and the day starts bare.** That is
the requirement, and it is why every filter is a gate rather than a weight.

The note is **strictly positional** (`near {startPlace}, at the start of the
day`) and asserts nothing about the place — a fabricated note on a
machine-picked stop is exactly the grounding failure the audit exists to
prevent. A test asserts the note contains no quality language.

**Flag:** `KEYSTOP_ANCHOR_BACKFILL=false` kills it. **ON by default**, inverting
this repo's usual default-OFF posture — deliberately. That posture guards live
production paths; generation is not one, being gated behind
`ENABLE_PLANNER_WIZARD` which prod never sets. Shipping this OFF ships a fix
that does nothing.

## Measured, and one defect found and fixed mid-flight

Five live generations on TEST, start city varied (Bishop, San Diego, Reno).

**It fires when it should and stays quiet when it shouldn't.** The Bishop run —
the originally reported failure — logged **zero** backfills because the model
covered Bishop itself that run (Erick Schat's Bakkerÿ). Correct non-firing, not
a miss.

**⚠ The first live runs exposed a real defect in the bar.** Three of the first
four picks were `atlas_oddities` rows — "Mick Jagger's Urinal", "Space Whale",
"Kesey Square" — carrying NULL photo, NULL description and NULL rating, i.e.
rows that render as an empty placeholder card. Cause: the `oddity` bucket in
this corpus is dominated by that source, and ranking on proximity alone
systematically surfaces the *thinnest* rows available. Rating could not counter
it — `master_place.rating` is NULL corpus-wide `[measured 2026-08-21]`.

**Fix:** `PoolPOI` gained `hasPhoto` / `hasDescription` (derived in
`toPoolPOI`, not sent to the model), and `rank` prefers a row that will
actually render. A **preference, not a gate** — a thin row still beats no stop
when it is the only thing near the anchor, or the change would empty the very
starts this exists to cover. After it, every materialized backfill carried both
a photo and a description (Sacatar Trail Wilderness, Klamath Hills Recreation
Area, Museum of Natural History, New Shady Rest Campground).

## Consequences and limits

- **Materialization is not guaranteed.** One backfilled pick did not appear
  under its day's first spine node in the check. It may have bucketed under a
  neighbouring node — **not verified either way.** This is the same
  pre-existing class as a pool-hit that never becomes a tile (observed
  2026-08-24 with Victorville Supercharger) and is **not introduced here**.
- Backfill applies to **every day's start anchor**, not just day 1 — so it also
  covers mid-trip mornings. It does **not** run for day-END anchors: measured
  evidence showed those already get covered, and the end node hosts the
  overnight, so a curated stop there is closer to duplication. Deviation from
  the "ideally end-of-day too" brief, flagged deliberately.
- A day whose start is the previous day's end can read as bare while the same
  place is covered on the prior day. Reading a single node in isolation
  overstates the gap.
- Coverage remains *closer to* guaranteed, not guaranteed: the pool must
  contain something qualifying within range.
