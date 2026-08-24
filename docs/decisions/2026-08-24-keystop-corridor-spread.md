# Key-stop corridor spread — a prompt preference, not a mechanism

**Date:** 2026-08-24 · **Status:** implemented, measured, partially effective

## Context

A generated trip (San Diego → South Lake Tahoe) rendered day 1 with all its
curated key stops in the back half of the route. San Diego, Oceanside,
Riverside and Silver Lakes each rendered as a bare corridor node with only an
"Explore N more near X →" link and no curated card.

An earlier investigation `[2026-08-24]` established with temporary
instrumentation that **nothing was being dropped** — `report.droppedPois` was
empty across two generations, and every proposed key stop was accounted for as
either a pool-hit or a live Google resolve. Which cities get a card is a
per-generation LLM choice. Across two runs of the same route, day 1's picks had
no overlap in the early corridor: one run put a curated card on San Diego, the
other put nothing before Ridgecrest.

## The hypothesis that was wrong

The obvious explanation was that the model never sees the corridor cities, so it
cannot spread across them. **Measured false before changing anything.**
`buildFactsMessage` (`master-prompt.ts`) has always sent `corridorCities` as
`{id, name, kind, milesFromStart}`, derived by `deriveCorridorCities` inside
`preComputeFacts` (`facts.ts:180-186`) over the whole anchor route. The model
had the spine, with mileages, and was never asked to use it for placement.

Recording this because it is the kind of plausible root cause that would have
justified a plumbing change that was not needed.

## Decision

Change the prompt only. Two edits, no code paths touched:

1. `SYSTEM_PROMPT`'s `keyStops[]` contract gains a SPREAD paragraph: the day's
   stops should read as a progression across the cities that fall inside it, not
   a cluster at one end, with the **start of the day** called out as the part
   that is easy to leave empty.
2. `buildFactsMessage` repeats the instruction next to the `corridorCities`
   payload, where the list actually appears.

**Deliberately not a quota.** Both edits state that skipping a city is fine when
nothing there is worth stopping for, and that coverage is a tie-breaker between
equally good candidates, not a rule that overrides quality. Nothing downstream
enforces coverage — the audit still only grounds or drops names, and no code
counts cities. A padded day is a worse failure than a thin one.

## Measured outcome — partial, and the headline gap is NOT fixed

Same route and dates (San Diego → South Lake Tahoe, 2026-08-25 → 08-28), three
generations after the change, compared against two before. All five inspected
by their persisted `Day.segmentSuggestions` and `corridorCities`.

**What improved, consistently:** all three post-change runs placed a curated
stop at **Riverside** (The Mission Inn Hotel And Spa, ~97 mi) and at the day's
end city (Erick Schat's Bakkerÿ, Bishop). Neither before-run covered Riverside
and the end city together.

**What did not improve:** **San Diego and Oceanside were empty in every
post-change run** — the exact start-of-day gap the new text calls out by name.
One *pre*-change run did cover San Diego (Lucha Libre Taco Shop, ~2 mi), so on
that specific city the change is not an improvement.

**Confound, stated rather than smoothed over:** day 1's shape moved. Every
post-change run planned San Diego → Bishop; the pre-change runs ended day 1 at
Alabama Hills and at Fossil Falls. A longer day-1 pushes the model toward a
transit framing, which plausibly suppresses early stops on its own. This is
**not a clean A/B**, and the sample is small — three runs after, two comparable
before, one route.

**Run-to-run consistency rose sharply** post-change: all three runs picked the
same Riverside stop and the same end stop. Whether that is the instruction
working or reduced diversity is **not established** by this sample.

## Consequences

- The clustering complaint is improved in the middle of the corridor and
  unimproved at its start. Anyone re-testing should measure the start-of-day
  case specifically rather than "did coverage improve."
- No mechanism guarantees anything. A future run may still leave every
  intermediate city empty; that remains within contract.
- If the start-of-day gap matters enough to guarantee, that is a different kind
  of change (post-generation placement, or a re-ask loop) with its own
  padding risk — deliberately not attempted here.
- `day.audit` / `day.keyStops` are still not persisted, so this behaviour
  remains unmeasurable after the fact without temporary instrumentation. That
  gap is unchanged by this decision.
