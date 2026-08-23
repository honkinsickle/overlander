# Enrich-by-id capability for `resolvePlaces()` — plan (investigation only)

**Status:** PLAN ONLY, 2026-08-23. No code changed. This scopes the resolver-side
capability that the Date Detail cutover was found to require — the prerequisite that
unblocks `docs/architecture/resolve-places-date-detail-cutover-plan.md` (PR #261, **pending
review, not yet on `main`** at the time of writing).

**Scope of this doc:** what `resolvePlaces()` needs so it can, given a bare Google
`place_id` (or a set), return the enrichment fields (`rating / reviewCount / priceTier /
photoUrl / hours / category`) the current `POST /api/places/details` returns — the output
shape, the constraint (Google-only), the change surface, and how the
`DATE_DETAIL_USE_RESOLVER` flag becomes wireable once this lands.

**This is separate from and prior to the shared client cache (ADR decision 4).** The cache
sits *on top of* this capability once it exists; it cannot substitute for it. This doc does
not design the cache.

Evidence convention per `trip-resolution.md`. Every claim is tagged `[read source]` and was
re-read in full this session.

> **RECOMMENDATION (headline).** Add a small **map-returning** capability alongside
> `resolvePlaces()` — `enrichByGoogleId(ids) → Record<placeId, PlaceRich>` — by lifting the
> loop that already lives inside `enrichPlaces()`, and refactor `enrichPlaces()` to consume
> it. Do **not** extend `resolvePlaces`'s `ids` scope to do this: that scope's return
> contract is `BrowsePlace[]`, and `PlaceRich` cannot be represented as a `BrowsePlace`
> without synthesising fields that don't exist — and Date Detail's client wants the map,
> not places (§2, §4). The fetch machinery already exists; what's missing is a
> **map-shaped entry point**.

---

## 1. The reference — what `POST /api/places/details` does `[read source: route.ts]`

The behaviour the new capability must reproduce:

- **Input:** `{ placeIds: string[] }` — bare Google `place_id`s (`ChIJ…`), validated by
  `parsePlaceIds` (dedupe via `Set`, first-occurrence order preserved, reject non-strings).
- **Fetch:** walk the ids in sequential batches of `BATCH_SIZE` (`= 40` `[batch.ts]`), ids
  within a batch concurrent (`Promise.all`), one `placeDetails(id, signal)` per id
  (`placeDetails: (placeId, signal?) => Promise<PlaceRich | null>` `[google-places.ts:285]`).
  The 40 is an inherited **concurrency ceiling**, not an upstream batch limit — documented
  at length in `batch.ts`.
- **Cache:** per-lambda in-process LRU, 15-min TTL, keyed by place_id, storing `PlaceRich`
  **and `null`** (a negative cache); never persisted.
- **Output:** `{ details: Record<placeId, PlaceRich> }`. **Resolved-but-empty `{}` rides
  through** (a real place Google has nothing to add about); **only `null` — missing key /
  network / non-OK — is withheld.** This distinction is load-bearing: the client's
  `!hydrated[id]` guard reads a *missing* key as "not fetched yet" and re-requests, so `{}`
  present vs. key absent is the "resolved vs. failed" signal `[route.ts:94-108]`.

`PlaceRich = { rating?, reviewCount?, priceTier?, photoUrl?, hours?, category? }`
`[google-places.ts:250]` — all optional; the graft sites fall back with `??`.

---

## 2. What the resolver already has, and the one thing it lacks `[read source]`

`resolvePlaces()`'s `enrichPlaces()` **already fetches Google details** — same
`deps.placeDetails(gid, signal)`, batched by `ENRICH_BATCH` (`= 40`, identical to the
route's `BATCH_SIZE`), **no cache** (a deliberate stance: "the resolver holds no cache, so
it also can't reproduce the 15-minute negative-cache trap" `[resolve-places.ts:525-527]`).

What it lacks is an **entry point that takes ids and returns the map.** `enrichPlaces()`
takes `places: BrowsePlace[]`, derives each one's Google id (`idFor` =
`googlePlaceIdOf(id) ?? placeId`), fetches, and **grafts back onto the places** — returning
`BrowsePlace[]`. There is no way to say "here are ids, give me their `PlaceRich`," which is
exactly Date Detail's need. And `resolvePlaces`'s `ids` scope returns **empty** for bare
Google ids (they parse `opaque` → `partitionPlaceIds.other`, ignored by `resolveFederated`;
`resolveLive` returns `[]` for `ids`) — the blocker from the Date Detail plan §2.

**So the gap is a missing shape, not missing machinery.** The recommended change extracts
the machinery `enrichPlaces` already contains into a reusable, map-returning function.

---

## 3. (Q1) Does `ids` scope need a new Google path? — Not the way to serve Date Detail

