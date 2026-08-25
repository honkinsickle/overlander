# Decision — fuel-category guarantee via live Google Places (no corpus fallback)

**Date:** 2026-08-25
**Owner:** Adam
**Companion docs:** `docs/specs/interest-category-chips.md` (PR #287, §5.2 B.1 —
the caveat this decision resolves), `docs/decisions/2026-08-25-corridor-city-
keystop-backfill.md` (the mechanism this deliberately does NOT modify).

## Context

The Interest-Category-Chips scoping doc found in §5.2 B.1 that a `fuel`
guarantee via the general backfill selector (`pickAnchorStop` /
`pickBackfillStops`) is INERT on today's data: the selector iterates
`facts.poolPOIs` only — a corpus fold — and never reaches
`PlaceResolver`/Google (`anchor-backfill.ts:11-13` explicit). Fuel-POI corpus
coverage is thin in the far-north / off-corridor regions where the
`fuel-POI` layer (per `docs/specs/expedition-planner.md` §8.5) is meant to
fill, and that layer hasn't shipped.

Adam's call: skip the corpus path entirely for fuel. Always call Google
Places live. No fallback to corpus.

## Decision

- **A separate mechanism from `pickAnchorStop`.** New module
  `web/src/lib/itinerary/fuel-live-resolve.ts` exporting `pickFuelAtAnchor()`;
  the general backfill selector is untouched for the other 6 pool-serviceable
  categories (`camping`, `scenic`, `food`, `oddity`, `attraction`, `urban`).
- **Google `places:searchNearby` for `includedTypes: ["gas_station"]`, 5 km
  radius, rankPreference DISTANCE, maxResultCount 1.** Extended
  `PlaceResolver` with a new method `resolveNearby(includedType, biasCoords)`
  that mirrors `resolve()`'s auth / cap / cache / abort posture. Reused the
  existing `RESOLVE_CAP` (shared per-generation cost cap — see §5 on cost).
- **Fuel picks fire per-anchor** (day-start + each mid-corridor city on the
  day's polyline), same anchor construction as the corridor-backfill loop.
  No per-day cap of its own beyond `RESOLVE_CAP`; each pick that succeeds
  is added to a local dedupe set so a second anchor on the same day within
  `ANCHOR_NEAR_MI` (25 mi) won't re-pick.
- **No fallback to corpus.** When Google returns nothing / capped / no-key
  / off-corridor, the guarantee at that anchor stays unsatisfied. Same
  "missing stays missing, no bad guess" principle as `pickAnchorStop`'s
  `return null` and the overnight-fuzzy-tier's no-match-is-safe rule (#285).
- **Dedupe against already-kept fuel-family stops.** Both surfaces count:
  pool-hits with corpus `category === "fuel"` (SlideCategoryKey
  normalization) and live-resolves with a raw Google type in
  `FUEL_LIVE_CATEGORIES = { gas_station, truck_stop,
  electric_vehicle_charging_station }` (`audit.ts` new const). If any kept
  fuel stop sits within `ANCHOR_NEAR_MI` of the anchor, `pickFuelAtAnchor`
  no-ops before spending a Google call.
- **Feature-flagged OFF by default.** `FUEL_LIVE_RESOLVE=true` opts in —
  opposite posture from `KEYSTOP_ANCHOR_BACKFILL`. **Why the flip:** the
  general backfill is in-memory (pool-only, no external call), so its
  ship-OFF-changes-nothing argument applies. This mechanism issues external
  Google calls per anchor when the user picked fuel — new cost source. Ship
  OFF, flip per-environment, no revert if a run misbehaves. Flagged as a
  decision in this doc.

## Deviations from the ask that were called out during build

**"Per the rig profile's fuel type (electric vs. gas, already known from the
vehicle profile)"** — the vehicle profile does NOT know this today. Grepped
`fuelType`/`powertrain`/`electric` across the itinerary, plan, and vehicles
libraries: no field exists. Both `RigProfile` shapes (`facts.ts:68-77`
pipeline, `web/src/lib/vehicles/types.ts:23-35` client) carry `fuelRangeMi:
number` only. Wizard has no fuel-type input (`expedition-wizard.tsx:503-513`
is a range stepper only).

**How this ships today:** the `includedTypes` value passed to
`resolveNearby` is hardcoded to `"gas_station"` at `audit.ts` new
`FUEL_LIVE_INCLUDED_TYPE`. EV rigs get gas-station picks. The
`pickFuelAtAnchor` module itself takes `fuelType` as a parameter — it does
not hardcode — so the fix is a `RigProfile.fuelType?: 'gas' | 'electric'`
field addition + wizard input, then the audit wiring reads it. Flagged for
Adam as a follow-up. Not built here.

## The chip UI question

The Interest-Category-Chips spec §11 step 1 sketches an 8-chip row. That
row is F+D-blocked (F: chip order / icons / copy; D: audit-loop granularity
for the other 6 categories). Rather than ship a row with 1 functional chip
and 7 non-functional ones (misleading), this decision ships a single
purpose-built checkbox in the wizard's "Interest categories" section
(inserted between "Trip details" and "Your rig" per spec §1). Copy makes
the mechanism explicit: "Calls Google Places live for a gas station near
each day-start and mid-corridor city that doesn't already have one in
range." When F+D resolve, the checkbox is replaced by the full 8-chip row
in place.

