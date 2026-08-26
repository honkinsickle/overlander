# Decision — corridor-city selection: strict 3mi proximity, no prominence/spacing

**Status:** DECIDED (Adam) + BUILT 2026-08-26. Supersedes the prominence +
`minSpacingMi` model in `deriveCorridorCities`. Related, now-subsumed threads:
the "SF water false-positive" fix and the "density-aware spacing" recommendation
— both are resolved by this single redesign (see Consequences).

## Context

`deriveCorridorCities` (the day-spine derivation shared by `bake.ts` render and,
since #295, the backfill audit via `deriveDayCorridor`) selected cities in two
steps: (1) gate candidates by straight-line offset ≤ `bufferMi` (15mi), then
(2) greedily pick by prominence (admin tier, then population) enforcing a 50mi
`minSpacingMi` between picks, with a `maxGapMi` gap-fill fallback and a 4-node
cap.

Step 2 was a structural bug. On real trips it let one prominent city suppress
its whole 50mi neighbourhood of genuinely on-route cities:
- Palo Alto→Colusa: San Francisco (11.6mi offset — across the Bay) won the top
  slot and its 50mi radius dropped Concord (1.6mi), Fairfield (1.4mi), and
  Vacaville (0.4mi), all directly on the driven route `[measured 2026-08-26]`.
- San Jose→Reno: Sacramento (state capital) suppressed Davis (0.4mi, ~11mi
  away) the same way `[measured 2026-08-26]`.

No single spacing value fixes this while prominence-greedy selection remains the
mechanism — a smaller spacing still lets the biggest city win and blanket its
neighbours. The buffer distance is also the wrong lever: it's orthogonal to the
suppression, and shrinking it drops legitimate cities without curing the model.

## Decision

Replace the whole selection with a **strict proximity rule**:

- A gazetteer city is a corridor node **iff** its straight-line offset from the
  day's polyline is ≤ **`corridorMi` (3mi)** and it meets the population floor.
  This IS the inclusion rule — no prominence ranking, no spacing suppression, no
  gap-fill.
- **`corridorMi` (3mi) is a NEW param, distinct from the shared `bufferMi`
  (15mi)**, which `bucket.ts` (place→node), `bake.ts` (tile mile-labelling),
  `stretches.ts`, and `seeds.ts` still use as the on-corridor tolerance. Those
  consumers are deliberately untouched — the tighter rule is scoped to
  corridor-CITY membership only.
- **A day may have zero corridor cities.** That is valid and deliberate — no
  reach-further fallback is added to guarantee ≥1 city (verified: a US-395
  Lone Pine→Mammoth day yields zero, correctly).
- **`maxNodes` raised 4 → 40**, a pathology backstop, not a design limiter.
  Strict inclusion legitimately surfaces many real cities on a dense day
  (measured 21 on Palo Alto→Colusa, 29 on San Jose→Reno), and a low cap would
  truncate the exact cities this redesign exists to surface (Davis was ~18th).
  When the cap bites it truncates by **along-route order, never prominence**, so
  it cannot reintroduce the bias.
- **Minimal same-point de-dup (`dedupMi`, 0.5mi):** two rows essentially
  co-located collapse to the more prominent one. This is NOT the removed 50mi
  suppression. **It was a no-op on the measured trips** (closest real pair was
  Suisun/Fairfield at 0.77mi > 0.5mi); it guards only true duplicate rows. The
  same tight radius replaced the old 50mi seed-vs-gazetteer dedup so a user seed
  can't hide a distinct nearby city either.

## Consequences

- **Named cases fixed (verified on real geometry 2026-08-26):** Concord/
  Fairfield/Vacaville all appear; Davis appears; **SF (11.56mi) and Sacramento
  (3.09mi) are excluded** by the gate; Woodland (9.63mi) is excluded — see the
  tradeoff below.
- **Woodland is a real, accepted regression — NOT a correction of a prior
  mistake.** Woodland (9.6mi offset) was validated in an earlier investigation
  as genuinely on-route (a +9mi detour if inserted, judged "keep") — its large
  offset is the road curving away from the straight chord, not evidence it's off
  the road. Dropping it is a deliberate tradeoff for killing the suppression
  bug, not a claim that it isn't on the road.
- **This subsumes the SF "water" fix.** SF is now excluded purely by the 3mi
  gate (11.56mi » 3mi), so no water-detection / Tilequery machinery is needed.
- **Sacramento excluded, its suburbs included** — an artifact of the strict 3mi
  line: the capital projects 3.09mi off (freeway skirts downtown) while West
  Sacramento (1.4mi) and a ring of suburbs (Arden-Arcade, Citrus Heights,
  Roseville, …) fall inside. Flagged as a known oddity of the chosen rule.
- **⚠ DENSITY CASCADE (top follow-up).** Dense suburban corridors now surface
  many corridor cities (21–29 measured). Because the backfill audit draws its
  anchors from this same derivation (#295), a dense day now yields ~21–29
  backfill anchors × up to 2 picks each — a large multiplication of machine
  picks per day, and a long rendered spine. This is the direct, accepted
  consequence of "all cities within 3mi, no suppression," but it likely needs a
  DISPLAY-layer or anchor-layer follow-up (feature the most significant N, list
  the rest under "Explore"; or cap the audit's anchor use separately) — a
  separate decision, flagged in BACKLOG. Levers if the raw count is too noisy:
  `corridorMi`, `popFloor`, `maxNodes`, or a render/anchor-side cap.
- **Old tuning params removed** (`minSpacingMi`, `maxGapMi`) — no non-test
  consumers. The `derive.test.ts` prominence/spacing/gap-fill tests were
  rewritten; two named regression tests added (Concord/Fairfield/Vacaville and
  Davis/Sacramento). `day-corridor.test.ts`'s #295 test, which demonstrated the
  granularity split via the (now-removed) suppression, was rewritten to test
  per-day geometric scoping directly.
