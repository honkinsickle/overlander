# Date Detail cutover to `resolvePlaces()` — plan (investigation only)

**Status:** PLAN ONLY, 2026-08-23. No code changed. Second of the four planned surface
cutovers (Search done via #260; then Date Detail; then Day Column; then Day-scoped browse).

**Scope of this doc:** what Date Detail's enrichment flow actually does end to end, whether
`resolvePlaces({ enrich: true })` as built can serve it, whether the Verified/Unverified
tiering (#255/#256) and #254 category mapping matter here, a flag name, a rollback plan,
and the blocker found.

Evidence convention per `trip-resolution.md`. Every current-behaviour claim is tagged
`[read source]` and was re-read in full this session, not recalled. Companion:
`resolve-places-design.md` (the service design, esp. **D3**) and
`resolve-places-search-cutover-plan.md` (the Search cutover, the model this follows).

> **✅ BLOCKER RESOLVED 2026-08-23 — the enrich-ids capability now exists (#263).**
> `enrichByGoogleId(ids) → Record<placeId, PlaceRich>` was built as a sibling in
> `resolve-places.ts` (the "new enrich-ids capability" this finding called for), so the
> shape gap below is bridged: a caller can now get the `place_id → PlaceRich` map from the
> resolver. Date Detail's cutover is therefore **unblocked** and becomes the thin route
> wrapper of §6 option 1 — **still not done here** (the route wiring +
> `DATE_DETAIL_USE_RESOLVER` is the next PR). See §2, §4, §6 for the updated status. The
> original finding is preserved below for the record.
>
> **⛔ HEADLINE FINDING (original) — Date Detail is NOT a thin route swap like Search, and
> there is a hard blocker.** Date Detail's route, `POST /api/places/details`, is an
> **enrich-by-id** service: it takes bare Google `place_id`s and returns `{ details:
> Record<placeId, PlaceRich> }` — enrichment *fragments*, not places. `resolvePlaces()`
> returns `BrowsePlace[]` and has **no mode that emits that map**. Worse, in `ids` scope it
> returns **nothing** for bare Google ids (traced in §2). So `enrich: true` cannot be
> "passed at cutover" the way the ADR's D3 note imagined — there is no place to enrich, and
> no place-shaped output the consumer can read. This surface needs a **new enrich-ids
> capability on `resolvePlaces()` (or a sibling)**, not a wrapper. Details in §2; options
> in §6. The Search-style flag/rollback are moot until that capability exists.

---

## 1. What Date Detail actually does, end to end `[read source]`

The sole client consumer of `POST /api/places/details` is
`components/trip/day-detail-corridor-column.tsx` `[measured 2026-08-23: repo-wide grep —
every other hit is a comment; `batch.ts`/`batch.test.ts` are the route's own helpers]`.

**a. Initial render is from `Trip.days`, not from a resolve.** `placePool(day)` builds the
day's tiles from the **baked** trip payload — `day.segmentSuggestions ∪ day.suggestions ∪
day.waypoints` `[day-detail-corridor-column.tsx:1194]`. Tiles render "essentials"
immediately (title, category, coords, and `photoUrl`/`placeId` when baked). **Nothing is
fetched to draw the first frame.** Corpus-backed tiles carry a Google `placeId`
(`BrowsePlace.placeId`, a bare `ChIJ…`), which is the hydrate key.

**b. Auto-hydration — the `enrich:true`-equivalent, today.** A `useEffect`
`[:307-350]` collects, across the mounted day window, the `placeId`s of tiles that are
`placeId && !photoUrl && !hydrated[placeId]`, and issues **one batched POST** to
`/api/places/details` with `{ placeIds }`. It reads back `{ details: Record<placeId,
PlaceRich> }` and merges into a `hydrated` map **keyed by place_id**
(`setHydrated(prev => ({ ...prev, ...details }))`). `PlaceRich = { rating?, reviewCount?,
priceTier?, photoUrl?, hours?, category? }` `[google-places.ts:250]`.

**c. A SECOND call site — fetch-on-open fallback.** Opening a tile's detail sheet for a
Google-backed tile not yet in `hydrated` fires a single-id POST `{ placeIds: [pid] }`
`[:775-796]`, caches the result into `hydrated`, and re-emits it into the open sheet.
Both call sites expect the **same** `{ details: Record<placeId, PlaceRich> }` shape.

**d. Merge/display.** `hydratePlaces(d)` `[:818]` grafts `hydrated[t.placeId]` onto each
tile with `??` fallbacks: `rating`, `reviewCount`, `photoUrl`, `priceTier`, and `category`
(with `overnight → hotel`). The day **hero** reuses `hydrated[destTile.placeId]?.photoUrl`
`[:848]`. The detail overlay's `synth()` grafts the same `PlaceRich` fields onto the
waypoint it emits `[:725-748]`. Everything is keyed by **Google place_id** end to end.

**The route itself** `[route.ts]`: validates `{ placeIds: string[] }`, walks them in
sequential batches of `BATCH_SIZE` (`= 40`, a concurrency ceiling, not an upstream batch),
each id concurrent, calls `placeDetails(id)` (Google Place Details, server-side key),
holds a per-lambda 15-min cache keyed by place_id, persists nothing, and returns the
`{ details }` map. A resolved-but-empty `{}` is deliberately surfaced (distinguishes "dead
id" from "nothing to add" so the client stops re-requesting); only `null` is withheld.

---

## 2. Can `resolvePlaces({ enrich: true })` serve this? — NO (the blocker) — ✅ RESOLVED via `enrichByGoogleId()` (#263)

> **✅ RESOLVED 2026-08-23 (#263).** The contract mismatch traced below is real and stands
> as the reason `enrich: true` / `ids` scope can't serve Date Detail. It is bridged not by
> changing `resolvePlaces()`'s return, but by the sibling `enrichByGoogleId(ids) →
> Record<placeId, PlaceRich>` — which returns exactly the map the consumer needs, with the
> same include-`{}`/omit-`null` semantics as `POST /api/places/details`. So the cutover no
> longer waits on the resolver; it is now the route wrapper of §6 option 1. The analysis
> below is preserved as the record of *why* the map capability (not a scope extension) was
> the right shape.

**Contract mismatch.** The consumer needs **`Record<placeId, PlaceRich>`**;
`resolvePlaces()` returns **`{ places: BrowsePlace[], counts, failedSources }`**
`[read source]`. `PlaceRich` is not `BrowsePlace`, and the consumer never wants a
`BrowsePlace` here — it already has its tiles (§1a) and wants only the volatile fields to
graft by id. This is exactly design **D3**: "`POST /api/places/details` does not return
places at all."

**And in `ids` scope, `resolvePlaces` returns nothing for these ids** `[read source]`.
Trace for a batch of bare Google `place_id`s:

- `resolveLive({ kind: "ids" })` → `return []` unconditionally — "By-id has no live
  discovery path… those ids are served as enrichment when `enrich` is on"
  `[resolve-places.ts]`.
- `resolveFederated({ kind: "ids" })` → `const { masterPlaceUuids } =
  partitionPlaceIds(ids); if (masterPlaceUuids.length === 0) return [];
  hydratePlacesByIds(masterPlaceUuids)` `[resolve-places.ts:466-468]`. A **bare** `ChIJ…`
  parses as `opaque` (place-id's rule: "a bare non-uuid with no known prefix is opaque, not
  probably-Google"), so it lands in `partitionPlaceIds`'s `other` bucket — **not**
  `masterPlaceUuids`, and `googlePlaceIds`/`other` are **ignored** by `resolveFederated`
  `[place-id.ts:216-247, read source]`. So `masterPlaceUuids` is empty → federated returns
  `[]`.
- Merge of `[]` + `[]` = `[]`. `enrichPlaces([])` early-returns `[]` (`wanted.length === 0`).

So `resolvePlaces({ scope: { kind: "ids", ids: [ChIJ…] }, enrich: true })` → **empty
result**. The enrichment step only ever grafts onto places **already in the resolved set**
that carry a `placeId` (`enrichPlaces`'s `idFor`) — and Date Detail's route has only the
ids, no places. The one machinery in `resolvePlaces` that would produce a `PlaceRich` is
`enrichPlaces → deps.placeDetails(gid)` — which is **the exact call `route.ts` already
makes directly**. Routing the endpoint through `resolvePlaces` would be a circular
indirection that returns the wrong shape.

**Conclusion:** the ADR's D3 note ("Date Detail passes `enrich: true` at cutover") describes
a desired end state but presupposes Date Detail *resolves places* via `resolvePlaces` and
gets them enriched. It does not — it enriches ids it already holds against baked
`Trip.days` tiles. There is **no thin wrapper** that makes `resolvePlaces` speak
`{ details: Record<placeId, PlaceRich> }`.

### Client-shape check (the Search-plan rigor, applied here)

Even setting the map aside: if a cutover instead had Date Detail **re-resolve** its tiles
through `resolvePlaces` (so `enrich` had places to act on), the output is `BrowsePlace[]`,
while the consumer's tiles are `CorridorPlace` derived from baked `Trip.days` and carry
fields a fresh resolve **cannot reproduce** — `curated`, `keyStopNote`, `milesFromStart`,
node/pin assignments, `curatedMovable`, `removable` `[day-detail-corridor.tsx:51,
day-detail-corridor-column.tsx:1194]`. Re-sourcing tiles from `resolvePlaces` would drop
the baked itinerary structure and change what's displayed — a client re-architecture, and
it overlaps the **Day Column / Day-scoped browse** cutover (the corridor scope), a
different surface. Out of scope for "Date Detail".

---

## 3. Verified/Unverified tiering (#255/#256) and #254 — traced, and orthogonal here

**Neither is consumed by Date Detail's enrichment path — and #259 does not (and need not)
cover it.** Traced, not assumed:

- **`PlaceRich` has no `verified` field** `[google-places.ts:250]`. The enrichment map
  carries `rating/reviewCount/priceTier/photoUrl/hours/category` only. So the tier can't
  ride through `/api/places/details` even in principle.
- **⚠ Naming collision — do not conflate.** Date Detail's card renders
  `verified={!!p.placeId}` `[day-detail-corridor.tsx:613, 767, 884, 907, 997, 1059]` — a
  **local boolean meaning "this tile is Google-backed,"** computed from the presence of a
  `placeId`. It is **not** `BrowsePlace.verified: "verified" | "unverified"` (the #255/#256
  tier). Same word, unrelated concept. A reader could easily believe Date Detail already
  consumes the tier; it does not.
- **The tier lives on the baked tiles, if anywhere, and nothing on this surface reads it.**
  `placePool`/`hydratePlaces` never reference `BrowsePlace.verified`
  `[measured 2026-08-23: grep of both Date Detail files — the only `verified` hits are the
  `!!p.placeId` card prop]`. So #259 (which fixed `verified` on the *search/hydrate* path)
  is genuinely irrelevant to this surface: Date Detail neither calls `hydratePlacesByIds`
  nor the corridor RPC for its tiles — they come pre-baked from `Trip.days`.
- **#254 (category narrowing) is upstream of the bake, not of enrichment.** Date Detail's
  tile categories are baked into `Trip.days` at generation time (the corridor engine, which
  uses `SLIDE_TO_PRIMARY_CATEGORY` — the map #254 edited). The enrichment path's
  `category` comes from **Google `types`** via `PlaceRich.category` (a different mapper,
  `overnight → hotel` at graft) — not from `SLIDE_TO_PRIMARY_CATEGORY`. So #254 changes
  *future generations'* baked categories, and touches neither `/api/places/details` nor
  any resolver cutover of it.

**Net:** for the *enrichment-route* cutover, tiering and #254 are non-issues — there is no
place resolution happening, so nothing to classify or category-map. They would only come
into play under the §2 re-resolve re-architecture, which is a different surface.

---

## 4. Flag name

Per the Search pattern (`SEARCH_AREA_USE_RESOLVER`), the flag for this surface would be:

- **`DATE_DETAIL_USE_RESOLVER`** — env boolean, **default OFF**, `=== "true"` to enable,
  mirroring `USE_FEDERATED_POIS`.

**✅ WIRED 2026-08-23 (see §7).** `DATE_DETAIL_USE_RESOLVER` (env boolean, default OFF,
`=== "true"`) now gates the route: OFF = the pre-cutover inline loop; ON = cache-misses
delegated to `enrichByGoogleId()`. The "gates nothing" note below is fully discharged.

> **⚠ (Original) But it gates nothing today (flagged, not dropped).** The user asked for a
> flag name and I've named it. Wiring it now would gate a branch that cannot be written
> coherently (§2): there is no `resolvePlaces` call that returns `{ details }`. Adding the
> flag before the enrich-ids capability (§6) exists would create a dead/degenerate ON branch
> — the exact "a check that cannot do its job" anti-pattern. **Recommendation: introduce
> `DATE_DETAIL_USE_RESOLVER` in the SAME change that adds the enrich-ids capability**, not
> before. (The route reads env at module load and the client reads env only via the server,
> so — as with Search — a flag flip = redeploy = fresh process/cache; no cache-key change
> needed when it does land.)

---

## 5. Rollback plan

Contingent on §6, but the shape is the same as Search once there's something to gate:

- **(a) Env flag** — `DATE_DETAIL_USE_RESOLVER`, default OFF; flip in Vercel to roll out,
  flip back to roll back (redeploy = fresh process). Preferred, because — unlike Search —
  this surface has **two** call sites and a client-side accumulation cache (`hydrated`), so
  a no-redeploy toggle is valuable.
- **(b) Revert the PR** — if the cutover is a route-internal swap (which it can only be once
  the route can produce `{ details }` from the resolver), the route file is the blast
  radius; `git revert` restores the direct-`placeDetails` body.

Either way the client (`day-detail-corridor-column.tsx`) must stay untouched — its contract
is `{ details: Record<placeId, PlaceRich> }`, and any cutover must preserve that byte-for-
byte (no `web/src/components` change), exactly as the Search cutover preserved its consumer.

---

## 6. Blocker and options

**The blocker (§2) — ✅ RESOLVED 2026-08-23 (#263):** `resolvePlaces()` had no capability
that maps a list of Google `place_id`s to `PlaceRich`. That capability now exists —
`enrichByGoogleId()`, the standalone map-returning function of option 1 — so the D3
divergence is bridged and Date Detail *can* cut over. What remains is the route wrapper
(next PR), not the resolver.

**Options, least-to-most invasive:**

1. **Add an enrich-ids capability to `resolvePlaces` (or a small sibling), then make the
   route a thin wrapper. — RECOMMENDED · ✅ TAKEN PATH.** The capability half is **done**
   (`enrichByGoogleId()`, #263); the route-wrapper half is the pending Date Detail cutover
   PR. Give the resolver a way to take Google
   `place_id`s and return their `PlaceRich` (the standalone version of what `enrichPlaces`
   does internally). The route then calls it and returns the existing `{ details }` map
   unchanged; the client is untouched. This finally centralises the `placeDetails` call +
   the 15-min cache under the resolver — which is where **ADR step 4 (one shared cache
   keyed by canonical id)** wants it. Scope: a resolver addition + a route wrapper + the
   `DATE_DETAIL_USE_RESOLVER` flag, all in one change. This is a *design* step, not the
   mechanical swap Search was.
   - Sub-decision to make first: does the enrich-ids output stay a `Record<placeId,
     PlaceRich>` (route-shaped, minimal client impact) or become `BrowsePlace[]` (resolver-
     shaped, forces a client change)? The minimal-risk answer is the map, mirroring today.
2. **Re-resolve Date Detail's tiles through `resolvePlaces` (§2 client re-architecture). —
   NOT RECOMMENDED here.** Replaces baked `Trip.days` tiles with live resolver output,
   loses baked itinerary fields (`curated`/`keyStopNote`/node assignments), changes the
   client, and overlaps the Day Column / Day-scoped browse (corridor) cutover. If wanted at
   all, it belongs to those surfaces, not Date Detail's enrichment.
3. **Leave `/api/places/details` as-is.** Legitimate: it is already the minimal correct
   implementation of "enrich these Google ids," and consolidation buys little until ADR
   step 4's shared cache lands. Revisit Date Detail *after* the enrich-ids capability
   exists (option 1), or fold it into the step-4 cache work directly.

**Bottom line (updated 2026-08-23, #263):** Search was a route that *resolves places*, so
`resolvePlaces` bbox was a near-drop-in. Date Detail's route *enriches ids the client
already holds* and returns a `place_id → PlaceRich` map — a shape `resolvePlaces`
deliberately treats as an internal step, never an output (D3). That "new resolver capability
first" is now **done** (`enrichByGoogleId()`, #263), so the cutover is the remaining route
wrapper (option 1): the ON branch delegates the fetch to `enrichByGoogleId()`,
`DATE_DETAIL_USE_RESOLVER` gates it (default OFF), the route keeps its `{ details }` shape
and its 15-min cache, and the client is untouched. Tiering and #254 are non-issues for this
surface (§3) — a real simplification relative to Search, and the one piece of good news
here.

---

## 7. Cutover — IMPLEMENTED (flag-gated, default OFF)

Wired on branch `feat/date-detail-resolver-cutover`.

**Flag:** `DATE_DETAIL_USE_RESOLVER` (env boolean, mirrors `SEARCH_AREA_USE_RESOLVER` /
`USE_FEDERATED_POIS`). **Default: OFF** — unset/anything-but-`"true"` runs the exact
pre-cutover inline loop. Flip to `"true"` in Vercel to roll out; a redeploy starts a fresh
process, so the in-process cache never serves a stale other-mode entry across a flip.

**Shape (thin wrapper, per §6 option 1):** `route.ts` keeps parse/validate + the 15-min
per-lambda cache + the `{ details }` response shape. The id → `PlaceRich` production moved to
`web/src/app/api/places/details/handler.ts` (`fetchDetailsMap`), behind a dependency seam +
injected cache ops so both flag states are unit-testable without network:
- **OFF → `viaLegacy`:** the pre-cutover inline batched fetch loop, verbatim.
- **ON → `viaResolver`:** cache first (the cache **stays at the route** — `enrichByGoogleId()`
  is cache-less by design, so this is option 1, NOT ADR step 4's shared cache), then delegate
  the misses to `enrichByGoogleId()`. A miss absent from that map resolved to `null` and is
  cached negatively — preserving the exact cache behaviour the legacy path writes.
- The client (`day-detail-corridor-column.tsx`) is **untouched**; the `{ details:
  Record<placeId, PlaceRich> }` shape is byte-for-byte identical in both states.

**Verified:**
- `handler.test.ts` — 8 tests, both flag states: OFF fetches via `placeDetails`, includes
  resolved (incl. `{}`), omits `null`, uses the cache; ON delegates misses to
  `enrichByGoogleId` (not `placeDetails`), caches a `null`-omitted miss negatively, serves
  cached ids without re-fetch. **Two PARITY tests** assert OFF and ON produce the **same
  `details` map** and leave the **cache in the same state** — the flag-off-unchanged +
  flag-on-matches proof.
- `web/scripts/verify-places-details-wired.ts` — LIVE (real Google Place Details; **no DB —
  pure passthrough**). Flag ON drove the real `POST`: 200, real enrichment
  (rating/reviews/photo/hours) for two real place_ids, and a garbage id **omitted** (null
  path survives). Flag-OFF contrast on the same ids returned **byte-identical** enrichment —
  both are Google passthroughs, so unlike Search there is no output difference; the routing
  difference (ON → `enrichByGoogleId`, OFF → `placeDetails`) is proven at unit level by the
  handler spies, and the live run proves the ON path is correct end-to-end (it would fail if
  the wiring dropped ids or returned empty).
- Gates: `npm run -w web typecheck` exit 0, `npx next build` exit 0; handler 8/8, batch
  helpers 11/11.

**Not done (intentionally):** the flag is NOT flipped on; no `web/src/components` change; the
shared client cache (ADR step 4) is untouched — the route keeps its own 15-min cache.
