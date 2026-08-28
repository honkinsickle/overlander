# Manual GPS Coordinate Entry for Expedition Start/End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type raw lat/lng coordinates (instead of picking a Mapbox
autocomplete suggestion) for any destination row — start, end, or a middle
stop — in the `/plan/expedition` wizard.

**Architecture:** Per-destination-row mode toggle. In "coords" mode a new
`CoordinateInput` component (two plain text fields, pure-function validated)
replaces `LocationAutocomplete` and calls the same `setDest` update path,
producing an `ExpeditionDestination` with `coords` set directly and a new
`manualCoords: true` flag. That flag narrowly exempts the destination from
`validateExpeditionForm`'s planning-region check — no reverse geocoding, no
region resolution. Nothing downstream of `ExpeditionDestination` changes:
`expeditionToGenerationInput`, `preComputeFacts`, `routeBetween`, and
`itineraryToTrip` already treat `coords` as ground truth and never read
`place_id` (confirmed by a prior read-only investigation this session).

**Tech Stack:** Next.js 15 App Router, React (client component + `useState`),
TypeScript strict, `node:test` via `tsx` (not vitest) for pure-function
tests, existing Tailwind + design-token classes.

**Spec:** This plan's spec is the user's own message in-session (no separate
spec doc) plus the prior read-only investigation's findings, which this plan
treats as established fact:
- `ExpeditionDestination` shape: `web/src/lib/plan/expedition.ts:22-44`.
- No `place_id` dependency anywhere in the start/end path.
- `coords` is already the preferred signal everywhere downstream
  (`web/src/lib/itinerary/facts.ts:158-166`, `web/src/lib/routing/route-between.ts`).
- The one real constraint is the planning-region gate
  (`web/src/lib/plan/planning-region.ts`, strict-refuse, no null-region
  fallback) — **user has explicitly decided**: hand-entered coordinates are
  **exempt** from this gate, as a deliberate testing-scope shortcut, not a
  reverse-geocode-to-recover-a-region-code approach. This is recorded as an
  ADR in Task 6.

## Global Constraints

