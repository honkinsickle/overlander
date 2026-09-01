# 2026-09-01 — Guaranteed categories reach the model as a preference, not a quota

Resolves PR #287 blocker **H** (prompt posture), the last of A–H still open.

## Context

The Interest-Category-Chips guarantee was enforced entirely **after**
generation. `guaranteedCategories` rode on `GenerationInput`, the audit
intersected it with `GUARANTEE_CATEGORIES` and the anchor-backfill inserted real
places for whatever a day missed — but the model was never told any of it.

That was not a wiring oversight in the obvious place. `buildFactsMessage`
constructs an **explicit payload object** (`params`, `rig`, `anchors`, `route`,
`corridorCities`, `poolPOIs`) and `JSON.stringify`s *that*, not `facts` or
`input` wholesale. A field absent from that object is invisible to the model no
matter what `GenerationInput` carries. Confirmed by reading it, and confirmed
that `generate.ts` is the only trip-generation prompt path — `SYSTEM_PROMPT`
plus `buildFactsMessage`, nothing else. Both surfaces had zero mentions of the
guarantee.

`interpret.ts` and `edit.ts` are the other two model-facing flows. They are out
of scope here — this decision covers generation — but note they **do** take
`GenerationInput` and **do** build prompt text from it
(`buildInterpretContext(input, days)` emits the trip window, anchors and days),
and neither includes the guarantee (**0** occurrences in each). Whether they
should is filed in `docs/BACKLOG.md`, unexamined.

So whatever category coverage generated trips showed was the backfill inserting
places, never the model choosing them.

## Decision

**Send it, as a preference to weave — never a quota.**

Spec §4.2 already recommended both halves of this and blocker H only asked
which posture to confirm; Adam confirmed the guarantee should reach the payload
the model actually sees. Following that rather than inventing a format:

- **Placement — alongside `corridorCities`, not inside `rig`.** It constrains
  the shape of the output the way the city spine does; it is not a rig
  attribute. (§4.2 is explicit on this.)
- **Posture — the corridor-cities pattern**, per
  `docs/decisions/2026-08-24-keystop-corridor-spread.md`: favour these
  categories between otherwise comparable candidates, across the trip rather
  than as a per-day checklist, and say plainly that padding is worse than
  omitting. The added `SYSTEM_PROMPT` copy mirrors the existing spread block,
  ending on the same note — a preference, NOT a quota.
- **Shape — the trip-level array.** §4.3 is explicit that the per-day/per-city
  resolved form does *not* need to reach the LLM; the audit computes it
  post-generation. So prompt-construction time sends the trip-level list only.

### One deviation, deliberate: the payload is filtered

`input.guaranteedCategories` is filtered through `GUARANTEE_CATEGORIES` before
being sent — the **same** set the audit's backfill enforces.

A naive "add the field to the payload" would have sent `fuel` and `overnight`
too. Both are deliberately outside that set (ADR 2026-08-25): `fuel` is inserted
by `fuel-live-resolve` and `overnight` owns a dedicated per-day slot. Naming
either in a "weave these into `keyStops[]`" instruction is a direct invitation
to produce a second one. Filtering means the prompt and the mechanism can never
disagree about what was promised.

Omitted entirely when the filtered list is empty — absent means "no guarantees",
matching the field's documented semantics, and avoids sending an empty array as
noise.

## Consequences

- The guarantee now reaches the model. Verified by invoking the real
  `buildFactsMessage` and parsing the JSON block it emits, across four cases:
  pool-side categories present; `fuel`/`overnight` filtered out; empty
  selection omitting the key; absent field omitting the key.
- Locked by `master-prompt.guarantee.test.ts`, including that the field sits
  top-level and **not** inside `rig`, and that the filter is exactly
  `GUARANTEE_CATEGORIES`.
- **The backfill is unchanged.** If the model now covers a category, the audit
  sees it covered and does not insert one — the two are meant to compose that
  way, prompt first, mechanism as backstop.

### Flagged, not fixed: a duplication path this makes more likely

The audit credits a kept stop toward coverage only if it can determine its
category, and it can do that in exactly two ways: the stop is a **pool hit**
(carries a real `SlideCategoryKey`), or it was **live-resolved** and its Google
type appears in `RESOLVED_TO_GUARANTEE` — which currently contains a single
mapping, `restaurant → food`.

So a model-chosen `scenic`/`oddity`/`attraction`/`camping`/`urban` stop that is
live-resolved rather than pooled contributes **no** category, the audit still
counts that category as missing, and the backfill adds a second place of the
same category near the same anchor.

This gap pre-dates this change — but this change **makes it more likely to
surface**, because the model is now actively nudged toward those exact
categories. It was not fixed here: widening `RESOLVED_TO_GUARANTEE` alters the
audit's coverage decisions on every trip, which is a larger blast radius than
this task, and the sibling mapper in `resolve-places.ts` suggests the right fix
is a shared mapping rather than a second ad-hoc table. Filed in
`docs/BACKLOG.md`.

**Not measured:** how often model-chosen key stops are live-resolved rather
than pool hits. Without that, the real-world frequency of this duplication is
unknown — the mechanism is confirmed, the rate is not.
