# 2026-09-01 — "Photo Unavailable" fallback for photoless cards

## Context

`CategoryListCard` (the STOPS / day-detail list tile) rendered a flat
category-color block with the category icon badge on top whenever a place had
no `photoUrl`. The photo-coverage pilots established that a large share of POIs
are photoless (campgrounds especially), so this fallback is common, and a flat
color block reads as a rendering gap rather than an intentional "no photo" state.

## Decision

Replace the photoless fallback (only that case — cards with a real `photoUrl` are
untouched) with a dedicated "Photo Unavailable" treatment in `CategoryListCard`:
a blurred generic outdoor placeholder background, a legibility scrim, a centered
lucide `Image` glyph (rounded-square frame + circle + mountain, white line art),
and a "Photo Unavailable" caption. Built as a small local `PhotoUnavailable`
subcomponent in `category-list-card.tsx`; icon reused from lucide-react (already a
dependency) rather than hand-drawn; text uses `--ff-sans` + `--text-2xs` +
`--text-primary` tokens. The old flat-color-block path is removed, not left
alongside.

**Placeholder asset:** a **self-authored** SVG (`web/public/photo-unavailable-bg.svg`)
— an abstract muted sky/ridgeline gradient — rather than a sourced photo. This
asset ships to users, and a truly ship-safe license for a third-party photo
couldn't be verified in-session; a synthetic graphic is unambiguously safe. It's
one shared, non-category-specific asset, swappable later if a licensed hero image
is chosen.

## Consequences

- The category **icon badge no longer appears on photoless list tiles** (category
  is still conveyed by the title color tint). It remains on cards that have a
  photo.
- Applies uniformly to every `CategoryListCard` consumer (day-detail corridor,
  corridor-column, node-blocks, the demo page). **`MapDetailOverlay` does not use
  `CategoryListCard`** — it has its own photo rendering and is unchanged /
  out of scope for this change.
- Pure frontend; no DB dependency or schema change. Verified via the anon
  `/demo/category-list-card` page (all 9 variants are photoless) — headless
  screenshot confirmed the treatment renders on every card; `next build` +
  `typecheck` both green.

## Update — extended to the day / overview hero (same session)

A second blank surface was found: the **day-overview hero** (`day-detail-corridor.tsx`,
fed by `heroFor()` in `day-detail-corridor-column.tsx`) and the **trip-overview
hero** (`day-detail-overview.tsx` `Hero`). Both set `backgroundImage` only when a
URL is present and had **no fallback**, so a day/trip with no hero photo rendered
a bare `--bg-card` box (Adam's "empty black box" on day-1 of trip
`9e42a89d…`). This is the same data-gap class as the STOPS card: day-1 has no
`day.heroImage` and **0 of its segmentSuggestions carry a placeId**, so the
hydration path can never supply a photo — genuinely no source, not a wiring bug.

**Decisions:**
- Extracted the fallback into a shared `components/trip/photo-unavailable.tsx`
  (reused by CategoryListCard, the day hero, and the overview hero) with
  `iconSize`/`captionSize` props so the larger heroes scale the glyph/caption up
  — **one treatment + one SVG asset, no duplicate**.
- The **day hero** gates the fallback on a new `heroNoSource` signal
  (`heroHasSourceFor()`: no `heroImage` AND no destination `placeId`). When a
  source *exists but hasn't hydrated*, the hero stays a neutral box and fills on
  the next render — so a day that will get a Google photo does **not** flash
  "Photo Unavailable" first (task-4: don't show "unavailable" where a real photo
  should appear). The **overview hero** has no hydration path, so absent
  `imageUrl` is always a genuine no-source case.
- Verified on the exact reported URL (authed seed-owner session via CDP, software
  WebGL for Mapbox): **day-1 now shows the fallback; day-3 (has `heroImage`) still
  shows its real photo** — no regression to the photo path. Systemic, not
  isolated: multiple days/trips with no hero source were blank; all now fall back.

## Update — try the starting place's photo before "Photo Unavailable"

Resolution order in `heroFor()` is now: `day.heroImage` → **destination** photo →
**origin** photo → Photo Unavailable. Two changes:
- **Origin = `corridorCities[0]`** (the day's start city; for day-1 the trip
  origin) — confirmed against payload (each day's `corridorCities` runs start→end).
- **Tile photo resolution broadened** to the anchor-matched tile's baked
  `photoUrl` then its hydrated Google photo (was hydrated-only) — necessary
  because start/dest usually resolve a Commons/agency baked photo, not a Google
  one (day-1's San Diego start matches a tile with a baked `photoUrl` the
  hydrated-only path ignored). Additive: destination is still tried before origin,
  so a day with a destination photo keeps it (no regression). `heroHasSourceFor()`
  now returns true if EITHER endpoint has a tile with a photo or a hydratable
  placeId. The trip-overview hero mirrors this (`trip.heroImage` → last day's
  destination → first day's origin → fallback; computed in the column, passed via
  `heroNoSource`).
- Verified on the same URL (authed CDP): day-1 now shows the San Diego start-place
  photo (was "Photo Unavailable"); day-3 still shows its `heroImage`. Flag: the
  anchor-match is coords-based, so a city can match a nearby POI tile — day-1's
  "San Diego" resolves to a San Diego POI/food photo, not a skyline (same as the
  destination path). Genuine both-endpoints-sourceless days still fall back
  (gating checks both); no such day existed in this 3-day trip to screenshot —
  verified by logic + an offline resolution probe instead.