- No new npm dependencies (`web/CLAUDE.md` "Ask before introducing a
  dependency").
- Coordinate convention is `[lng, lat]` everywhere in this codebase
  (`web/CLAUDE.md`) — every `coords` tuple constructed in this plan follows
  that order.
- Design tokens only — no raw hex/hardcoded spacing in new UI
  (`web/CLAUDE.md`, `web/AGENTS.md` "Styling"). Match existing classes in
  `expedition-wizard.tsx`/`location-autocomplete.tsx` (`form-field`,
  `text-input-error`, `font-mono text-[11px] uppercase tracking-wider
  text-text-muted`, etc.) rather than inventing new ones.
- Tests run via `node:test` + `tsx`, per-lib-dir, **not vitest**
  (`CLAUDE.md` RUNBOOK). Pattern: `npx tsx --test src/lib/plan/<file>.test.ts`.
- The gate before any commit claiming "done" is **both**, each exit 0:
  `npm run -w web typecheck` and `cd web && npx next build` (`CLAUDE.md`
  §STANDING RULES — `next build` alone is not sufficient).
- `git add` explicit paths only — no `add .`, no `-A`, no `commit -a`
  (`docs/STATE.md` COLD START item 1).
- This is a testing-only wizard already gated behind
  `ENABLE_PLANNER_WIZARD=true` (dev-only) and TEST Supabase only — nothing
  in this plan touches PROD or loosens that gate.
- Every doc edit in Task 7 must carry the evidence-tag convention used
  throughout `docs/` (`[read source]`, `[measured YYYY-MM-DD]`, etc.) and
  correct superseded claims **in place** with strikethrough, never by
  deleting them (`docs/STATE.md` COLD START "Conventions that are easy to
  miss").

---

## Task 1: Pure coordinate-parsing helper

**Files:**
- Create: `web/src/lib/plan/parse-coordinates.ts`
- Test: `web/src/lib/plan/parse-coordinates.test.ts`

**Interfaces:**
- Produces: `parseCoordinateEntry(latText: string, lngText: string):
  CoordinateEntryResult` where `CoordinateEntryResult =
  | { status: "empty" } | { status: "error"; message: string }
  | { status: "ok"; coords: [number, number] }` (coords in `[lng, lat]`
  order). Also `formatCustomPointLabel(coords: [number, number]): string`.
  Task 3's `CoordinateInput` component consumes both by name.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/plan/parse-coordinates.test.ts`:

```ts
/**
 * Tests for hand-entered coordinate parsing (manual GPS entry in the
 * expedition wizard). Run with:
 *   npx tsx --test src/lib/plan/parse-coordinates.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoordinateEntry, formatCustomPointLabel } from "./parse-coordinates";

test("both fields blank is empty, not an error", () => {
  assert.deepEqual(parseCoordinateEntry("", ""), { status: "empty" });
  assert.deepEqual(parseCoordinateEntry("  ", " "), { status: "empty" });
});

test("one field filled, the other blank is an error", () => {
  assert.equal(parseCoordinateEntry("34.05", "").status, "error");
  assert.equal(parseCoordinateEntry("", "-118.24").status, "error");
});

test("non-numeric input is an error", () => {
  assert.equal(parseCoordinateEntry("abc", "-118.24").status, "error");
  assert.equal(parseCoordinateEntry("34.05", "xyz").status, "error");
});

test("latitude out of range is refused", () => {
  assert.equal(parseCoordinateEntry("-91", "0").status, "error");
  assert.equal(parseCoordinateEntry("91", "0").status, "error");
});

test("longitude out of range is refused", () => {
  assert.equal(parseCoordinateEntry("0", "-181").status, "error");
  assert.equal(parseCoordinateEntry("0", "181").status, "error");
});

test("boundary values are accepted — -90/90/-180/180 are valid, not off-by-one refused", () => {
  assert.equal(parseCoordinateEntry("90", "180").status, "ok");
  assert.equal(parseCoordinateEntry("-90", "-180").status, "ok");
});

test("a valid pair resolves to [lng, lat], matching the app's coordinate convention", () => {
  assert.deepEqual(
    parseCoordinateEntry("34.0522", "-118.2437"),
    { status: "ok", coords: [-118.2437, 34.0522] },
  );
});

test("formatCustomPointLabel reads lat then lng, 4 decimal places, no reverse geocoding", () => {
  assert.equal(
    formatCustomPointLabel([-118.2437, 34.0522]),
    "Custom Point (34.0522, -118.2437)",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx tsx --test src/lib/plan/parse-coordinates.test.ts`
Expected: FAIL — `Cannot find module './parse-coordinates'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/plan/parse-coordinates.ts`:

```ts
/**
 * Pure parsing/validation for hand-entered lat/lng destination coordinates
 * (the `/plan/expedition` wizard's coordinate-entry mode). Kept separate from
 * `coordinate-input.tsx` so the range-checking logic is testable without
 * mounting a React component.
 */

export type CoordinateEntryResult =
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ok"; coords: [number, number] };

/** Parses two free-text fields into a `[lng, lat]` pair, or reports why not.
 *  "empty" (both fields blank) is distinct from "error" — an untouched pair
 *  of inputs isn't a validation failure, it just has nothing to resolve yet. */
export function parseCoordinateEntry(
  latText: string,
  lngText: string,
): CoordinateEntryResult {
  const lat = latText.trim();
  const lng = lngText.trim();
  if (lat === "" && lng === "") return { status: "empty" };
  if (lat === "" || lng === "")
    return { status: "error", message: "Enter both latitude and longitude." };
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum))
    return { status: "error", message: "Coordinates must be numbers." };
  if (latNum < -90 || latNum > 90)
    return { status: "error", message: "Latitude must be between -90 and 90." };
  if (lngNum < -180 || lngNum > 180)
    return { status: "error", message: "Longitude must be between -180 and 180." };
  return { status: "ok", coords: [lngNum, latNum] };
}

/** Display label for a manually-entered point — no reverse geocoding. */
export function formatCustomPointLabel(coords: [number, number]): string {
  const [lng, lat] = coords;
  return `Custom Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx tsx --test src/lib/plan/parse-coordinates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/plan/parse-coordinates.ts web/src/lib/plan/parse-coordinates.test.ts
git commit -m "feat(plan): pure lat/lng parsing for manual coordinate entry"
```

---

## Task 2: `manualCoords` field + planning-region gate exemption

**Files:**
- Modify: `web/src/lib/plan/expedition.ts:22-44` (type), `:142-171`
  (`validateExpeditionForm`)
- Modify: `web/src/lib/plan/planning-region.test.ts:91-99` (`dest()` helper),
  `:117-124` (existing test), add one new test

**Interfaces:**
- Consumes: nothing new.
- Produces: `ExpeditionDestination.manualCoords: boolean` — Task 4's wizard
  sets this; Task 3's `CoordinateInput` does not touch it directly (the
  wizard sets it on toggle, matching how `region`/`coords` are already set by
  the wizard, not by the input components themselves).

- [ ] **Step 1: Write the failing tests**

In `web/src/lib/plan/planning-region.test.ts`, replace the `dest` helper
(lines 91-99) with:

```ts
const dest = (place: string, region: string | null, manualCoords = false) => ({
  place,
  coords: [-120, 40] as [number, number],
  region,
  manualCoords,
  datePin: "flexible" as const,
  date: null,
  dwell: 0,
  note: null,
});
```

Replace the test at lines 117-124 (`"a destination with coords but NO region
fails the backstop"`) with:

```ts
test("a destination with coords but NO region fails the backstop, unless manualCoords exempts it", () => {
  // Without the exemption, this is the shape a hand-crafted POST would have —
  // the autocomplete path cannot produce it, since coords are only ever set by
  // picking a filtered suggestion.
  const err = validateExpeditionForm(
    base([dest("Portland, OR", "OR"), dest("Somewhere", null)]),
  );
  assert.ok(err, "expected a validation error");
});

test("manualCoords exempts a hand-entered destination from the region backstop", () => {
  const err = validateExpeditionForm(
    base([
      dest("Portland, OR", "OR"),
      dest("Custom Point (40.0000, -120.0000)", null, true),
    ]),
  );
  assert.equal(err, null);
});
```

Leave every other test in the file untouched — the `dest()` signature change
is backward compatible (`manualCoords` defaults to `false`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx tsx --test src/lib/plan/planning-region.test.ts`
Expected: FAIL on the new "manualCoords exempts…" test (region check still
rejects it) and a TypeScript error surfaces separately at typecheck time
(missing `manualCoords` on the object literal) — `tsx --test` may not catch
the type error at runtime since it transpiles without full type-checking;
confirm the behavioral failure at minimum, and expect `npm run -w web
typecheck` (run in Step 2b below) to also fail until Step 3 lands.

Run: `npm run -w web typecheck`
Expected: FAIL — `Property 'manualCoords' is missing in type...` from
`expedition.ts`'s `ExpeditionDestination` not yet declaring the field, and/or
from the wizard's object literals once Task 4 lands. At this point in the
plan (before Task 4), the type error will come from `planning-region.test.ts`
itself using a type that doesn't have `manualCoords` yet if you type it
explicitly — since `dest()` returns an inferred object type here, the error
instead shows up as excess-property or missing-property mismatch wherever
this return value is passed to `validateExpeditionForm(form:
ExpeditionForm)`. Either way, do not proceed to Step 4 until both this test
run and typecheck are clean.

- [ ] **Step 3: Write the implementation**

In `web/src/lib/plan/expedition.ts`, replace the `ExpeditionDestination` type
(lines 22-44) with:

```ts
export type ExpeditionDestination = {
  /** Geocodable city/destination text. */
  place: string;
  /** `[lng,lat]` bound when the user PICKED a suggestion or entered raw
   *  coordinates — null when the field holds unresolved freeform text. */
  coords: [number, number] | null;
  /** Mapbox region code ("CA", "OR", …) from the picked suggestion, null for
   *  unresolved freeform text OR a manually-entered coordinate (see
   *  `manualCoords`). Historically `coords != null` implied `region != null`
   *  — that invariant now has one deliberate exception: manual coordinate
   *  entry sets `coords` with `region` staying null.
   *
   *  DROPPED AT THE PIPELINE BOUNDARY, deliberately: `expeditionToGenerationInput`
   *  builds each `Anchor` field by field and does not copy this, so the region
   *  never reaches `GenerationInput` or anything under `lib/itinerary/`. It
   *  exists to be checked before generation, not to be planned with. */
  region: string | null;
  /** True when `coords` came from hand-entered lat/lng rather than a resolved
   *  Mapbox suggestion. Exempts this destination from the planning-region
   *  gate in `validateExpeditionForm` — a deliberate testing-scope choice,
   *  not a general "coords implies in-region" claim. See
   *  `docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`. */
  manualCoords: boolean;
  /** FIXED = hard schedule anchor; flexible = the planner may place it. */
  datePin: "fixed" | "flexible";
  /** ISO date; used only when datePin === "fixed". */
  date: string | null;
  /** 0 = pass-through, 1+ = layover days. */
  dwell: number;
  note: string | null;
};
```

In the same file, in `validateExpeditionForm` (around line 160), replace:

```ts
  const outOfRegion = form.destinations.find((d) => !isInPlanningRegion(d.region));
```

with:

```ts
  const outOfRegion = form.destinations.find(
    (d) => !d.manualCoords && !isInPlanningRegion(d.region),
  );
```

And extend the comment block immediately above it (currently ending "...so in
practice this catches a hand-crafted POST, not a user.") with one more
sentence:

```ts
  // Reached only for destinations that already have coords, and coords are
  // only ever set by picking a filtered suggestion — so in practice this
  // catches a hand-crafted POST, not a user.
  //
  // EXCEPT manual coordinate entry (`manualCoords: true`), which deliberately
  // skips this check — see docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx tsx --test src/lib/plan/planning-region.test.ts`
Expected: PASS, all tests including the two touched/added ones.

Run: `npm run -w web typecheck`
Expected: still FAILS at this point — Task 4 hasn't updated
`expedition-wizard.tsx`'s destination-literal call sites yet, and TypeScript
strict mode will flag every object literal assigned to `ExpeditionDestination`
(or spread into one) that omits `manualCoords`. **This is expected and
resolved by Task 4** — record it here so nobody mistakes it for a Task 2
regression; do not attempt to make `manualCoords` optional to paper over it.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/plan/expedition.ts web/src/lib/plan/planning-region.test.ts
git commit -m "feat(plan): add manualCoords, exempt it from the planning-region gate"
```

---

## Task 3: `CoordinateInput` component

**Files:**
- Create: `web/src/components/plan/coordinate-input.tsx`

**Interfaces:**
- Consumes: `parseCoordinateEntry`, `formatCustomPointLabel` from
  `@/lib/plan/parse-coordinates` (Task 1).
- Produces: `CoordinateInput` React component with props `{ defaultLat?:
  number; defaultLng?: number; invalid?: boolean; onResolve: (coords:
  [number, number] | null, label: string) => void }`. Task 4 wires this in
  place of `LocationAutocomplete` when a row is in coordinate mode.

No unit test for this task — it is a thin UI wrapper around the pure,
already-tested `parseCoordinateEntry`; its only job is wiring two controlled
inputs to that function and surfacing the error string. Task 5 verifies it
renders and behaves correctly in a real browser.

- [ ] **Step 1: Write the component**

Create `web/src/components/plan/coordinate-input.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  parseCoordinateEntry,
  formatCustomPointLabel,
} from "@/lib/plan/parse-coordinates";

/**
 * Hand-entered lat/lng destination input — the coordinate-mode counterpart
 * to `LocationAutocomplete`. No geocoding, no reverse geocoding, no
 * `place_id`: the resolved `coords` and a plain "Custom Point (…)" label are
 * the only outputs. Validation is `parseCoordinateEntry`
 * (`lib/plan/parse-coordinates.ts`), re-run on every keystroke so the error
 * message and the resolved state never lag the visible inputs.
 */
export function CoordinateInput({
  defaultLat,
  defaultLng,
  invalid,
  onResolve,
}: {
  defaultLat?: number;
  defaultLng?: number;
  /** Error ring driven by the PARENT's validation (e.g. "unresolved" on
   *  submit) — distinct from this component's own inline range-error text. */
  invalid?: boolean;
  /** Fired on every change. `coords` is null while empty/invalid; the label
   *  is only meaningful when `coords` is non-null. */
  onResolve: (coords: [number, number] | null, label: string) => void;
}) {
  const [lat, setLat] = useState(defaultLat != null ? String(defaultLat) : "");
  const [lng, setLng] = useState(defaultLng != null ? String(defaultLng) : "");

  function commit(nextLat: string, nextLng: string) {
    const result = parseCoordinateEntry(nextLat, nextLng);
    if (result.status === "ok") {
      onResolve(result.coords, formatCustomPointLabel(result.coords));
    } else {
      onResolve(null, "");
    }
  }

  const result = parseCoordinateEntry(lat, lng);
  const error = result.status === "error" ? result.message : null;
  const ring = invalid || error ? "border-input-error!" : "";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="Lat (-90 to 90)"
          value={lat}
          onChange={(e) => {
            setLat(e.target.value);
            commit(e.target.value, lng);
          }}
          className={`form-field flex-1 ${ring}`}
        />
        <input
          type="text"
          inputMode="decimal"
          placeholder="Lng (-180 to 180)"
          value={lng}
          onChange={(e) => {
            setLng(e.target.value);
            commit(lat, e.target.value);
          }}
          className={`form-field flex-1 ${ring}`}
        />
      </div>
      {error && <span className="text-[11px] text-input-error">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/plan/coordinate-input.tsx
git commit -m "feat(plan): add CoordinateInput, the manual lat/lng entry control"
```

---

## Task 4: Wire the toggle into `ExpeditionWizard`

**Files:**
- Modify: `web/src/components/plan/expedition-wizard.tsx:8` (import),
  `:137-140` (initial state), `:264-277` (destination row render),
  `:383-390` ("Add a stop" handler)

**Interfaces:**
- Consumes: `CoordinateInput` (Task 3), `ExpeditionDestination.manualCoords`
  (Task 2).
- Produces: nothing new for later tasks — this is the leaf UI wiring.

- [ ] **Step 1: Add the import**

In `web/src/components/plan/expedition-wizard.tsx`, after line 8
(`import { LocationAutocomplete } from "@/components/plan/location-autocomplete";`),
add:

```tsx
import { CoordinateInput } from "@/components/plan/coordinate-input";
```

- [ ] **Step 2: Add `manualCoords: false` to both initial-state literals**

Replace lines 137-140:

```tsx
  const [destinations, setDestinations] = useState<Dest[]>([
    { id: 0, place: "", coords: null, region: null, datePin: "flexible", date: null, dwell: 0, note: null },
    { id: 1, place: "", coords: null, region: null, datePin: "flexible", date: null, dwell: 0, note: null },
  ]);
```

with:

```tsx
  const [destinations, setDestinations] = useState<Dest[]>([
    { id: 0, place: "", coords: null, region: null, manualCoords: false, datePin: "flexible", date: null, dwell: 0, note: null },
    { id: 1, place: "", coords: null, region: null, manualCoords: false, datePin: "flexible", date: null, dwell: 0, note: null },
  ]);
```

- [ ] **Step 3: Add `manualCoords: false` to the "Add a stop" literal**

Find the `destinations.length < 8` button's `onClick` (around line 383):

```tsx
                setDestinations((ds) => {
                  const id = nextId.current++;
                  return [
                    ...ds.slice(0, -1),
                    { id, place: "", coords: null, region: null, datePin: "flexible", date: null, dwell: 0, note: null },
                    ds[ds.length - 1],
                  ];
                })
```

Replace the new-row literal with:

```tsx
                setDestinations((ds) => {
                  const id = nextId.current++;
                  return [
                    ...ds.slice(0, -1),
                    { id, place: "", coords: null, region: null, manualCoords: false, datePin: "flexible", date: null, dwell: 0, note: null },
                    ds[ds.length - 1],
                  ];
                })
```

- [ ] **Step 4: Swap in `CoordinateInput` when a row is in manual mode, and add the mode toggle**

Replace the block from the opening `<div className="flex items-center gap-2">`
through the `</div>` that closes the `flex-1` wrapper and the three
move/remove buttons (lines 259-308) with:

```tsx
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-amber w-12 shrink-0">
                    {i === 0 ? "START" : i === lastIdx ? "END" : `STOP ${i}`}
                  </span>
                  <div className="flex-1">
                    {d.manualCoords ? (
                      <CoordinateInput
                        defaultLat={d.coords?.[1]}
                        defaultLng={d.coords?.[0]}
                        invalid={unresolved}
                        onResolve={(coords, label) =>
                          setDest(d.id, { place: label, coords, region: null })
                        }
                      />
                    ) : (
                      <LocationAutocomplete
                        name={`dest-${d.id}`}
                        placeholder="City or destination (e.g. Dawson City)"
                        defaultValue={d.place}
                        invalid={unresolved}
                        onSelect={(label, coords, region) =>
                          setDest(d.id, { place: label, coords, region })
                        }
                        // Freeform typing invalidates the resolved pick — clear the
                        // region with the coords so the two never disagree.
                        onTextChange={(t) =>
                          setDest(d.id, { place: t, coords: null, region: null })
                        }
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDest(d.id, {
                        manualCoords: !d.manualCoords,
                        place: "",
                        coords: null,
                        region: null,
                      })
                    }
                    className="font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-amber shrink-0 px-1.5"
                  >
                    {d.manualCoords ? "search" : "coords"}
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="text-text-muted hover:text-text-primary disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === lastIdx}
                    className="text-text-muted hover:text-text-primary disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDestinations((ds) => ds.filter((x) => x.id !== d.id))
                    }
                    disabled={destinations.length <= 2}
                    className="text-text-muted hover:text-input-error disabled:opacity-30"
                    aria-label="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
```

Toggling **into** coords mode clears `place`/`coords`/`region` (the row goes
back to "pick a suggestion" / "enter coordinates" empty state rather than
carrying over a half-resolved autocomplete pick); toggling back to search
mode does the same in reverse. This matches the existing `onTextChange`
behavior a few lines up, which already clears `coords`/`region` together
whenever the resolved state is invalidated — the toggle is one more case of
that same rule, not a new one.

- [ ] **Step 5: Typecheck**

Run: `npm run -w web typecheck`
Expected: PASS — this is the point where the Task 2 `manualCoords`-missing
errors flagged in Task 2 Step 4 are resolved, since every `ExpeditionDestination`
literal in this file now includes the field.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/plan/expedition-wizard.tsx
git commit -m "feat(plan): wire manual coordinate entry into the destination rows"
```

---

## Task 5: Gate — typecheck + build (both, per CLAUDE.md)

**Files:** none (verification only)

- [ ] **Step 1: Run the web typecheck**

Run: `npm run -w web typecheck`
Expected: exit 0.

- [ ] **Step 2: Run the web build**

Run: `cd web && npx next build`
Expected: exit 0.

- [ ] **Step 3: If either fails, fix and re-run both before proceeding**

Do not proceed to Task 6 until both commands in this task exit 0 in the same
run — `next build` alone does not type-check every file in scope
(`CLAUDE.md` §STANDING RULES), so a pass on build alone is not sufficient
evidence.

No commit for this task — it's a checkpoint, not a change.

---

## Task 6: Real pipeline + persistence verification script

**Files:**
- Create: `web/scripts/verify-manual-coordinate-anchor.ts`

**Interfaces:**
- Consumes: `expeditionToGenerationInput`, `validateExpeditionForm` from
  `@/lib/plan/expedition`; `preComputeFacts` from `@/lib/itinerary/facts`;
  `generateAndAudit`, `ItineraryGenerationError` from
  `@/lib/itinerary/generate`; `bakeGeneratedDays` from
  `@/lib/itinerary/bake`; `itineraryToTrip` from `@/lib/itinerary/to-trip`;
  `attachHeroPhotos` from `@/lib/imagery/destination-photo`;
  `createSupabaseServiceClient` from `@/lib/supabase/server`; `DEFAULT_RIG`,
  `vehicleTitle`-shaped literal from `@/lib/vehicles/types` (only the plain
  fields are needed, not the repository).
- Produces: nothing consumed by later tasks — this is a standalone verify
  script, matching the existing convention documented in `CLAUDE.md`
  RUNBOOK ("Verify scripts — each drives the REAL fns under the seeded owner
  JWT").

This script mirrors `generateExpeditionTripAction`
(`web/src/lib/plan/expedition-actions.ts:81-135`) function-for-function, so
it exercises the *exact* real pipeline a signed-in user's browser submission
would run — real Mapbox routing, real Claude generation, a real
`public.trips` insert under RLS — with one deliberate scope cut: it does
**not** call `enqueueResolvedPlaces` (the corpus write-back). That call
writes to the shared `source_record` table under a service-role client, and
per `CLAUDE.md`'s "Source integration workflow" a corpus-mutating write
needs a measured-baseline/restore discipline this verification doesn't need
to take on — the corpus write-back is orthogonal to whether coordinate-only
anchors route and generate correctly, which is what this script exists to
prove.

- [ ] **Step 1: Write the script**

Create `web/scripts/verify-manual-coordinate-anchor.ts`:

```ts
/**
 * Live verification that a manually-entered (coordinate-only, no `place_id`,
 * no Mapbox `region_code`) start and end anchor flows through the REAL
 * pipeline exactly like an autocomplete-picked one — real Mapbox routing,
 * real Claude generation, real `public.trips` insert under the seeded
 * owner's RLS session. Mirrors `generateExpeditionTripAction`
 * (`src/lib/plan/expedition-actions.ts`) function-for-function, minus the
 * corpus write-back (out of scope — see the docstring in the calling plan).
 *
 * Needs NEXT_PUBLIC_MAPBOX_TOKEN and ANTHROPIC_API_KEY, neither of which is
 * in .env.development.local (same gap as the existing Mapbox-token RUNBOOK
 * gotcha). Borrow both from .env.local without touching PROD Supabase:
 *
 *   export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)
 *   export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2-)
 *   cd web && npx tsx --env-file=.env.development.local scripts/verify-manual-coordinate-anchor.ts
 *
 * Costs one real Claude generation call and takes on the order of a minute.
 * Inserts one row into TEST `public.trips` and deletes it before exiting
 * (even on failure), so it leaves no residue — no snapshot/restore dance
 * needed since this is a single fresh insert with no corpus side effects.
 */
import { createClient } from "@supabase/supabase-js";
import {
  expeditionToGenerationInput,
  validateExpeditionForm,
  type ExpeditionForm,
} from "../src/lib/plan/expedition";
import { preComputeFacts } from "../src/lib/itinerary/facts";
import { generateAndAudit, ItineraryGenerationError } from "../src/lib/itinerary/generate";
import { bakeGeneratedDays } from "../src/lib/itinerary/bake";
import { itineraryToTrip } from "../src/lib/itinerary/to-trip";
import { attachHeroPhotos } from "../src/lib/imagery/destination-photo";
import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import type { Trip } from "../src/lib/trips/types";

const TEST_REF = "znldzjdatkogdktymtvi";
const OWNER = "seed-owner@overlander.test";
const PW = "seed-pw-manual-edit-8471";

function assertTest(url: string) {
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "?";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: ${ref}`);
}

let pass = 0,
  fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function main() {
  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN not set — see this file's docstring");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set — see this file's docstring");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  assertTest(url);
  const anonClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await anonClient.auth.signInWithPassword({
    email: OWNER,
    password: PW,
  });
  if (sErr || !sess.session) throw new Error(`signIn failed: ${sErr?.message}`);
  const authClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });

  // A two-destination form: START is a manually-entered coordinate near
  // Barstow, CA (no region, manualCoords true); END is what an
  // autocomplete pick for "Bishop, CA" looks like (has a region, the normal
  // path) — so the run exercises BOTH the new exemption and the untouched
  // baseline in one generation, and any regression in the normal path would
  // also show up here.
  const form: ExpeditionForm = {
    destinations: [
      {
        place: "Custom Point (34.8958, -117.0173)",
        coords: [-117.0173, 34.8958],
        region: null,
        manualCoords: true,
        datePin: "flexible",
        date: null,
        dwell: 0,
        note: null,
      },
      {
        place: "Bishop, CA",
        coords: [-118.4009, 37.3639],
        region: "CA",
        manualCoords: false,
        datePin: "flexible",
        date: null,
        dwell: 0,
        note: null,
      },
    ],
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    objective: "manual coordinate anchor verification — short 2-day run",
    budget: "mid",
    maxDailyDriveMi: 350,
    bufferDays: 0,
    avoid: [],
    returnRouting: "shortest",
    vehicleId: "v1",
    vehicleTitle: "Truck",
    rig: {
      vehicle: "Truck",
      build: [],
      fuelRangeMi: 400,
      capability: "mild",
      groupSize: "1-2 travelers",
      skill: "novice",
      preferences: [],
    },
  };

  check("validateExpeditionForm accepts a manualCoords start with no region", validateExpeditionForm(form) === null, String(validateExpeditionForm(form)));

  const input = expeditionToGenerationInput(form);
  check(
    "expeditionToGenerationInput carries coords onto the start anchor without needing place_id",
    Array.isArray(input.anchors[0].coords) &&
      input.anchors[0].coords![0] === -117.0173 &&
      input.anchors[0].coords![1] === 34.8958,
  );

  let tripId: string | null = null;
  try {
    const facts = await preComputeFacts(input);
    check(
      "preComputeFacts (real Mapbox routing) resolves a route from the manual coordinate — nonzero miles",
      facts.route.totalMi > 0,
      `totalMi=${facts.route.totalMi}`,
    );

    const { audited, dayRoutes, unresolved } = await generateAndAudit(input, facts);
    check("generateAndAudit (real Claude call) returns at least one day", audited.days.length > 0, `days=${audited.days.length}`);

    const supabase = createSupabaseServiceClient();
    const baked = await bakeGeneratedDays(audited, input, supabase, dayRoutes);
    const trip = await attachHeroPhotos(itineraryToTrip("", input, facts, audited, baked, dayRoutes));

    check(
      "the persisted trip's startLocation reflects the manual point, not a crash or empty string",
      typeof trip.startLocation === "string" && trip.startLocation.length > 0,
      trip.startLocation,
    );
    check("the trip has at least one day with routing data", trip.days.some((d) => d.coords != null));

    const { data: inserted, error } = await authClient
      .from("trips")
      .insert({
        owner_id: sess.user!.id,
        reference_id: null,
        title: trip.title,
        state: "active",
        payload: trip,
      })
      .select("id")
      .single();
    check("insert into public.trips (real RLS-scoped write) succeeds", !error && !!inserted, error?.message);
    tripId = (inserted as { id: string } | null)?.id ?? null;

    if (tripId) {
      const { data: readBack, error: readErr } = await authClient
        .from("trips")
        .select("payload")
        .eq("id", tripId)
        .single();
      const readTrip = (readBack as { payload: Trip } | null)?.payload;
      check(
        "reading the persisted row back shows the same start location and day count",
        !readErr &&
          readTrip?.startLocation === trip.startLocation &&
          readTrip?.days.length === trip.days.length,
        readErr?.message,
      );
    }

    if (unresolved) console.log("note: generateAndAudit reported unresolved anchors — see output above");
  } catch (err) {
    if (err instanceof ItineraryGenerationError) {
      check("pipeline run", false, `ItineraryGenerationError(${err.code}): ${err.message}`);
    } else {
      check("pipeline run", false, err instanceof Error ? err.stack ?? err.message : String(err));
    }
  } finally {
    if (tripId) {
      const { error: delErr } = await authClient.from("trips").delete().eq("id", tripId);
      check("cleanup — temp trip deleted", !delErr, delErr?.message);
    }
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run:
```bash
export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)
export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2-)
cd web && npx tsx --env-file=.env.development.local scripts/verify-manual-coordinate-anchor.ts
```

Expected: every `check(...)` line prints `PASS`; final line `N pass, 0 fail`;
exit 0. If `preComputeFacts` or `generateAndAudit` fails, re-read the printed
error before assuming a code defect — this is exactly the shape of failure
the RUNBOOK's Mapbox-token gotcha describes (missing token → silent
Haversine fallback, not a crash) and the ANTHROPIC_API_KEY-absent gate above
should catch the other half before the call is even attempted.

- [ ] **Step 3: Commit**

```bash
git add web/scripts/verify-manual-coordinate-anchor.ts
git commit -m "test: real-pipeline verify script for manual coordinate anchors"
```

---

## Task 7: Browser check of the new control (UI reachability, not full generation)

**Files:** none (manual/scripted verification only, no commit)

Task 6 already proves the full pipeline end-to-end through a real persisted
trip. What it does NOT prove is that the actual rendered control — the
toggle button, the two new text inputs, the inline error text — works in a
real browser under real hydration. This task closes that gap without
re-running a second costly generation.

- [ ] **Step 1: Start the dev server**

Use the `preview_start` tool (or `npm run dev` from `web/`) — port 3210,
talks to TEST via `.env.development.local`. Confirm
`ENABLE_PLANNER_WIZARD=true` is set there (it already is, per
`.env.development.local:6`).

- [ ] **Step 2: Mint a dev session and navigate to the wizard**

Use `web/scripts/mint-dev-session.ts` (reads `SEED_PASSWORD`) to get a
session cookie for `seed-owner@overlander.test`, patch its `expires_at` to
local-now per the RUNBOOK note on the ~1h clock skew, inject it into the
browser, and navigate to `/plan/expedition`.

- [ ] **Step 3: Drive and assert against the DOM directly — reachability, not just presence**

For the START destination row:
1. Confirm a button labeled "coords" is on-screen next to the location input
   (`getBoundingClientRect` on-screen AND `document.elementFromPoint` at its
   center resolves to that button, not an overlay — per the CLAUDE.md
   RUNBOOK lesson that a handler firing is not the same as a control being
   reachable).
2. Click it. Confirm the `LocationAutocomplete` input is replaced by two
   text inputs (placeholders "Lat (-90 to 90)" / "Lng (-180 to 180)") and the
   button now reads "search".
3. Type `34.8958` into the lat field and `-117.0173` into the lng field
   (real keystroke events, not setting `.value` and skipping `input`
   dispatch — React's controlled-input tracking requires the native setter +
   dispatchEvent pattern noted in this session's browser-verification
   memory). Confirm no inline error text appears and the row's "resolved"
   badge (the existing `<Check/> resolved` element keyed off `d.coords`)
   appears.
4. Type `95` into the lat field alone (leave lng as-is). Confirm the inline
   error "Latitude must be between -90 and 90." renders and the "resolved"
   badge disappears.
5. Fix the lat field back to `34.8958`. Click "search" to toggle back.
   Confirm the row returns to the `LocationAutocomplete` input, empty (per
   Task 4 Step 4's toggle-clears-state behavior), not left showing the stale
   coordinate label.

- [ ] **Step 4: Record the result**

No commit — this is a verification pass. Note the outcome (pass/fail per
sub-check) in the final report; if anything fails, return to Task 3/4 to fix
before proceeding to Task 8.

---

## Task 8: Docs pass

**Files:**
- Create: `docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`
- Modify: `docs/architecture/trip-creation-surfaces.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/STATE.md`
- Modify: `docs/LOG.md`
- Modify: `CLAUDE.md` (RUNBOOK gotcha extension only)

Per `CLAUDE.md` §END-OF-DAY DOC PASS: walk the doc set, update what this
session actually touched. `DATA_INVENTORY.md` is untouched — no schema, no
new data source.

- [ ] **Step 1: Write the ADR**

Create `docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`:

```markdown
# 2026-08-27 — Manual coordinate entry bypasses the planning-region gate

## Context

`/plan/expedition`'s destination rows are backed by Mapbox Geocoding v6
autocomplete (`location-autocomplete.tsx`) — see
`docs/architecture/trip-creation-surfaces.md` §2a. A prior read-only
investigation (this session) confirmed the pipeline already treats
coordinates as ground truth wherever a destination is consumed
(`preComputeFacts`, `routeBetween`, `itineraryToTrip`) — no `place_id` is
used anywhere downstream of the wizard, and `ExpeditionDestination.coords`
was already nullable. The one hard constraint in the whole path is
`isInPlanningRegion` (`lib/plan/planning-region.ts`): a strict-refuse gate
that requires a Mapbox `region_code` (CA/NV/UT/AZ/WA/OR), enforced both
client-side (autocomplete filters suggestions before render) and
server-side (`validateExpeditionForm`, called again inside
`generateExpeditionTripAction` before any LLM spend).

Adding a raw lat/lng entry point means that constraint has no `region_code`
to check — hand-typed coordinates carry no Mapbox response to read one
from. Two options: (a) reverse-geocode the typed point to recover a region
code and route it through the existing gate unchanged, or (b) exempt
hand-entered coordinates from the gate entirely.

## Decision

**(b) — hand-entered coordinates are exempt from the planning-region
gate.** This is a deliberate testing-scope shortcut, not a claim that the
gate's purpose stopped mattering. `ExpeditionDestination` gains a
`manualCoords: boolean` field, set `true` only by the new coordinate-entry
control; `validateExpeditionForm`'s region check reads
`!d.manualCoords && !isInPlanningRegion(d.region)` — narrowly scoped to
that one flag, not to "any destination with coords and no region," so a
future bug in the autocomplete path (e.g. a suggestion that slips through
without a region code) still fails closed instead of silently riding this
exemption.

Reverse-geocoding (option a) was not implemented. `reverseGeocodeCity`
(`lib/routing/reverse-geocode.ts`) already exists and returns a formatted
"City, ST" string via the same Mapbox v6 API, but does not currently expose
a discrete `region_code` — extending it was scoped out as unneeded for a
dev-only testing feature.

## Consequences

- A hand-entered coordinate **outside CA/NV/UT/AZ/WA/OR is accepted** and
  reaches generation. Downstream code that assumes in-region data
  (corridor-city gazetteer lookups, corpus fetches scoped to the six
  states) has not been audited against an out-of-region anchor — the
  underlying investigation confirmed the *type model* accepts it, not that
  every consumer *handles* it gracefully.
- The wizard is dev-only (`ENABLE_PLANNER_WIZARD` gate) and this is a
  minimal, ungated escape hatch within it — acceptable exposure for a
  testing surface, not something to carry into a production-facing
  coordinate-entry feature without revisiting this decision.
- If coordinate entry is ever promoted beyond testing, or the app's scope
  grows beyond six states, revisit: either wire `reverseGeocodeCity` to
  also return `region_code` and gate hand-entered coordinates the same way
  as autocomplete results, or make the exemption an explicit, reviewed
  product decision rather than a wizard default. Tracked in
  `docs/BACKLOG.md`.
```

- [ ] **Step 2: Update the architecture doc**

In `docs/architecture/trip-creation-surfaces.md`, in the table at line 283,
replace the `destinations[]` row:

```
| `destinations[]` | `LocationAutocomplete` rows | 2–8 ordered | 2 empty rows | yes | ≥2; every row non-empty; **every row must carry `coords`** |
```

with:

```
| `destinations[]` | `LocationAutocomplete` rows, or `CoordinateInput` in coords mode (added 2026-08-27, per-row toggle) | 2–8 ordered | 2 empty rows | yes | ≥2; every row non-empty; **every row must carry `coords`**; region required UNLESS `manualCoords` |
```

Immediately after the §2a section (after the paragraph ending "...which is a
sample, not a rate over the whole `country=us,ca&types=place` space.", before
the `### The destination autocomplete` heading), add:

```markdown
**Correction, 2026-08-27 — the gate now has one deliberate exception.**
`ExpeditionDestination` gained `manualCoords: boolean`, set by a new
per-row "coords" toggle that swaps `LocationAutocomplete` for a plain
lat/lng text-entry control (`coordinate-input.tsx`). When `manualCoords` is
true, `validateExpeditionForm`'s region check is skipped for that
destination — a hand-typed coordinate carries no Mapbox response to read a
`region_code` from, and the decision was to exempt rather than
reverse-geocode. Full reasoning:
`docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`.
**This means the "structurally cannot plan outside CA/NV/UT/AZ/WA/OR"
framing above now has an escape hatch** — see the correction in "The
destination autocomplete" section below.
```

In the `### The destination autocomplete` section, the "Two consequences
worth recording" list has this claim (around line 368-371):

```
1. **The wizard structurally cannot plan a trip outside the US and Canada.**
   `country=us,ca` bounds the suggestions, and validation *requires* every
   destination to carry `coords`, which are obtainable only by picking a
   suggestion. There is no freeform escape hatch `[read source]`.
```

Strike it through and correct in place, per this doc's own convention:

```
1. ~~**The wizard structurally cannot plan a trip outside the US and
   Canada.** `country=us,ca` bounds the suggestions, and validation
   *requires* every destination to carry `coords`, which are obtainable
   only by picking a suggestion. There is no freeform escape hatch `[read
   source]`.~~ **CORRECTED 2026-08-27 — no longer true.** Manual coordinate
   entry (`coordinate-input.tsx`, toggled per row) accepts any lat/lng
   worldwide with no `country=us,ca` bound and no autocomplete pick
   required — `coords` can now come from that control instead of a Mapbox
   suggestion. The planning-region gate is *also* bypassed for these rows
   (`manualCoords: true` exemption, see §2a correction above), so this is
   now a real, if narrow, escape hatch — deliberately, for a dev-only
   testing wizard `[read source, 2026-08-27]`.
```

- [ ] **Step 3: Add a BACKLOG entry**

Append to `docs/BACKLOG.md` (new section, following the file's existing
`## <title> (<date>)` heading convention):

```markdown
## Manual coordinate entry — region-gate exemption is a testing shortcut (2026-08-27)

`/plan/expedition`'s coordinate-entry mode
(`docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`)
exempts hand-entered lat/lng from the planning-region gate rather than
reverse-geocoding to recover a `region_code`. If this input mode is ever
promoted beyond dev-only testing, revisit: extend `reverseGeocodeCity`
(`web/src/lib/routing/reverse-geocode.ts`) to also return `region_code` and
gate manual coordinates the same way as autocomplete results.
```

- [ ] **Step 4: Update STATE.md**

Add a new masthead line at the very top of `docs/STATE.md` (line 1, pushing
the existing line 1 down), following the file's established
never-delete-only-append convention:

```markdown
# STATE — branch `gps-coordinate` · 2026-08-27 (**newest truth: manual GPS
coordinate entry for `/plan/expedition` start/end/stops, built on a prior
read-only investigation confirming no `place_id` dependency exists anywhere
in that path.** Per-row toggle (`coordinate-input.tsx`) swaps
`LocationAutocomplete` for a plain lat/lng text entry; `ExpeditionDestination`
gained `manualCoords: boolean`, which narrowly exempts that one destination
from the planning-region gate (`validateExpeditionForm`) — a deliberate,
ADR-recorded testing-scope choice to bypass rather than reverse-geocode
(`docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`).
Verified against the REAL pipeline: `web/scripts/verify-manual-coordinate-anchor.ts`
drives real Mapbox routing + real Claude generation + a real signed-in
`public.trips` insert/read-back/delete on TEST, mirroring
`generateExpeditionTripAction` function-for-function. See `## 2026-08-27`
below for the full session account.)

```

Add a new `## 2026-08-27 — manual GPS coordinate entry for expedition
start/end` section, inserted immediately before the existing `## 2026-08-24`
section, summarizing: what was built (the toggle + `CoordinateInput` +
`manualCoords` exemption), the ADR decision and its consequences, the
verify-script result (pass/fail counts — fill in from Task 6's actual
output), the Task 7 browser-check result, and the PR number once opened
(fill in after Task 9).

- [ ] **Step 5: Append to LOG.md**

Add a new `## 2026-08-27` entry at the top of `docs/LOG.md` (append-only,
newest at top), 3-8 bullets per the file's header convention: what was
investigated first (the read-only pass), what was decided (bypass vs.
reverse-geocode, and why), what was built, what the real-pipeline verify
script proved, and any surprise encountered while executing this plan (fill
in from actual execution — do not invent one if none occurred).

- [ ] **Step 6: Extend the RUNBOOK's Mapbox-token gotcha**

In `CLAUDE.md`, in the existing bullet under §RUNBOOK "Verify scripts" that
begins `⚠ **NEXT_PUBLIC_MAPBOX_TOKEN is NOT in .env.development.local...**`,
add one sentence noting `ANTHROPIC_API_KEY` has the same gap for any verify
script that calls `generateAndAudit`, with a pointer to
`verify-manual-coordinate-anchor.ts` as the example that borrows both from
`.env.local` the same way.

- [ ] **Step 7: Commit**

```bash
git add docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md \
        docs/architecture/trip-creation-surfaces.md \
        docs/BACKLOG.md docs/STATE.md docs/LOG.md CLAUDE.md
git commit -m "docs: manual coordinate entry — ADR, architecture correction, state/log"
```

---

## Task 9: Push and open a PR (no merge)

**Files:** none

- [ ] **Step 1: Push the branch**

Run: `git push -u origin gps-coordinate` (or the current branch name — do
not rename it, per the session's standing instruction not to rename the
branch unless explicitly asked).

- [ ] **Step 2: Open the PR against `main`, do not merge**

```bash
gh pr create --base main --title "feat: manual GPS coordinate entry for expedition start/end" --body "$(cat <<'EOF'
## Summary
- Adds a per-row toggle in `/plan/expedition` swapping the Mapbox autocomplete for a plain lat/lng entry control, for start/end/any stop.
- `ExpeditionDestination` gains `manualCoords: boolean`, which narrowly exempts that destination from the planning-region gate — a deliberate testing-scope decision, not a reverse-geocode. See `docs/decisions/2026-08-27-manual-coordinate-entry-region-exemption.md`.
- No downstream pipeline change: coordinates were already the preferred signal everywhere (`preComputeFacts`, `routeBetween`, `itineraryToTrip`); no `place_id` dependency exists anywhere in this path (confirmed by a prior read-only investigation this session).

## Test plan
- [ ] `npm run -w web typecheck` — exit 0
- [ ] `cd web && npx next build` — exit 0
- [ ] `npx tsx --test src/lib/plan/parse-coordinates.test.ts` — pass
- [ ] `npx tsx --test src/lib/plan/planning-region.test.ts` — pass (includes the new manualCoords-exemption test)
- [ ] `web/scripts/verify-manual-coordinate-anchor.ts` — real pipeline run, pass (see PR description / STATE.md for the actual pass/fail count)
- [ ] Manual browser check of the toggle + inline validation (Task 7)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Stop here — do not merge. Report the PR URL.

---

## Self-Review

**1. Spec coverage.**
- User's Step 1 (toggle affordance) → Tasks 3, 4.
- Step 2 (decimal lat/lng, range validation, `ExpeditionDestination`
  construction with `region: null`, plain label) → Tasks 1, 2, 3, 4.
- Step 3 ("trace explicitly, don't assume; narrowly scoped fix if needed")
  → Task 2 (the `manualCoords` flag *is* that narrowly-scoped fix, found by
  tracing the exact test in `planning-region.test.ts` that encodes the
  current invariant).
- Step 4 (spin up dev server, live-verify, create a real test trip, confirm
  generation + routing + payload) → Tasks 6 (real pipeline + persistence)
  and 7 (real browser UI reachability) — split because Task 6 alone can't
  prove the rendered control works, and re-running the full paid generation
  a second time from the browser to prove the same pipeline fact twice
  would be wasteful; Task 7 says explicitly why it doesn't repeat
  generation.
- "Never state a specific number unless computed" constraint → every
  numeric claim in the ADR/doc-pass tasks is either already-measured
  (carried from the investigation, cited) or explicitly left as "fill in
  from actual output" in Task 6/8, not invented here.
- "Check STATE/BACKLOG/decisions/architecture/DATA_INVENTORY, update if
  touched" → Task 8 covers all except DATA_INVENTORY, explicitly noted as
  untouched (no schema/data-source change) rather than silently skipped.
- "Commit, push, open PR, don't merge" → Task 9.

**2. Placeholder scan.** No "TBD"/"handle edge cases"/"similar to Task N"
found. Two spots intentionally defer to execution-time actuals rather than
inventing numbers: Task 6 Step 2's "if it fails, re-read the error" (can't
predict a live LLM/API outcome), and Task 8 Steps 4-5's "fill in from actual
output" (STATE.md/LOG.md entries must reflect what really happened, not a
pre-written narrative) — both are process instructions, not missing content.

**3. Type consistency.** `CoordinateEntryResult`/`parseCoordinateEntry`/
`formatCustomPointLabel` (Task 1) are the exact names Task 3's
`coordinate-input.tsx` imports. `CoordinateInput`'s `onResolve(coords,
label)` signature (Task 3) matches exactly how Task 4 calls it
(`onResolve={(coords, label) => setDest(d.id, { place: label, coords,
region: null })}`). `manualCoords: boolean` (Task 2) is the exact field name
Task 4's literals and Task 6's script both set. Verified no drift between
Task 2's `dest()` helper signature (`manualCoords = false` third param) and
its two call sites added in the same task.