## Cost / worst-case Google call count

**Computed against the code, not measured against a real trip:**

- Per-generation cap: `PlaceResolver` is constructed at `audit.ts:352` as
  `new PlaceResolver(Math.max(80, output.days.length * 8))` — so 80 for
  trips of ≤10 days, `8 × N` for N-day trips beyond. This cap is SHARED
  between `resolve()` (LLM keystop live-resolves) and
  `resolveNearby()` (fuel picks).
- Per-call cost: 2.5–3.2¢ per resolve, per the docstring comment at
  `resolve.ts:15-16`. (That is a stated range in the existing code; not
  measured this session.)
- Analytical worst case: a 10-day trip with ~3 corridor cities per day and
  NO existing fuel coverage anywhere is 10 × 4 = 40 fuel anchors. If the
  LLM's keyStops also live-resolve heavily (say ~15 calls), the cap of 80
  fits both easily. All 40 fuel picks succeed if the corpus has no fuel
  coverage AND Google finds a gas station at each. Cost bound: ~40 × 3¢ =
  ~$1.20 for the fuel branch on that trip, plus the pre-existing LLM
  keystop cost.
- A 20-day trip with the same 3-corridor-cities-per-day density = 80 fuel
  anchors + ~30 LLM keystops = 110 calls. Cap = `max(80, 160) = 160`. Fits.
- **Realistic case (not measured):** most days will have at least one fuel
  stop from the LLM's own picks near a corridor city, so the per-anchor
  dedupe (`hasFuelNearAnchor` in fuel-live-resolve.ts) short-circuits many
  calls without spending Google budget. Actual call count depends on how
  often the LLM already picks fuel — not measured; noted as follow-up
  telemetry if the feature ships live.

## Consequences

- **Live external cost per generation when `FUEL_LIVE_RESOLVE=true`
  AND the user checks the fuel guarantee.** Bounded above by the shared
  `RESOLVE_CAP`; not bounded per-day.
- **Fuel picks land as extra `KeyStop`s on `day.keyStops`** and are baked
  by the existing `resolvedToTile` path (bake.ts:149) — they render as
  `google:${placeId}` tiles with `pills: [{label: "live-resolved"}]`,
  distinguishable from corpus-backfill tiles by the "top up on fuel near
  <anchor>" note copy (the only provenance signal, matching the existing
  `KeyStop.note is the only part of this decision that survives generation`
  posture from `anchor-backfill.ts:299-307`).
- **EV rigs get gas-station picks today** (see Deviations). Fix scope is a
  rig-field addition, not a change to this module.
- **Category `interest` remains excluded from the wizard chip row entirely**
  per spec §9 B (Decision B); this decision does not change that.
- **`overnight` in the guarantee gate remains open** (spec §9 B.2 — the
  duplicate-with-existing-overnight-mechanism caveat); this decision does
  not build an `overnight` path.

## Testing / verification

- 9 unit tests for `pickFuelAtAnchor` in
  `web/src/lib/itinerary/fuel-live-resolve.test.ts` — covers pool-hit
  dedupe, resolver failure modes (not-found / capped / no-key), corridor
  guard rejection, happy-path shape, bias-coord wiring, fuelType passthrough,
  dedupe threshold. Run: `cd web && npx tsx --test
  src/lib/itinerary/fuel-live-resolve.test.ts` → 9 pass.
- **Audit-hook integration coverage is thin.** The wiring inside
  `auditItinerary` (feature-flag check + `guaranteedCategories` check +
  keptFuelCoords computation + per-anchor iteration + push into keptStops /
  resolvedPlaces) is verified only by the local gate (typecheck + `next
  build` both exit 0) and by feature-flag-OFF-by-default containment. No
  integration test drives `auditItinerary` end-to-end with a fake resolver
  today because the resolver is constructed inside the function
  (`audit.ts:352`) — an integration test would require either a refactor to
  a DI seam or an env-var setup. Flagged. If Adam turns the flag ON in
  production without an integration test landing first, manual verification
  on a real trip is the safety net.
- **Local gate PASSES:** `npm run -w web typecheck` exit 0; `cd web && npx
  next build` exit 0; `npm run -w data typecheck` exit 0.

## Follow-ups

- **Rig fuel-type field** to unlock EV-charging picks — add
  `RigProfile.fuelType?: 'gas' | 'electric'`, wire wizard input, thread
  through `expeditionToGenerationInput`, read in `audit.ts` to pass to
  `resolveNearby`. Small scope; not in this PR.
- **Audit-hook integration test.** Extract a `collectFuelPicksForDay`
  helper (or refactor `auditItinerary` to accept an injectable resolver)
  and add a test that drives the wired path with a fake resolver.
- **Telemetry when the flag flips ON.** Actual per-trip Google call count,
  actual pool-hit-dedupe rate. Not currently measured.
- **Chip row expansion (§11 step 1 in the spec).** When Adam decides D (audit-
  loop granularity) and F (chip UI shape), the single-checkbox in the
  wizard is replaced by the full 8-chip row and the other categories are
  wired to `pickAnchorStop`-style pool-backfill (§11 steps 5–7).
