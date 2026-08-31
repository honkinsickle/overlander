# Day-detail card description bug — investigation

**Date:** 2026-08-31
**Branch:** `day-card-description-bug` (branched from `main`)
**Scope:** Investigate why `description` "isn't displaying" on day-detail cards
for `oddity` and `food` category places.

## TL;DR

The primary finding is nailed down by post-first-pass screenshot evidence
(see §7): on the day-detail STOPS list (the left panel of the slide-up),
`CategoryListCard` renders a single narrative line via its `status` prop,
and `pickStatus()` binds that prop **exclusively to `keyStopNote`, never to
`description`**. So curated LLM key-stops (Philippe The Original, City Hall
Observation Deck) show the note; non-curated pool tiles (Japanese American
National Museum, Echo Mountain Picnic Site, Franklin Canyon Park) show
nothing — even though every one of those three has a populated
`master_place.description` in TEST DB. Confirmed per-place §7.

The data is fine. `mapMasterPlaceRow` writes description on every mapped
row. The three other surfaces I traced (slide-up overlay, Top Places
overview, `WaypointDetail`) all read description correctly. The gap is
exclusively at `CategoryListCard`, which has no description slot at all —
and `pickStatus` provides no `keyStopNote ?? description` fallback.

**Recommend a design decision from Adam before code changes,** because the
fix isn't mechanical — naively piping description into the `status` prop
breaks the compact 400×82 card layout (`status` is docstring'd "wraps so
the inline context reads in full" and a 2,345-char description would blow
it up). The design-spec-aligned fix (`slideup-overlay-states-v2.md`) is a
new description slot with a bounded line-clamp, which changes the card's
visual footprint. See §8 for the option set.

## 1. Data reality (TEST — `znldzjdatkogdktymtvi`)

Computed 2026-08-31 by `data/scripts/scratch-day-card-desc-audit.ts` (scratch,
to be deleted). All counts from `master_place` on TEST, filtered to
`is_searchable = true`.

| Category | Total | With `master_place.description` populated | Coverage |
|---|---:|---:|---:|
| `oddity`     | 2,747 | 2,735 | 99.6% |
| `restaurant` (the "food" bucket per ingester code) | 559 | 546 | 97.7% |

Description attribution (top 1,000 populated rows per category, sampled by
supabase-js default order):

- `oddity`: 1,000 / 1,000 from `atlas_oddities`.
- `restaurant`: 533 from `editorial_food`, 13 from `family_destinations`.

The LLM/template fallback table `master_place_generated_content` holds
descriptions for only 6 of the 12 oddity rows and 3 of the 13 restaurant rows
with a null `master_place.description` — a negligible slice.

`master_place_search_export` (the six-state view Typesense reads) sees
`description_source = 'source'` for essentially every row in scope
(998 oddity, 546 restaurant). The oddity delta (2,735 populated vs 998 in
view) is out-of-footprint geography, not this bug.

**Conclusion:** the data is there. Root cause is not "data missing".

Note on the "food" naming: the ingester source code (`editorial-food.ts:22`,
`family-destinations.ts:31`) sets `inferred_category = "restaurant"`. The
web-side slide-key taxonomy `SLIDE_TO_PRIMARY_CATEGORY.food` at
`web/src/lib/trip-browse/federated.ts:22-30` includes `restaurant` and 22
Google-place-type restaurant subtypes. So "food category on the card"
corresponds to `primary_category = 'restaurant'` (+ 22 subtypes) at the data
layer. Any measurement above filtered to just `restaurant` — the 22 subtypes
would extend the population; not measured this session.

## 2. Render path — where description does and does not show

Traced by Explore subagent 2026-08-31; verified against code line-by-line.

### 2a. `CategoryListCard` primitive — no description slot

`web/src/components/trip/category-list-card.tsx:29-57, 65-232` — renders
title, verified meta chip, `status` row, "Details →" link. **No `description`
prop, no description rendering, for any category.** Every day-detail
place tile that isn't a curated in-spine hero uses this primitive
(`day-detail-corridor.tsx:767, 921, 1050, 1073, 1163, 1225` and
`day-detail-node-blocks.tsx:415, 720, 866`).

This is not category-specific and pre-dates all oddity/food source work.

### 2b. Slide-up overlay `MapDetailOverlay` — reads description correctly

`web/src/components/trip/map-detail-overlay.tsx:237` —
`const description = wp?.description ?? place.description;` — rendered at
lines 697-709. No category conditional.

