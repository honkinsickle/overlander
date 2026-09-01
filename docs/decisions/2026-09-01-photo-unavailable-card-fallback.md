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
