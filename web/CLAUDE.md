@AGENTS.md

# OVERLANDER_01 — Web Client

The Next.js companion to the OVERLANDER_01 system. Trip planning, content authoring,
slideup-based trip viewing, sharing. Pairs with the iPad client via a shared Supabase
backend.

`AGENTS.md` (included above) is the source of truth for Next.js conventions, the
slideup build-and-verify rule, the worktree project-root rule, and offline testing
workflow. This file is the orientation for data shapes and code contracts that span
subsystems.

---

## Stack

- Next.js 15 — App Router, intercepting + parallel routes
- TypeScript (strict)
- Supabase JS SDK + `@supabase/ssr`; server actions for mutations
- Tailwind augmented by CSS custom properties in `src/app/globals.css`
- Mapbox (`mapbox/` integration); PWA + service worker at `public/sw.js`
- No state-management library beyond React + URL state + Supabase. The wizard
  uses its own store at `lib/plan/store.ts`.

---

## Critical conventions

### Server actions are the default for mutations

Match the existing pattern in `lib/trips/actions.ts`, `lib/plan/actions.ts`. Route
handlers under `app/api/` exist only for specific purposes — third-party API key
proxies (e.g. `api/places/photo`), debug surfaces with simulate flags, and
aggregation endpoints. Don't add a new `/api` route just to do a mutation that
belongs in a server action.

### Repository layer is the only path to data

`lib/trips/repository.ts`, `lib/plan/repository.ts`, `lib/vehicles/repository.ts`
are the entry points for all CRUD. Don't write direct Supabase queries in
components or routes — go through the repo. If a function doesn't exist, add it
to the repo.

### Design tokens live in `globals.css`

Single source of truth: `src/app/globals.css`. Tokens are CSS custom properties
on `:root`. Reference via `var(--token-name)`. Never hard-code a value that
exists as a token. If a needed token is missing, flag it; don't invent.

### Coordinate convention: `[lng, lat]` everywhere

Matches GeoJSON / Mapbox / Turf. Elevation when present is `[lng, lat, ele]` —
check `.length` before assuming 3D. Don't accidentally consume a Mapbox API
response as `[lat, lng]` without converting.

---

## Where things live

```
web/src/
├── app/                          App Router (intercepting + parallel routes)
│   ├── globals.css               source of truth for design tokens
│   ├── @modal/(.)trip/[id]/      canonical slideup overlay (per AGENTS.md)
│   ├── trips/                    /trips list + /trips/[id] detail
│   ├── trip/[id]/                legacy full-page route — do not extend
│   └── api/                      route handlers for proxies/debug/aggregation only
├── components/trip/              slideup-shell, map-column, day-detail, etc.
└── lib/
    ├── trips/                    Trip domain — canonical types live here
    ├── plan/                     wizard / draft state (own store)
    ├── routing/                  geometry helpers (polyline, geocode, route-between, segment-by-pace)
    ├── offline/                  PWA phase priming, coverage, drift, IDB status
    ├── vehicles/                 vehicle profiles
    ├── supabase/                 CSR / SSR / middleware clients
    ├── trip-browse/              browse-the-day catalog
    └── directions, discovery, events, imagery, location/   feature-scoped helpers
```

---

## Data model

**Canonical types live in `src/lib/trips/types.ts`** — the contract between web,
iPad, and Supabase. Don't invent parallel shapes elsewhere.

Persistence: `public.trips.payload` is a single jsonb column holding the full
Trip body (days, waypoints, overnights, offlinePhases). Deliberate per the
migration — normalized tables are an explicit non-goal.

Key types in `lib/trips/types.ts`: `Trip`, `Day`, `Waypoint`, `OvernightSelection`,
`Overnight`, `OfflinePhase`. From `lib/plan/types.ts`: `DraftTrip`, `WizardSlices`,
`PlanStep` (5-step wizard: going → vehicle → interests → stops → loader).

When the data model needs to grow, update `lib/trips/types.ts` first; the iPad
client mirrors from there.

### Reference trips are templates

`public.reference_trips` holds canonical trips (e.g. `la-to-deadhorse`).
Service-role write only; both clients read. Starting a trip from a reference
copies the payload into a new row in `public.trips`. Reference trips are never
modified by the copy.

---

## Design tokens (orientation)

Tokens originate from Adam's Paper style guide (`overlander_1` artboard `7US-0`).

- **Backgrounds:** `--bg-base`, `--bg-card`, `--bg-day-active`
- **Text:** `--text-primary`, `--text-muted`
- **Amber accents:** `--amber`, `--amber-dark`, `--amber-light`
- **Blue/cool for inputs & primary CTAs:** `--input-border-focus`, `--button-primary`
- **Category palette:** `--cat-fuel`, `--cat-camping`, `--cat-mountain`, `--cat-urban`, `--cat-food`, `--cat-oddity`, `--cat-attraction`, `--cat-neutral` (each with a `*-bg` sibling)
- **Fonts:** `--ff-sans` Barlow (body), `--ff-display` Space Grotesk (section labels, wide-tracked), `--ff-mono` Space Mono (IDs, hex, coordinates, tabular)
- **Spacing scale:** `4 · 8 · 10 · 12 · 14 · 16 · 24 · 48`