Dispatch payload constructed in
`day-detail-corridor-column.tsx:695-770`:
- Waypoint path: `description: wp.description`, `waypoint: wp`.
- SegmentSuggestion path: `description: sug.description`, plus a synthetic
  `waypoint` built via `browsePlaceToWaypoint(enriched, ...)` from the tile.
  The tile itself came from bake, which wrote description via
  `mapMasterPlaceRow` (§2d).

The client-side rich-field graft `/api/places/details` (POST) does **not**
carry description; it only grafts rating/reviewCount/photoUrl/priceTier/hours.
So the overlay's description is always the baked value, never overwritten.

### 2c. `day-detail-overview.tsx:501` "Top Places to Visit"

Renders `place.description` with `line-clamp-3`. Fed by `topPlacesForTrip`
(`web/src/lib/trips/top-places.ts:41-84`), which aggregates
`segmentSuggestions ∪ waypoints` and passes their descriptions through
unmodified. Same baked source as 2b. No category conditional.

### 2d. Mapper — `mapMasterPlaceRow` (single mapper across all surfaces)

`web/src/lib/trip-browse/federated.ts:214-301`. Called from
corridor browse (`federated.ts:338`), search hydrate
(`hydrate.ts:178`), and the day-detail bake path
(`bake-corridors.ts:137`). Description write at lines 253-255:

```ts
description:
  row.description ??
  `${row.canonical_name} — ${prettyCategory(row.primary_category)}.`,
```

**Fallback is unconditional** — a mapped tile never has empty description.
So a description-shaped bug downstream of this mapper cannot be caused by
"the mapper dropped it for oddity/food". It could only be caused by (a) the
tile bypassing this mapper entirely, or (b) a display-time filter, or (c)
the renderer not having a description slot (see 2a).

### 2e. Category-conditional filters near description

Two exist. Neither drops description for oddity/food specifically:

- `isRealContent` (`day-detail-corridor.tsx:323-325`):
  `p.category !== "fuel" && hasDescription(p)`. Used by
  `filterVisibleSpineItems` to hide **city block headers** whose entire
  tile pool is fuel or descriptionless. Never strips individual tiles.
  Rare oddity/food tile with no description could be part of a
  descriptionless pool that hides its city, but the tile itself doesn't
  disappear from the pool.
