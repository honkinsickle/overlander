# Day Column cutover to `resolvePlaces()` — plan (investigation only)

**Status:** PLAN ONLY, 2026-08-23. No code changed. Third of the four surfaces named in the
resolver-consolidation ADR (Search done #260; Date Detail done #266; then Day Column; then
Day-scoped browse).

**Scope of this doc:** what Day Column actually renders, whether there is anything to "cut
over" at all, and — since it turns out there is **no endpoint to wrap** — what would have to
change *elsewhere* (the write path) for Day Column to ever reflect `resolvePlaces()` output.

Evidence convention per `trip-resolution.md`. Every claim is tagged `[read source]` and was
re-read in full this session, not recalled. Companions:
`resolve-places-{search,date-detail}-cutover-plan.md` (the two prior cutovers) and
`docs/decisions/2026-08-21-place-data-resolver-consolidation.md` (the ADR that names the
four surfaces).

> **HEADLINE — there is no Day Column "cutover" in the Search/Date-Detail sense.** Day Column
> is a **passive renderer of the baked `Trip.days` JSONB**. It calls **no live endpoint** —
> so there is nothing to wrap, no client fetch to keep compatible, and no read-path flag to
> add. Verified against current code, not assumed (§1). The only way Day Column could ever
> reflect `resolvePlaces()` output is through the **write path** — the bake/generation
> process that populates `Trip.days.segmentSuggestions` — and that is a *generation-pipeline*
> change with write/staleness semantics, **not** a flag-gated route swap (§3–§6).
> **Recommendation: do not build a Day Column cutover PR (§7).** Forcing the flag/wrapper
> pattern onto a surface with no endpoint would be wrong.

---

## 1. What Day Column renders — `Trip.days` only, zero live calls (verified)