Color split: **amber for navigation, states, accents, and category emphasis;
blue for forms, inputs, and primary CTAs.** Ambiguous? Leave a comment and ask.

---

## Supabase

- **Migrations** — `supabase/migrations/`. Three tables: `users`,
  `reference_trips`, `trips`. All RLS-enabled. Both clients run anon key + user
  JWT; don't bypass RLS.
- **Auth** — `@supabase/ssr`. Use the helpers in `lib/supabase/` (client.ts,
  server.ts, middleware.ts). Don't roll new auth code.
- **Storage** — photos and GPX exports go to Supabase Storage. Bucket
  conventions are added as needed; flag when you need a new one.

---

## TypeScript

- **Strict mode is on.** Don't loosen it.
- **No `any` without an explanation comment.** `Record<string, unknown>` is
  preferable for genuinely loose data (see `Trip.wizard`).
- **Types live next to logic.** Each `lib/<domain>` has its own `types.ts`.
  Cross-domain types are re-exported, not duplicated.
- **Don't fight the existing types.** If `Day.coords` is `[number, number]`,
  work with that. Don't introduce a parallel `LatLng` interface in a corner.

---

## Working agreements

### Read first

Before working in a subsystem: `AGENTS.md` → the relevant `lib/<domain>/types.ts`
→ its `repository.ts` → any ADR in `docs/decisions/`.

### One feature per session

Don't refactor adjacent code while implementing a feature. If something nearby
looks wrong, leave a `// TODO(scope):` and move on.

### Ask before introducing a dependency

No new npm packages without approval.

### When in doubt, list options and stop

Design calls not already settled in a spec or the existing code — name
resolution, edge-case behavior, error UX — get listed with trade-offs. Don't
pick silently.

### Surface conflicts, don't paper over them

If a prompt contradicts AGENTS.md, this file, or existing code patterns, stop
and surface the conflict. Examples: building trip detail as a full page
(slideup is canonical), creating a new tokens file (use `globals.css`),
bypassing the repository layer.

### Commit discipline

Commit working chunks frequently. Short factual messages. Adam reviews diffs.

---

## Decisions (ADRs)

Non-trivial calls not covered by code get an ADR in `docs/decisions/`.
Date-prefixed filename, three sections (Context, Decision, Consequences), under
a page.

Existing:

- `docs/decisions/2026-05-21-offline-tile-caching-architecture.md` — phase-based
  offline tile cache, IndexedDB prime status, SW cache topology.

---

## Known gotchas (durable)

- **`Trip.wizard` is typed `Record<string, unknown>`** to avoid a circular
  import with `lib/plan`. The looseness is load-bearing — don't tighten it.
- **`Trip.referenceId`** is the `reference_id` text-FK column on `public.trips`,
  pointing at `reference_trips.id` slugs (e.g. `la-to-deadhorse`). Slug-as-FK
  — the comment in `types.ts` is accurate but non-obvious.
- **`Day.coords` is `[lng, lat]`** like everything else. Don't pick up
  `[lat, lng]` from a Mapbox response without converting.
- **`Day.coords` is the *end* of the day** (overnight); `Day.startCoord` is the
  *start*. The map flies to `startCoord` when the day becomes active. Don't
  compute one from the other — use the explicit field.
- **Trip detail = slideup, not a page.** Canonical surface is the intercepting
  route at `app/@modal/(.)trip/[id]`. `app/trip/[id]/` is a legacy/fallback
  view; don't extend it. See AGENTS.md for build-and-verify guidance.
- **Service-worker localhost bypass.** `public/sw.js` short-circuits to plain
  `fetch` when hostname is localhost. Verifying offline behavior locally
  requires the `FORCE_CACHE_IN_DEV` flag flip; cleanest verification is the
  Vercel preview. See AGENTS.md.
- **`OfflinePhase` (`lib/offline`) ≠ "Phase 01" UI label** in
  `slideup-shell.tsx`. Same word, different concept — `OfflinePhase`'s
  docstring spells it out.

---

## Non-goals (web client specifically)

These live on the iPad — the web client is for planning, authoring, reviewing,
and sharing:

- Active turn-by-turn navigation
- GPS track recording
- Field check-ins
- Photo capture
- Any native-mobile feel (web client targets desktop/laptop)

Offline: web has a degraded offline read mode via the PWA + per-phase tile
caches (see the ADR). The richer offline experience is iPad-side.