- `isClosedPlace` / `isClosedDescription` (`federated.ts:99-138`, added
  in PR #320 landed 2026-08-31): a display filter that **drops the whole
  row** when the description strongly indicates the place is closed.
  Applied uniformly across categories at all three
  `mapMasterPlaceRow` call sites. Not description-suppressing; the
  row is present or absent. Precision on TEST was measured at ~97%
  (PR #320 body), so ~3% false-positive drops are possible — worth
  quantifying against oddity/food specifically if reports indicate
  category-wide tile disappearance, but that would present as
  **missing cards**, not "cards with missing description".

## 3. Design ↔ implementation gap (potential root cause candidate A)

`docs/design/slideup-overlay-states-v2.md:86` describes the Day Detail
`Banff Townsite` waypoint card **with description + amber tip**, and line 128
specifies result-row typography including `Barlow Regular 13 px description`.
`docs/design/location-detail-food.md:31, 61, 81-87, 174` calls for
Title + description in the Header Block and a 3-line description in the
Description Section — which the slide-up overlay does implement (§2b).

The compact tile primitive `CategoryListCard` (§2a) does **not** implement
a description slot. This is a pre-existing gap — not a recent regression, not
category-specific — but it is the surface most literally described as
"day-detail card" and is the most likely target if the complaint is
"description is missing on the card".

Neither of the two docs the trace doc `docs/architecture/place-pipeline-trace.md`
cites — `docs/architecture/place-card-data-requirements.md` and
`docs/architecture/place-data-field-manifest.md` — **exists in the repo**.
The trace doc's own summary of the manifest says "REQUIRED — coords (hard,
silent drop), title, photoAlt" and description falls under "NICE-TO-HAVE,
degrades gracefully — ... narrative fields ...". The `BACKLOG.md:3102` entry
independently confirms "`title`/`coords` (canonical_name and geometry) …
the two truly hard-required fields for a place card to render at all."

**The handoff's premise — "the place-card field manifest requiring
description as a hard product requirement for card display" — is not
supported by any doc I could locate in the repo this session.** If a newer
canonical manifest exists off-repo, the finding above stands but its framing
would change from "design gap" to "regression against the manifest".

## 4. What the bug is actually about — need clarification

Before code changes, please tell me which surface shows the bug:

1. **Compact `CategoryListCard` tile** (the small 400×82 tile under each
   city block on day-detail). Description does not render for any category.
   Fix = add a description slot to the primitive per
   `slideup-overlay-states-v2.md`. Not a regression, not oddity/food specific.

2. **Slide-up `MapDetailOverlay`** (opens on "Details →" click). Description
   read path is correct in code; data is populated in DB. If empty here for
   oddity/food specifically, would need a live browser repro to see the DOM
   state — probable causes would be an old baked trip (`Trip.days[].segmentSuggestions.description = null` from a pre-2026-08-27 bake) or edit-added
   tiles that didn't go through bake.

3. **`day-detail-overview.tsx` "Top Places to Visit"** overview card. Same
   read path as 2; same expected behavior; same live-repro requirement if
   blank.

## 5. LLM-description branch (`puebla`) — orthogonal, not the cause

`puebla` branch does not exist in this workspace as a local branch and
`git fetch origin puebla` returns `couldn't find remote ref puebla`.
Cannot inspect from here.

Regardless of that branch's state, the LLM descriptions in
`master_place_generated_content` are a **fallback** to `master_place.description`
(migration comment 20260821000000): "show master_place.description when
present; fall back to this table only when null. Never both". For
`oddity` (99.6%) and `restaurant` (97.7%), the primary path is populated by
non-LLM sources — the LLM fallback would apply to at most ~12 + ~13 = ~25
rows. LLM wire-up being unshipped is not the root cause.

## 6. Post-first-pass evidence — STOPS list, 5-place spot-check

Adam surfaced a screenshot after §1-6 were written. The visible surface is
the day-detail left-panel STOPS list. Some cards show a line of text under
the title; others show only "Details →". Five places named:

Traced to `day-detail-corridor.tsx:112-116`:

```ts
function pickStatus(p: CorridorPlace): string | undefined {
  if (p.isOvernight)
    return p.keyStopNote ? `Overnight · ${p.keyStopNote}` : "Overnight";
  return p.keyStopNote;
}
```

Called at every `CategoryListCard` render site on this component
(lines 771, 1054, 1077, 1167, 1229). **`pickStatus` reads `keyStopNote`
only — never `description`.** Non-curated pool tiles (no `keyStopNote`)
therefore pass `status={undefined}`, which the card hides
(`category-list-card.tsx:189-212`) — leaving the tile with just title,
verified meta, and "Details →".

Per-place cross-check on TEST 2026-08-31
(`data/scripts/scratch-day-card-desc-perplace.ts`):

| Place                              | primary_category | `description` in DB | Visible on card | Bug shape |
|---|---|---:|---|---|
| Philippe The Original              | `restaurant`     | 710 chars | keyStopNote text ("downtown LA breakfast/early lunch…") | Card shows keyStopNote; description present in DB but unused here |
| City Hall Observation Deck         | `viewpoint`      | 0 chars   | keyStopNote text ("near Los Angeles, CA, at the start of the day") | Card shows keyStopNote; no description in DB either way |
| Japanese American National Museum  | `facility`       | 852 chars | nothing | description PRESENT, `keyStopNote` missing → card blank |
| Echo Mountain Picnic Site          | `facility`       | 53 chars (HTML tag wrap) | nothing | description present-but-thin, `keyStopNote` missing → card blank |
| Franklin Canyon Park               | `park_feature`   | 2,345 chars | nothing | description PRESENT, `keyStopNote` missing → card blank |

Adam's per-message hypothesis "the text under Philippe/City Hall might be a
curated note, not description" is **confirmed by code and by data**:

- Philippe's DB description ("Stepping into Philippe The Original in Los
  Angeles feels like entering a time capsule of culinary history.
  Established in 1908, this iconic eatery is credited as the birthplace of
  the French Dip sandwich…") is nothing like the card text ("downtown LA
  breakfast/early lunch — the original French-dip, cheap coffee, easy GX
  parking to fuel up before the drive"). The card text is the LLM's
  per-trip `keyStopNote`, generated during the bake pass (see
  `web/src/lib/itinerary/bake.ts:142, 219, 225` where `keyStopNote` is
  stamped from `noteByRef` / overnight-tile notes).
- City Hall Observation Deck has `desc_len=0` in DB — the visible card text
  ("near Los Angeles, CA, at the start of the day") cannot be description
  because none exists; it too is the `keyStopNote`.

Category labeling drift also worth noting: Adam called Japanese American /
Echo Mountain "oddity" and Franklin Canyon "interest/scenic". Actual
`primary_category` values are `facility` (JANM + Echo Mountain) and
`park_feature` (Franklin Canyon). Per the taxonomy
(`federated.ts:17-63`), `facility` maps to the `interest` slide bucket
(residual) and `park_feature` maps to `scenic`. Neither is in the `oddity`
bucket. Doesn't change the finding — the bug is bucket-agnostic — but
whatever product-language shift is intended for the "oddity/food" framing
does not map 1:1 to the data-layer `primary_category`.

Reconciliation with §2a: my prior claim "CategoryListCard renders no
description at all, for any category" was too narrow. **Accurate:** the
primitive has no `description` prop and never renders description.
**But** it does render one narrative line via `status`, and callers bind
`status = keyStopNote`. Under `day-detail-corridor.tsx`'s `pickStatus`,
the card shows the LLM's per-trip curation when present, and nothing
otherwise. The prior finding was correct about the primitive; incomplete
about the caller wiring.

## 7. Option set for the fix — Adam decides

`pickStatus`-level fallback (`return p.keyStopNote ?? p.description`) is a
tempting one-line change but **not viable as-is**: `status` on
`CategoryListCard` renders with no truncation
(`category-list-card.tsx:196-208`, docstring: "Full note — wraps so the
inline context reads in full"). Franklin Canyon Park's 2,345-char
description would wrap into a 20+ line block, breaking the compact 400×82
card layout every time.

Real options:

**Option A — bounded status fallback (smallest change).**
Modify `pickStatus` to fall back to a truncated description
(`?? truncate(p.description, 120)`) and add a `line-clamp-2` to the
status render. Ships fast; preserves the current single-line "status" slot
concept; semantic conflation (keyStopNote and description in the same
visual slot) but reader can tell them apart by presence of the leading
green-dot bullet stays consistent. Doesn't match design spec.

**Option B — new `description` prop on `CategoryListCard`
(design-spec fix).** Add a `description?: string` prop below the
verified-meta / status row, rendered `Barlow Regular 13 px` with
`line-clamp-3` (matching `location-detail-food.md:61, 87` and
`slideup-overlay-states-v2.md:128`). Keep `status` for `keyStopNote`
(green-dot amber tip, per current design intent — "amber tip" in
`slideup-overlay-states-v2.md:63`). Wire all `CategoryListCard`
call sites to pass `description={p.description}`. Card visual footprint
grows (400×82 → likely 400×~118), which cascades through spine layout,
mile-gutter alignment, day-node vertical rhythm. This is the intended
fix per design docs but is a real UI change, not a bug-fix scale change.

**Option C — no code change, mark as design gap in BACKLOG.**
The card behavior IS internally consistent — LLM-curated stops surface
their note, others don't. If the product intent is "the STOPS list shows
LLM's per-trip curation, not editorial description" (which the current
implementation would support), then this is not a bug at all. Adam is
the only source of truth on this.

**My recommendation:** Option B, but only after Adam confirms the design
change is desired (the visual footprint change touches every day-detail
render and needs Design confirmation on line-clamp count + position
relative to status). If Adam wants an immediate shipping fix before that
design pass, Option A ships in <30 lines and captures the "some content
better than nothing" bar. Option C is only right if Adam has already
decided the STOPS list is curation-only.

Standing: **no code committed, no PR opened.** Per handoff — "commit
locally, push, and open a PR against main **if a fix is warranted**;
otherwise report findings only, then stop for Adam to review." The choice
between A/B/C is a design decision, not a technical one.

## 8. Standing rules notes

- **TEST only.** No PROD queries; `data/.env` verified pointing at
  `znldzjdatkogdktymtvi`.
- **All numbers computed this session** via
  `data/scripts/scratch-day-card-desc-audit.ts` (scratch — delete after
  investigation is closed).
- **Estimates flagged:** "~3% false-positive drops possible" in §2e is
  derived from PR #320's own precision claim, not re-measured this
  session against oddity/food specifically.
- **Branch drift flagged at session start** (see §Session opening in the
  handoff exchange) — workspace named `puebla`, current branch
  `day-card-description-bug`. No reconciliation attempted.
- No push, no PR — investigation-only per handoff scope.