Day Column and Date Detail are the **same component**, `DayDetailCorridorColumn`
(`day-detail-corridor-column.tsx`) — confirmed by the drift guard
(`day-column-renderer-drift.test.ts`: "the ONE day-column renderer"). The ADR splits them by
**data source**, not by file:
- **Day Column** = the day's place tiles sourced from baked `Trip.days`.
- **Date Detail** = the live Google enrichment layered on top of those tiles (the
  `POST /api/places/details` hydration — already cut over, #266).

**Tile source is `Trip.days` only** `[read source]`. `placePool(day)` builds the tiles from
`day.segmentSuggestions ∪ day.suggestions ∪ day.waypoints`
`[day-detail-corridor-column.tsx: placePool]` — all baked payload fields. Nothing is fetched
to render them.

**The renderer's only live calls are Date Detail's** `[measured 2026-08-23: grep of the
whole file for `fetch(`/`/api/`]`. The sole `fetch` sites are the two `POST
/api/places/details` calls (the windowed auto-hydrate and the fetch-on-open fallback) — both
the **enrichment** layer (Date Detail, #266), not the tile render. Day Column proper issues
**no request of any kind.**

This matches the ADR verbatim: *"Day Column reads `Trip.days` (JSONB on `trips.payload`)
only"* `[decisions/2026-08-21-…:11]`. The premise in the task holds under fresh reading.

---

## 2. Is there anything to cut over? — No endpoint, so no read-path cutover

Search wrapped `GET /api/search-area`; Date Detail wrapped `POST /api/places/details`. Day
Column has **no equivalent** — it reads a JSONB column that some earlier process already
wrote. There is:
- **no endpoint** to thin-wrap,
- **no client fetch** whose response shape must stay byte-identical (the "no client shape
  mismatch" check is N/A — the render consumes `CorridorPlace` from `placePool`, never a
  network payload),
- **no read-path flag** analogous to `SEARCH_AREA_USE_RESOLVER` / `DATE_DETAIL_USE_RESOLVER`
  that could gate "call resolvePlaces vs the old endpoint," because there was never a call.

So the Search/Date-Detail template does not apply. The real question is the one the task
anticipated: *should the process that WRITES `Trip.days` source its tiles via
`resolvePlaces()`* — a different kind of task.

---

## 3. The write path — what bakes `segmentSuggestions` (the only lever)

`Trip.days.segmentSuggestions` (Day Column's corpus-tile source) is written by
`[read source]`:

| Writer | Role |
|---|---|
| `itinerary/bake.ts` → `to-trip.ts` | Generation bake — the LLM-curated `cardTiles` become `segmentSuggestions`. |
| `trips/bake-corridors.ts` — `foldFederatedCorridorSupply` | **Corpus fold**: appends `mp:` corpus tiles to `segmentSuggestions`. Behind `USE_FEDERATED_CORRIDOR` (default **off**). |
| `trips/recompute-day.ts`, `split-day.ts`, `rest-day.ts`, `curated-place.ts` | Edit-time re-bakes (add/remove/split/move). |

The corpus fold is the piece that most resembles a "resolvePlaces source." It calls
`fetchCorpusForPolyline` → `supabase.rpc("pois_along_corridor", { p_buffer_m: 16000,
p_categories: null })` → `mapMasterPlaceRow(r, primaryCategoryToSlideKey(...))` → `BrowsePlace[]`
`[bake-corridors.ts:120-139]`.

**Crucially, that is the SAME RPC and the SAME mapper `resolvePlaces()`'s `day-corridor`
scope already uses** (its federated half is `fetchFederatedPois` → `pois_along_corridor` →
`mapMasterPlaceRow`). So the write path is already, in effect, the federated half of
`resolvePlaces()` day-corridor — minus the concurrent LIVE `discover()` half, the
cross-source merge, and the tier sort. Routing it *through* `resolvePlaces()` would add those,
but for Day Column specifically it would be **largely redundant plumbing over the same
source**.

---

## 4. Tiering (#255/#256) and #254 — already baked where they apply; not consumed at render

Traced for this surface, not assumed:

- **#254 (category narrowing) — already reflected.** The corpus fold maps categories via
  `primaryCategoryToSlideKey` `[bake-corridors.ts:134]`, and the render carries
  `CorridorPlace.category` through to the card. `primaryCategoryToSlideKey` reads
  `PRIMARY_CATEGORY_TO_SLIDE`, which is **derived by inversion** from the
  `SLIDE_TO_PRIMARY_CATEGORY` that #254 edited `[federated.ts, read source]` — so #254's
  `recreation_area → scenic` and `facility → interest` moves flow through automatically.
  Baked tiles already carry #254 categories **without** `resolvePlaces()`.
- **Verified/Unverified (#255/#256) — baked but NOT rendered.** `mapMasterPlaceRow` sets
  `BrowsePlace.verified` from `description_source`, so the corpus fold *does* stamp a tier
  onto the baked `segmentSuggestions`. But **`placePool` drops it** — it maps
  `segmentSuggestions` into `CorridorPlace`, and `CorridorPlace` has **no `verified` field**
  `[read source: day-detail-corridor.tsx CorridorPlace type]`. (The card's
  `verified={!!p.placeId}` is a separate "Google-backed" boolean, not the tier — same naming
  collision flagged in the Date Detail plan.) So the tier is invisible on Day Column
  regardless of how the tiles are sourced. Where tiering *matters* for the day is
  **trip-stop suggestion** (`isSuggestable`), which is a generation/bake concern, not a Day
  Column render concern.

**Net:** neither #254 nor the tier requires a Day Column change. #254 is already baked; the
tier is not a render input here.

---

## 5. Client compatibility — N/A

There is no client fetch and no response contract to preserve. The render consumes
`CorridorPlace[]` from `placePool`, whose shape is fixed by `Trip.days`. Any write-path
change is transparent to the render **as long as the baked tiles keep the
`segmentSuggestion`/`BrowsePlace` shape** — which `resolvePlaces()` already returns
(`BrowsePlace[]`), and which the current fold already produces via `mapMasterPlaceRow`. So a
write-path change is shape-safe by construction; there is nothing to verify on the client
side.

---

## 6. If the write path WERE routed through `resolvePlaces()` — what changes (and the catch)

Should someone still want the write path to source via `resolvePlaces()` (day-corridor scope),
these are the real consequences — and why it is categorically unlike the read-path cutovers:

1. **It bakes into persisted `Trip.days`.** `resolvePlaces()` output would be **written to the
   `trips.payload` JSONB**, not rendered live. So tier/category/enrichment become a **snapshot
   frozen at bake time**, stale until the row is re-baked — the same staleness class as
   `master_place.state`/`photo_url`. Read-path surfaces recompute every request; this does not.
2. **Rollback is NOT a clean flag-flip.** Flipping a write-path flag off does **not** un-bake
   the rows already written. Unlike Search/Date-Detail (where a redeploy with the flag off
   restores prior behaviour for *every* request), reverting here means re-baking affected
   trips or living with mixed data. `dawson-vancouver-cassiar` is FROZEN, so it could not be
   re-baked at all.
3. **A flag already exists and is off:** `USE_FEDERATED_CORRIDOR` gates the corpus fold today
   (default off), so in production Day Column currently shows **generation-baked tiles only**,
   no corpus fold. Any resolvePlaces-sourced fold would live behind that same write-path flag,
   not a new read-path one.
4. **Scope creep into other work.** The corpus fold overlaps the **Day-scoped browse** cutover
   (the `/api/trip-browse` surface, which *is* an endpoint over the same corridor scope) and
   the generation pipeline. Consolidating the write path is better done there, or as part of
   ADR **step 4** (shared cache), than as a standalone "Day Column" change.
5. **Low marginal value for Day Column specifically.** The fold already uses the same RPC +
   `mapMasterPlaceRow` as `resolvePlaces()`'s federated half, and Day Column renders neither
   the tier nor the live-discover results — so the consolidation buys Day Column essentially
   nothing today. It would only matter if the write path also wanted the LIVE half merged in
   and persisted, which raises its own compliance question (Google fields have a 30-day cache
   limit — persisting them into `Trip.days` would violate it, the same reason Date Detail
   fetches live-at-render rather than baking).

---

## 7. Recommendation

**Do not build a Day Column cutover PR.** There is no endpoint, no client contract, and no
read-path flag — the Search/Date-Detail pattern does not fit, and forcing it would add a
flag/wrapper to a surface that never fetches. The four-surface framing over-counted Day
Column: it is not an independent read surface but the **rendered form of the write path's
output**.

If write-path consolidation onto `resolvePlaces()` is desired, treat it as **generation-
pipeline work**, decided on its own terms (staleness, re-bake/rollback story, and the live-
field caching-compliance question), and most naturally folded into either the **Day-scoped
browse** cutover (which shares the corridor scope and *is* an endpoint) or **ADR step 4**.
For Day Column in isolation it is not worth a change: #254 categories are already baked, the
tier is not a render input, and the fold already uses the same RPC + mapper `resolvePlaces()`
wraps.

**Flag name / rollback (the task's named items):** intentionally **not** proposed, because
they don't apply — there is no endpoint to gate and no request to roll back. The nearest
existing lever is the write-path flag `USE_FEDERATED_CORRIDOR` (default off); note that a
write-path flag's rollback is re-bake, not a redeploy, so it is not the clean toggle the
read-path cutovers have. Flagged here rather than inventing a read-path flag that would gate
nothing.
