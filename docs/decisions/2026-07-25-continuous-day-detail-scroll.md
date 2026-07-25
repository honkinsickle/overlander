# Continuous day-detail scroll (Design A) — presentation layer only

**2026-07-25.** Status: **BUILT (view mode).** Edit mode still renders the
single-day swap (the bridge). Supersedes the "Parked" note in `docs/STATE.md`
and the "NOT built" line in `docs/architecture/itinerary-model.md` §4.

## Context

The day-detail center column was a one-at-a-time slideshow: click a rail day,
the center swaps to `{day ? <DayDetailCorridor/> : <DayDetailOverview/>}` inside
one scroll container (`day-detail-corridor-column.tsx`). Scoped 2026-07-25 as
Design A — a continuous windowed river of days — with an adversarial
falsification pass. The approach was decided; this session BUILT it.

The non-negotiable: **days stay SEPARATE underneath, CONTINUOUS on top.** Each
day remains its own regeneration/freeze unit (that is what lets day 5 re-plan
without touching day 1). The scroll is a PRESENTATION LAYER ONLY — the
partitioned model is untouched; only rendering becomes seamless.

## Decision

A new `ContinuousDayStack` (`components/trip/continuous-day-stack.tsx`) renders a
vertical slot per day and, via IntersectionObserver, mounts only the near-viewport
window; far days are height-holding placeholders. The column chooses it **only
when `!editMode` and a day is selected**; `editMode` and Overview keep the
existing single-day swap verbatim (the bridge). Pure scroll math
(`lib/trips/continuous-scroll.ts`) is unit-tested away from the DOM.

Key rule, caught by the falsification pass: **values cross the bridge, machinery
does not.** Every mounted day gets server-truth `placeOverrides` / `placeRanks`
(they drive pin placement + cluster order in VIEW mode, with no editMode guard),
with `editMode={false}` and `onMovePlace`/`onReorderPlace` absent. The optimistic
edit machinery (localOverrides, drag handlers, pending/error) stays out of the
windowed path — deferred to PR2.

Mechanics (all view-only):
- **Mount/unmount:** IO with a ~1.5-viewport off-screen buffer, so a day is
  mounted + measured *before* it scrolls into view (no in-view pop-in), and
  unmounts well off-screen.
