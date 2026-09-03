# Day-scoped browse cutover to `resolvePlaces()` — plan (investigation only)

**Status:** PLAN ONLY, 2026-08-23. No code changed. Fourth and last of the surfaces named
in the resolver-consolidation ADR (Search done #260; Date Detail done #266; Day Column
#267 found to be a non-cutover; this is Day-scoped browse).

**Scope of this doc:** what `GET /api/trip-browse/:tripId/:dayId` does today, whether
`resolvePlaces()`'s `day-corridor` scope produces compatible output for the real client
consumer, how `USE_FEDERATED_POIS` relates to the cutover, tiering/#254 applicability, a
flag name, rollback, and any blockers.

Evidence convention per `trip-resolution.md`. Every claim is tagged `[read source]` and was
re-read in full this session. Companions: the three prior cutover plans and the ADR.

> **HEADLINE — this is a genuine endpoint and the CLEANEST of the four cutovers.** Unlike
> Date Detail (wrong shape — needed a new capability) or Day Column (no endpoint at all),
> `GET /api/trip-browse/:tripId/:dayId` is a real read endpoint whose behaviour
> `resolvePlaces()`'s `day-corridor` scope was **designed to mirror** — same live source
> order, byte-identical per-category radii, same corridor filter (`CORRIDOR_MI = 10`), same
> federated buffer (`FEDERATED_BUFFER_M = 16000`), same `fetchFederatedPois`. It is the
> direct analog of the Search cutover: a **thin-wrapper swap behind a new flag**, default
> off, with **no hard blocker**. The one real subtlety is that this surface already has a
> flag — `USE_FEDERATED_POIS` — and the two are **orthogonal** (§3).

---

## 1. What the endpoint does today `[read source: route.ts]`

`GET /api/trip-browse/:tripId/:dayId?category=|categories=|categories=all` — browse-panel
data for one day.

- **Params:** `categories=` (comma list or `all`) or `category=` (single). Bad category
  → 400.
  - **CORRECTED 2026-09-03 (bug fix).** Validation used to run against the 7-bucket
    `all`-expansion list, so `interest`/`urban` — both real chips — were rejected with a
    400. The one constant is now split: `ALL_VIEW_CATEGORIES` (**7 buckets**: `scenic,
    food, oddity, attraction, camping, overnight, fuel`) is still what `all` expands to,
    while `REQUESTABLE_CATEGORIES` (derived from `BROWSE_CARD_CATEGORIES` via
    `browseCategoryToSlide`) is what may legally be asked for. The asymmetry is
    deliberate: `interest`/`urban` have empty live query sets so they stay out of the
    `all` fanout, but a single-chip request for either now returns a normal (possibly
    empty) result.
- **Cache:** in-process LRU, 15-min TTL, 200 entries, keyed `tripId|dayId|sorted-categories`.
- **Trip/day resolution:** `getTrip(tripId)` → find the day → derive `dayStart` (prev day's
  `coords`, or `trip.startCoords` on day 1) and `dayEnd = day.coords`. 404 on missing
  trip/day.
- **Fixture fast path:** `la-to-portland`, **single-category only** → `{ source: "fixture",
  places }`.
- **LIVE:** one `discover()` per requested slide key, over bboxes around the day's endpoints
  sized by `RADIUS_KM_BY_CATEGORY`, sources `[googlePlacesSource, recGovSource,
  foursquareSource, usfsSource, blmSource]`.
- **FEDERATED — behind `USE_FEDERATED_POIS` (default OFF).** When off, byte-for-byte the
  legacy live-only path (untagged results). When on, live results are tagged
  `source: "live"` and `fetchFederatedPois()` (`pois_along_corridor` RPC, `FEDERATED_BUFFER_M
  = 16000`) rows are merged **alongside** (additive, never a replacement).
- **Post-processing:** cross-category dedupe by raw `id` (first occurrence) → filter to
  `≤ CORRIDOR_MI` off the two-point day segment → sort ascending by haversine from
  `dayStart`.
- **Response:** `{ source: "fixture" | "discovery", places: BrowsePlace[] }`.

---

## 2. Does `resolvePlaces()` day-corridor produce compatible output? — YES (verified)

**The defaults match the route exactly** `[measured 2026-08-23]`:

| Route constant | `resolvePlaces` default | Match |
|---|---|---|
| live sources `[google, recGov, foursquare, usfs, blm]` | `DEFAULT_CORRIDOR_LIVE_SOURCES` (same order) | ✓ |
| `RADIUS_KM_BY_CATEGORY` | `DEFAULT_RADIUS_KM_BY_CATEGORY` | ✓ byte-identical (empty diff) |
| `CORRIDOR_MI = 10` | `DEFAULT_CORRIDOR_MI = 10` | ✓ |
| `FEDERATED_BUFFER_M = 16000` | `DEFAULT_FEDERATED_BUFFER_M = 16000` | ✓ |
| `fetchFederatedPois(...)` federated read | same `fetchFederatedPois` | ✓ same function |

`resolvePlaces` `day-corridor` fans out one `discover()` per slide key over the two
endpoints, runs `fetchFederatedPois` per slide key, then applies the **same** corridor
filter + distance-from-start sort. It was written from this endpoint (design §1b/§4b), so
this is not a coincidental match — it is a model of this route.

**Client-consumer compatibility — clean** `[read source: category-browse-panel.tsx]`. The
sole feed consumer is `CategoryBrowsePanel`. It fetches
`/api/trip-browse/:tripId/:dayId?categories=…` and reads
`{ source: "fixture" | "discovery"; places: BrowsePlace[] }` (line 325-331), rendering from
`places`; `source` is stored in state but **no render branch keys on it**
`[measured 2026-08-23: grep — `source` is only set, never compared]`. `BrowsePlace` is used
as-is. So a thin wrapper that keeps returning `{ source, places }` (setting
`source: "discovery"` for the resolver path, `"fixture"` for the fixture fast path) is
byte-compatible.

- **`place.source` stamping.** `resolvePlaces` stamps **every** place (`live` / `master_place`,
  design §D7); the legacy path only tags when `USE_FEDERATED_POIS` is on. `LocationBrowseCard`
  branches on `place.source === "master_place"` (`isFederated`, `[location-browse-card.tsx:142]`)
  — unaffected; live places newly carry `source: "live"` (was `undefined`), and nothing
  branches on that. Same finding as the Search cutover.
- **Separate call, out of scope:** the panel also calls `POST /api/places/hydrate`
  `[:367]` — but that is the **search-add** sub-flow (`<PlaceSearch>.onAdd` re-hydrates one
  `master_place` id), not the browse feed. It is an ids-hydrate, unrelated to the day-corridor
  cutover; leave it be.

---

## 3. `USE_FEDERATED_POIS` — orthogonal to the new flag; both must exist

This is the one thing that differs from Search. Two flags, two concerns:

- **`USE_FEDERATED_POIS` (existing, default OFF)** gates **DATA** — whether federated corpus
  rows are merged into the feed. Off = live-only.
- **The new flag** (§5) gates **CODE PATH** — inline body vs `resolvePlaces()`.

They compose cleanly because `resolvePlaces` **does not read env** — it takes
`include: { live?, federated? }`, which its own header calls "how a caller reproduces
`USE_FEDERATED_POIS = false` without the resolver reading env." So the wrapper maps:

```ts
resolvePlaces({ scope: { kind: "day-corridor", start, end, categories, supabase },
                include: { federated: USE_FEDERATED_POIS } })
```

Result matrix (preserves today's semantics exactly):

| new flag | `USE_FEDERATED_POIS` | behaviour |
|---|---|---|
| OFF | OFF | legacy live-only (today's prod default) |
| OFF | ON | legacy live + federated merge |
| ON | OFF | `resolvePlaces` live-only (`include.federated:false`) — matches legacy off |
| ON | ON | `resolvePlaces` live + federated |

So **both flags stay**; they are not redundant and not a replacement for one another. The
new flag does not subsume `USE_FEDERATED_POIS` — it delegates the data decision back to it.

---

## 4. Tiering (#255/#256) and #254 — computed, used for SORT here, not displayed

- **#254 (categories) — reflected identically, no change.** The federated half maps
  `slideKey → SLIDE_TO_PRIMARY_CATEGORY[slideKey]` for the RPC inside `fetchFederatedPois`
  `[federated.ts:254]` — the exact `#254`-edited map — and both the route and
  `resolvePlaces` call the **same** `fetchFederatedPois`. The live half queries by `slideKey`
  directly (no primary mapping). So #254 flows through unchanged either way.
- **Verified/Unverified — computed on this path, and here it is actually USED (for order),
  though still not displayed.** `fetchFederatedPois → mapMasterPlaceRow` sets `verified` from
  the RPC's `description_source` (the corridor path, which was already correct — #259 fixed
  the *bbox* path, not this one). `resolvePlaces` then applies `sortByVerificationTier`
  (verified-first) after the corridor sort. **This is the one behaviour change** vs the
  legacy pure-distance sort — but scoped:
  - **`USE_FEDERATED_POIS` OFF (prod default):** every row is live → `resolvePlaces` stamps
    live → `verified` → all one tier → the tier sort is a **no-op**, order stays
    distance-from-start. **No visible change in the default configuration.**
  - **`USE_FEDERATED_POIS` ON:** live (verified) + federated (mixed) → the tier sort
    **reorders** — verified block first (live + verified-federated), unverified-federated
    last, distance-within-tier — where the legacy on-path sorted purely by distance. Real,
    but gated behind a flag that is off in prod, and **invisible as a badge**:
    `LocationBrowseCard` does not render `verified` (the same drop Day Column's plan found;
    its `verified={!!p.placeId}` is the unrelated "Google-backed" boolean). So the effect is
    ordering only.

  **Distinction from Day Column:** there the tier was computed and *entirely dropped*; here
  it is dropped from the *card* but consumed by `resolvePlaces`'s *sort*. Whether verified-
  first ordering is desirable for this panel is a product call to confirm before enabling
  the new flag together with `USE_FEDERATED_POIS`.

---

## 5. Flag name + rollback

- **Flag: `TRIP_BROWSE_USE_RESOLVER`** — env boolean, **default OFF**, `=== "true"`,
  mirroring `SEARCH_AREA_USE_RESOLVER` / `DATE_DETAIL_USE_RESOLVER`. Warranted here (unlike
  Day Column) because there is a real endpoint to wrap. OFF = the exact pre-cutover body; ON
  = `resolvePlaces()` day-corridor with `include.federated = USE_FEDERATED_POIS`.
  **✅ BUILT (§8).**
- **Rollback: a clean flag-flip** — this is a **read path**, so (as with Search/Date Detail)
  a redeploy with the flag off restores prior behaviour for every request; the route's own
  15-min cache is per-process, so a flip = fresh process = no stale other-mode payload.
  **Unlike Day Column** (a write path whose rollback is a re-bake), nothing is persisted.

---

## 6. Blockers and edges — none hard; three things to handle at the wrapper

No hard blocker. The wrapper stays thin (parse/validate + cache + fixture path + response
shape at the route, exactly like Search's `handler.ts`), and these are the items to get
right:

1. **Map `USE_FEDERATED_POIS → include.federated`** (§3) — the one line that preserves the
   live-only default.
2. **The missing-`dayStart` edge.** `resolvePlaces` `day-corridor` requires `start` *and*
   `end` coords; the legacy route falls back to a single-point segment/bbox when `dayStart`
   is absent (a day with no previous `coords` and not day 1, and no `trip.startCoords`). The
   wrapper must handle this — simplest is to fall back to the legacy body (or skip the
   resolver) when `dayStart` is undefined. Rare, but real; name it so the cutover doesn't
   silently 500 or return empty.
3. **Keep the fixture fast path, the 7-bucket category validation (400s), and the cache at
   the route** — `resolvePlaces` has none of these, exactly as the Search wrapper kept its
   own cache/validation. The `day-corridor` scope takes coords, not a `tripId`, so the
   wrapper does the `getTrip`/day lookup and passes `start`/`end` — matching the resolver's
   deliberate "no trip lookup" design.

Behaviour-preservation to verify at cutover (same rigor as Search's flag-off proof + wired
verification): flag OFF byte-identical to today; flag ON with `USE_FEDERATED_POIS` off
returns the **same** feed (all-live, tier-sort a no-op); flag ON + `USE_FEDERATED_POIS` on
merges federated and applies the tier sort (the one intended new behaviour).

---

## 7. Out of scope — the write-path/baking consolidation

Day Column's plan flagged that the **bake** path (`bake-corridors.ts::foldFederatedCorridorSupply`)
also reads corpus via `fetchFederatedPois`/`pois_along_corridor`, and that consolidating that
*write* path onto `resolvePlaces` is separate/future work. That is **explicitly out of scope
here.** This plan covers only the **read** endpoint `GET /api/trip-browse/:tripId/:dayId`.
The overlap is real (both surfaces read the same corridor RPC), but the write-path
consolidation — with its staleness and re-bake-rollback semantics — is its own task and is
not solved or blocked by this cutover.

---

## Bottom line

Day-scoped browse is the textbook version of this cutover: a genuine read endpoint that
`resolvePlaces()` day-corridor already models field-for-field, a client consumer that reads
`{ source, places }` with no shape mismatch, a clean flag-flip rollback, and no blocker. The
only real design decisions are (a) that `TRIP_BROWSE_USE_RESOLVER` and the existing
`USE_FEDERATED_POIS` are orthogonal and both remain (the wrapper wires the latter into
`include.federated`), and (b) confirming the verified-first re-ordering is wanted before ever
running the new flag together with `USE_FEDERATED_POIS` on — in the default (federated-off)
configuration it is a no-op. Implementation is a Search-style thin wrapper + `handler.ts`,
not attempted here.

---

## 8. Cutover — IMPLEMENTED (flag-gated, default OFF)

Wired on branch `feat/trip-browse-resolver-cutover`. The last of the four surface cutovers.

**Flag:** `TRIP_BROWSE_USE_RESOLVER` (env boolean, mirrors `SEARCH_AREA_USE_RESOLVER` /
`DATE_DETAIL_USE_RESOLVER`). **Default: OFF.** Flip to `"true"` in Vercel to roll out; a
redeploy = fresh process = fresh cache, so no stale other-mode payload survives a flip.

**Shape (thin wrapper, per §6):** `route.ts` keeps the category validation (7-bucket + 400s),
the 15-min cache, the fixture fast path, the trip/day + geometry derivation, and the
`{ source, places }` response. The "produce the ranked places" step moved to
`handler.ts` (`produceBrowsePlaces`), behind a dependency seam so all four flag
combinations are unit-testable without network/DB:
- **`TRIP_BROWSE_USE_RESOLVER` OFF → `viaLegacy`:** the pre-cutover discover-fanout body,
  verbatim (legacy constants kept local so the flag-off path can't be perturbed by a
  resolver-side edit).
- **ON → `viaResolver`:** `resolvePlaces()` day-corridor scope, with
  **`include: { federated: USE_FEDERATED_POIS }`** — the one line that keeps the two flags
  orthogonal (the resolver reads no env). The supabase client is created by the route (only
  when `USE_FEDERATED_POIS`) and passed in; `viaResolver` falls back to `viaLegacy` when
  `dayStart` is absent (the missing-endpoint edge, §6.2).
- No `enrich` (day-scoped browse never auto-hydrated, like Search).
- The client (`CategoryBrowsePanel`) is **untouched**; `{ source, places }` is unchanged.

**Verified:**
- `handler.test.ts` — 8 tests covering **all four** `TRIP_BROWSE_USE_RESOLVER` ×
  `USE_FEDERATED_POIS` combinations: (off,off) legacy untagged live-only; (off,on) legacy
  tags live + merges federated; (on,off) resolvePlaces with `federated:false` and no client;
  (on,on) `federated:true` with the client in scope; the missing-`dayStart` legacy fallback;
  and **the one behaviour change** — (on,on) **Verified-before-Unverified end-to-end through
  the REAL resolvePlaces** (unverified-near vs verified-far → verified-far first, i.e. tier
  beats distance), with a uniform-tier negative-control confirming the base sort is distance.
- `web/scripts/verify-trip-browse-wired.ts` — LIVE TEST (`znldzjdatkogdktymtvi`, hard TEST
  assert) on `la-to-deadhorse/day-1` (`scenic,camping`). **both-off:** live-only, all
  untagged, 0 federated — matches today. **both-on:** federated rows merged, **every place
  source-stamped (0 untagged), tier-sorted (0 ordering violations)** with the live block
  (verified) ahead of the federated block (unverified). The contrast (0 federated / all-
  untagged vs many-federated / all-stamped) is the non-vacuous proof the resolver path ran.
  (⚠ It drives `produceBrowsePlaces`, the route's delegate, not the full `GET`: the route's
  `createSupabaseServerClient()` needs a request-scoped `cookies()` context unavailable under
  `tsx`. Everything except the thin GET wrapper is exercised.)
- Gates: `npm run -w web typecheck` exit 0, `npx next build` exit 0.

**Not done (intentionally):** neither flag flipped on; no `web/src/components` change; the
write-path/baking consolidation (§7) remains out of scope.
