# Mid-corridor key-stop backfill — extending #275 past the start anchor

**Date:** 2026-08-25 · **Status:** implemented, measured · **Follows:** #275

## Context

#275 shipped a backfill gated to a day's START anchor. A follow-up
investigation confirmed mid-day corridor cities have **no** mechanism at all —
`pickAnchorStop` had exactly one call site, `anchor: dayStartCoord` — and that
Oceanside specifically had real candidates available. Scope gap, not a defect.

## Decision

Extend the same module. `pickBackfillStops` is a thin ordered loop over the
existing `pickAnchorStop`, so **every gate, the ranking and the
null-rather-than-pad contract are inherited unchanged**. It adds only ordering,
a cap, and cross-anchor dedupe. No parallel mechanism.

Anchors per day = the start anchor, then each mid-corridor city in
along-route order.

### The cap — a reasoned call, stated rather than smuggled

**`MAX_BACKFILLS_PER_DAY = 2`, covering start + corridor together.**

Covering *every* bare corridor city was the obvious generalization and is the
wrong one: the model contributes a small handful of real key stops per day (the
prompt asks for 2–4), so letting machine picks reach or exceed that count flips
the day's character — a "key stop" that appears at every town is a list of
towns. Two rather than one because the start anchor routinely consumes a slot,
and a cap of one would mean mid-corridor cities are only ever covered on days
the model already opened well — precisely backwards.

When the cap bites it keeps the **earliest** anchors: an empty morning is felt
more than an empty afternoon, the same intuition #274 and #275 were built on.

### Notes distinguish the two kinds

`anchorStopNote` → *"near X, at the start of the day"*; `corridorStopNote` →
*"near X, along the way through"*. Both strictly positional, no quality claim.
This matters because `KeyStop.note` is the **only** part of this decision that
survives generation — `day.audit` is not persisted.

## Three defects found in live runs and fixed here

1. **A town featured as the thing to see in that town.** A run backfilled the
   corpus row literally named "Carson City, Nevada" under the "Carson City, NV"
   node. Excluding the `urban` slide bucket does not catch it — that row is
   `primary_category=park_feature`, so it cleared the category gate honestly.
   Added `isCityTautology`, **exact after stripping state words**, not
   substring, so "Riverside Park" near Riverside still survives.
2. **The same place featured on two different days.** Dedupe was per-day, and
   consecutive days can share a corridor city. Now deduped **trip-wide**.
3. **A city attributed to a dwell day it does not pass through.** Mid-corridor
   selection originally reused `onCorridor`, which on a dwell / out-and-back day
   degrades to a wide straight-line radius from the base town — right for
   verifying an excursion, far too loose for "a town this day drives through".
   A run attributed Carson City to a Mammoth→Mammoth day that way. Now selection
   uses the day's **polyline** directly; a day with no forward polyline
   contributes no mid-corridor anchors at all.

## Measured — San Diego → Reno, the comparable route

**Before** (that route, #275 only): Oceanside `(EMPTY)`, Riverside `(EMPTY)`.

**After**: Oceanside → **Top Gun House** `[BF:corridor]` in every post-change
run; Riverside → **Trujillo Adobe** `[BF:corridor]` once the dwell fix freed a
cap slot, and covered by the model's own pick in other runs.

**Cities with nothing qualifying correctly stayed bare** — Silver Lakes and
Carson City both render `(EMPTY)` in the final run rather than receiving a
padded pick.

## Consequences and limits

- Coverage is still *closer to* guaranteed, never guaranteed: the pool must
  hold something qualifying within the radius, and the cap deliberately leaves
  later gaps open.
- **Richness is a preference, so a thin row can still win when it is the only
  candidate.** Top Gun House carries no photo or description, so that card
  renders blank — the bar admitted it because Oceanside had nothing richer in
  range. Working as designed; a blank card beats a bare node here, but it is a
  real quality ceiling set by the corpus, not by this logic.
- The whole-route spine and the per-day spine are still derived separately
  (`facts.corridorCities` vs `bakeGeneratedDays`), so an anchor city and the
  rendered node it lands under can in principle disagree. The dwell fix removes
  the case that actually bit; the general mismatch is unchanged and remains the
  pre-existing materialization caveat tracked in BACKLOG.