- **No jump:** measured heights are cached in a `useRef<Map<dayId,number>>`
  (ResizeObserver); an unmounted day's placeholder holds its last measured height,
  so a day dropping out is height-neutral. Never-mounted days use a model-driven
  estimate `520 + 96 × placePool(day).length` (verified accurate: a 27-suggestion
  day estimated 3112 vs 3119 measured). Above-fold resizes are compensated into
  `scrollTop` (native `overflow-anchor` disabled so it isn't double-counted).
- **Selection:** `?day=` stays the single source of truth. On settle the stack
  calls the same `selectDay` writer the rail uses — **one fan-out per settle.**
  The map's flyTo is driven by `?day=`, so settle-only writes give settle-only
  flyTo for free (no per-frame strobe across the continent).
- **Settle timing:** `SETTLE_MS = 140` debounce after the last scroll event, with
  a **`MAX_WAIT_MS = 400` ceiling** — under slow *continuous* scroll the debounce
  never fires, so a flush is forced every 400 ms so the map/rail can't park on a
  stale day while the reader is further down.
- **Hysteresis:** a ±15%-viewport dead zone around the centered day, so the
  signal only flips when a boundary crosses center by a margin; settle is the
  backstop. (`pickCenteredDay`, unit-tested.)
- **Rail-click / external `?day=`:** scrolls that day to the top, guarded so the
  scroll observer doesn't re-write `?day=` through the intervening days.
- **Edit-mode bridge:** the stack flushes the centered day on unmount, so toggling
  into edit mode mid-scroll lands the single-day swap on the reader's day. The
  flush is guarded against the unmount-to-Overview case (which clears `?day=`) so
  it never resurrects a day the user just navigated away from.

Hydration was re-keyed: the `/api/places/details` effect now unions `placeId`s
across the **mounted day set** (one batched POST, same `!hydrated[]` guard),
instead of the single selected day. `hydrated` still accumulates on the parent
column, so scroll-back is free.

## Consequences

- **Two rendering paths for one surface is a BRIDGE, not a resting state.**
  Bridge-deletion condition: the single-day swap is removed once edit mode renders
  *inside* the windowed container with per-day optimistic overlays and drag
  verified on the 66-day fork (PR2). Until then, `editMode` keeps the verbatim
  swap.
- Presentation-only fence held: **zero diff** to `lib/trips/types.ts`,
  `resolve-corridor-cities.ts`, `corridor/bucket.ts`, `rescope-overlays.ts`,
  `corridor/derive.ts`, `carry-forward.ts`, `routing/day-suggestions.ts`,
  `resolve-suggestions.ts`, `trips/repository.ts`, `trips/actions.ts`,
  `curated-place.ts`, `node-actions.ts`. No new `Trip`/`Day` fields, no repository
  mutation or `/api/*` write from scroll code, no change to how
  `placePool`/`corridorCities`/`segmentSuggestions` are derived (read-only), and
  no day's regeneration/freeze made to depend on another day's mounted state.
- No new dependency: IntersectionObserver + ResizeObserver from scratch, no
  react-window/react-virtual (which would fight variable height and need
  approval).
- **Verified** on the reference slugs `la-to-deadhorse` (66 days) and
  `yotrippin-demo` (19 days), rendered anonymously in the slideup: continuous
  flow, windowing (66 slots / 3–6 mounted), cached-height no-jump, settle→`?day=`
  → rail highlight + map flyTo, rail-click with programmatic guard, Overview
  regression + flush-guard, monotonic (non-flapping) boundary crossing. Build
  `cd web && npx next build` exit 0; typecheck 0; 11 `continuous-scroll` unit
  tests.
- **Not verified end-to-end this session** (auth/data friction, not code risk):
  edit-mode swap (needs an authed UUID trip — the hand-minted-cookie path;
  unchanged verbatim render + build cover it) and saved-pins/order rendering
  (no reference trip carries overrides; wired to server truth by construction).

---

## Addendum 2026-07-25 (later the same day) — authed verification round + one fix

The "not verified end-to-end" gaps above were closed on an authed, editable
66-day TEST fork (`05b346df…`, forked from `la-to-deadhorse` via the app's own
`/api/trips/fork` as `seed-owner`; the handoff's PROD fork `762577ca…` is
unusable from dev — PROD/TEST wall).

- **Edit-mode bridge: VERIFIED.** Mid-scroll toggle (Edit clicked inside the
  140ms settle window, `?day=` stale at day-1, center at day-20) → flush wrote
  `day-20`, swap opened Day 20. Toggle back re-entered the stack at day-20.
  Drag-pin, same-node reorder, and kebab all work in the verbatim edit path
  (real `pinPlaceAction`/`setPlaceRankAction` writes, v0→v4).
- **Freeze: VERIFIED byte-level.** Real add-waypoint to day-2 → of 66 days
  exactly `["day-2"]` changed; trip-level only `routePolyline` cleared.
- **Saved order in the view stack: VERIFIED** (authored rank order renders,
  inverting server order, from server-truth `placeRanks`).
- **Saved pins: pre-existing gap surfaced, NOT a scroll regression.** A
  cross-node drag-pin mints a `nodeSeed` and writes the override against the
  **seed id**; baked `corridorCities` carry **plain slug ids**; the read spine
  never consumes `nodeSeeds`, so `applyPlaceOverrides` sees the override as
  dangling → inert (documented semantics) and the pin renders in its original
  bucket in VIEW mode. Proven equivalent to `main`'s old view path by running
  the shared `applyPlaceOverrides` on the live server state — identical inputs,
  identical function, identical output. Recorded in `docs/BACKLOG.md`.
- **Upward-scroll jump: FOUND and FIXED.** First mount of a never-measured day
  (estimate→measured) was uncompensated — the `heights` cache had no prior
  entry, so the guard skipped exactly the largest correction class; scrolling
  UP through never-mounted days jumped up to 366px per mount. Fix: seed the
  cache with the rendered placeholder estimate and compensate by the
  above-fold-clamped delta. Re-measured: 0px on all 16 upward steps, 0px
  downward.
- **Known edge (recorded, not fixed):** toggling Edit while a rail-click's
  smooth scroll is still in flight lands the swap on the fly-by day, not the
  click target — the unmount flush reads the centered-day ref, which tracks the
  animation. Unlikely interaction; revisit with PR2.