`ids` scope *could* be given a branch that fetches Google details for its Google-formatted
ids. But that scope returns `BrowsePlace[]`, so it would have to **synthesise a
`BrowsePlace` per id** — and `BrowsePlace` requires `title`, `coords`, `photoAlt`, `pills`,
`stats`, `mention`, `description`, `pullquote`, `placeInfo`, `cta` `[places.ts, read
source]`, **none of which `PlaceRich` carries.** The result would be a mostly-empty stub
place whose only real content is the rich fields — awkward, lossy, and **still not what
Date Detail consumes** (§4). So extending `ids` scope does not solve the problem; it just
moves the shape mismatch.

**The correct read of "add a capability to `resolvePlaces()`":** add it to the
`resolve-places` *service/module* as a sibling function with its own return type — not as a
new member of the scope discriminated union. (Flagged as a deviation from the literal
"ids-scope needs a new code path" framing in the task; see §8.)

---

## 4. (Q2) Output shape — the `PlaceRich` map, NOT `BrowsePlace[]` (client-confirmed)

Date Detail's client consumes **`{ details: Record<placeId, PlaceRich> }`** at both call
sites — the windowed auto-hydrate (`fetch("/api/places/details") … details: Record<string,
PlaceRich>`, `[day-detail-corridor-column.tsx:329-338]`) and the fetch-on-open fallback
(`… const got = details?.[pid]`, `[:779-788]`) — and grafts by place_id into a `hydrated`
map. It **never wants a `BrowsePlace`** here; it already has its tiles (baked `Trip.days`).

Therefore the capability's return type is a **`Record<string, PlaceRich>`** (or
`Map<string, PlaceRich>`) — a **distinct return type** from `ResolvePlacesResult`, reusing
the existing `PlaceRich`. No new payload type is needed beyond that alias. This directly
answers the task's Q2: `resolvePlaces()` needs a distinct return **mode** for this case,
and it should be a separate function rather than an overload of `resolvePlaces`'s
single-return-shape contract.

The map must reproduce the route's presence semantics (§1): **include an entry for every id
Google resolved, including `{}`; omit only `null`.** That is exactly what a caller needs to
tell "resolved-empty" from "failed."

---

## 5. (Q3) Google-id enrichment only — verified true, a real constraint

Confirmed, not assumed `[read source]`:

- Date Detail sends **`t.placeId`** `[day-detail-corridor-column.tsx:322]`, and
  `BrowsePlace.placeId` is **"Google place_id … Set only for corpus rows backed by a google
  source; absent otherwise"** `[places.ts:68-71]`. So the id is always a Google place_id by
  construction — a tile with no Google backing has no `placeId` and is never sent.
- The only fetch in the enrichment path is `placeDetails()` (Google) `[route.ts:92]`. There
  is **no federated-details path** — Date Detail never enriches a corpus (`mp:`) id; it
  enriches the tile's *Google* id.

So "Google-id enrichment only" is not an assumed constraint — it is what the surface
actually does. The capability takes **raw Google place_ids** (not places) and need not
handle `mp:`/other forms. (Note the layering: `enrichPlaces`'s `idFor`
`[resolve-places.ts:513-514]` is the *place → id* extraction step and lives in
`enrichPlaces`, not in the proposed `enrichByGoogleId`, which receives ids directly. So a
non-Google id passed to `enrichByGoogleId` is not filtered by `idFor`; it would simply
resolve to `null` from `placeDetails` (Google not-found / non-OK) and be omitted from the
map — the same null-omit path as any failed id. An implementation *may* pre-filter
obviously non-Google ids to save a wasted upstream call, but that is an optimisation, not
required for correctness — the route does not pre-filter today.)

---

## 6. (Q4) The change — a new function + a refactor; estimate of what's touched

**Recommended shape (implementation NOT done here):**

1. **New export in `web/src/lib/places/resolve-places.ts`:**
   `enrichByGoogleId(ids: string[], opts?: { signal?; placeDetails?; batchSize? }):
   Promise<Record<string, PlaceRich>>`. It dedupes (Set, first-occurrence), batches
   (default 40 — the unified `BATCH_SIZE`/`ENRICH_BATCH`), calls the injectable
   `placeDetails` per id, and returns the map **including `{}`, omitting `null`** (§1). No
   cache (the resolver's stance; cache stays at the route until ADR step 4). `placeDetails`
   injectable for tests, mirroring the existing `ResolveDeps` seam.
2. **Refactor `enrichPlaces()`** to consume it: derive Google ids from the places →
   `enrichByGoogleId` → graft via `applyRich`. This DRYs the two and is behaviour-preserving
   — `enrichPlaces` today already grafts `{}` harmlessly (all `??`) and skips `null`, which
   the map's include-`{}`/omit-`null` semantics reproduce exactly. Verify with the existing
   `resolve-places.test.ts` enrichment tests as the regression guard.
3. **Type:** reuse `PlaceRich`; the public return is `Record<string, PlaceRich>`. No new
   type file.

**Files touched (estimate, for the eventual implementation):**

| File | Change |
|---|---|
| `web/src/lib/places/resolve-places.ts` | add `enrichByGoogleId` (export), refactor `enrichPlaces` to call it. Modest — the loop already exists. |
| `web/src/lib/places/resolve-places.test.ts` | new tests: dedupe, batching, `{}` included / `null` omitted, order, non-Google id skipped, injected-`placeDetails` seam. `enrichPlaces` behaviour unchanged (existing tests). |

**NOT in this capability (belongs to the subsequent Date Detail cutover PR):** the route
wrapper + `DATE_DETAIL_USE_RESOLVER` + its handler/verify. See §7.

**Open decisions (list, don't pre-decide — per web/CLAUDE.md):**
- **Home:** `resolve-places.ts` (co-located with the `enrichPlaces` it refactors, recommended)
  vs. a new `web/src/lib/places/enrich-by-id.ts` (keeps `resolve-places.ts` from growing).
- **Return `Record` vs `Map`.** `Record<string, PlaceRich>` matches the route's `details`
  shape 1:1 (least friction at the route wrapper); `Map` is marginally cleaner internally.
- **Batch constant unification.** `BATCH_SIZE` (route) and `ENRICH_BATCH` (resolver) are
  both 40 today; whether to collapse them into one shared constant the capability owns, or
  keep the route's `batch.ts` archaeology in place, is a small call for the implementer.

---

## 7. (Q5) Once this lands, `DATE_DETAIL_USE_RESOLVER` becomes wireable

Yes. With `enrichByGoogleId` returning `Record<placeId, PlaceRich>`, the Date Detail cutover
is a **thin route wrapper** — the shape the Date Detail plan §6 option 1 called for:

- `POST /api/places/details` gains `DATE_DETAIL_USE_RESOLVER` (default OFF). **OFF →** the
  current direct-`placeDetails` loop, unchanged. **ON →** delegate the *fetch* to
  `enrichByGoogleId`, keep the route's response shape (`{ details }`) and its cache. Client
  untouched (`{ details: Record<placeId, PlaceRich> }` preserved byte-for-byte).
- **The one wiring subtlety to carry into that PR:** `enrichByGoogleId` is **cache-less** by
  design. The route's 15-min per-lambda cache (incl. the negative cache) is what provides
  the dedup / no-refetch / negative-cache behaviour the client depends on. So the ON branch
  must still `cacheGet` per id first and call `enrichByGoogleId` **only for the cache-misses**,
  then `cacheSet` — not delegate the whole id list. Otherwise the cache is bypassed. (This
  is the seam where ADR step 4's shared cache eventually replaces the route's local one.)
- **Resolved-empty `{}` must survive** the delegation (§1) — `enrichByGoogleId` includes it,
  the route surfaces it, the client's `!hydrated[id]` guard stays correct.

**What changes in the Date Detail cutover plan** (`resolve-places-date-detail-cutover-plan.md`,
once this capability exists):
- §2 blocker (shape mismatch / `ids`-scope-returns-empty) → **resolved**: the map-returning
  capability is the bridge.
- §4's "the flag gates nothing / premature to wire" note → **lifts**: `DATE_DETAIL_USE_RESOLVER`
  now gates a real, coherent ON branch. Introduce the flag in the cutover PR, alongside the
  wrapper.
- §6 option 1 ("add enrich-ids to `resolvePlaces` + thin route wrapper") → becomes the
  concrete, taken path; option 2 (re-resolve tiles) and option 3 (leave as-is) stay
  rejected/deferred.
- Tiering (#255/#256) and #254 remain non-issues (§3 of that plan) — enrichment carries no
  `verified` and no `SLIDE_TO_PRIMARY_CATEGORY` mapping; nothing here changes that.

---

## 8. Deviations & open items (flagged, not dropped)

- **Deviation from "ids-scope needs a new code path" (task Q1).** I recommend a **sibling
  function**, not a new `resolvePlaces` scope, because the scope's `BrowsePlace[]` return
  can't carry `PlaceRich` without synthesising absent fields, and Date Detail wants the map
  regardless (§3, §4). The capability still lives in the `resolve-places` service, honouring
  the intent of "add it to `resolvePlaces()`". Implementing the intent; flagging the literal
  divergence here.
- **No number asserted** beyond code constants read this session (`BATCH_SIZE`/`ENRICH_BATCH`
  = 40, cache TTL 15 min, `CACHE_MAX_ENTRIES` = 1000). No corpus/traffic figures were
  measured, so none are quoted.
- **The cache boundary is deliberately left at the route** (§7), not moved into the
  capability, to keep this change orthogonal to ADR step 4 — as the task instructed. When
  step 4 lands, the shared client cache subsumes the route's local one; `enrichByGoogleId`
  stays cache-less either way.
- **Not verified this session:** whether `GOOGLE_PLACES_API_KEY` behaviour differs between
  the route's and the resolver's call sites (both call the same `placeDetails`, which reads
  the key itself `[google-places.ts:289]`, so no difference is expected — noted as
  unverified rather than asserted).
