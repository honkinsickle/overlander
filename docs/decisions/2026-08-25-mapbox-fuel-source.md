# Decision — Mapbox Search Box as the `fuel` source (web-client browse surfaces)

**Date:** 2026-08-25
**Owner:** Adam
**Companion docs:** `docs/architecture/resolve-places-design.md` (D7 resolution
below), `docs/decisions/2026-08-21-place-data-resolver-consolidation.md` (the
resolver ADR this feeds into), `docs/decisions/2026-08-25-fuel-live-resolve.md`
(path A — the audit-time fuel path this decision deliberately does NOT touch).

## Context

Fuel-station discovery on the web client's browse surfaces (`/api/trip-browse`,
`/api/search-area`) went through `googlePlacesSource`'s `searchNearby` category
fanout via `TYPES_BY_CATEGORY.fuel = ["gas_station"]`. Rendering Google Places
results on a non-Google map (this app runs on Mapbox GL JS) requires the Google
Places UI Kit as a compliant display path. Mapbox Search Box results carry a
mirror-image restriction: results are display-permitted on a Mapbox map by
default (which this app already is), so the UI Kit constraint drops for
fuel-family results served from Mapbox instead.

Adam's ask (2026-08-25): move fuel to Mapbox Search Box on the browse surfaces
without touching the 8 other slide categories and without touching path A
(`fuel-live-resolve.ts` / `PlaceResolver.resolveNearby`, PR #288, audit-time,
still on Google — separate follow-up).

## Decision

- **New `WaypointSource`: `mapboxSearchBoxSource`** at
  `web/src/lib/discovery/mapbox-search-box.ts`. Fuel-only today (returns `[]`
  for any non-fuel category request). Calls the Mapbox Search Box category
  endpoint `GET https://api.mapbox.com/search/searchbox/v1/category/gas_station`
  with `bbox`, `limit=25`, `access_token`. Reads `NEXT_PUBLIC_MAPBOX_TOKEN`
  from env (same var as every other Mapbox call in the app —
  `routing/geocode.ts:32`, `routing/route-between.ts:68`,
  `routing/reverse-geocode.ts:36`). Returns `SourceResult[]` with
  `sourceId: "mapbox"` and `category: "fuel"`. Address preferred from
  `full_address`, falls back to `address`; both absent leaves `address`
  undefined (never fabricated).
- **`SourceId` union gains `"mapbox"`** (`web/src/lib/discovery/types.ts:6-31`).
  `SOURCE_LABEL` in `to-browse-place.ts` gains `mapbox: "Mapbox"` — the
  `Sourced from Mapbox` / `Cross-referenced from Google · Mapbox` mention on
  the tile.
- **Google fuel is disabled at the source.**
  `TYPES_BY_CATEGORY.fuel = []` (was `["gas_station"]`) in
  `web/src/lib/discovery/google-places.ts:53`. Google's category-fanout emits
  nothing for fuel; Mapbox is the sole live-fuel provider.
- **Source-list wiring lands in BOTH the legacy paths AND the resolver
  defaults.** Mapbox added at head of:
  - `LIVE_SOURCES` in `/api/trip-browse/[tripId]/[dayId]/handler.ts:53-61`
    (legacy fuel path)
  - the inline sources array in `/api/search-area/handler.ts:161-170` (legacy)
  - `DEFAULT_BBOX_LIVE_SOURCES` and `DEFAULT_CORRIDOR_LIVE_SOURCES` in
    `resolve-places.ts` (resolver defaults, used when
    `SEARCH_AREA_USE_RESOLVER` / `TRIP_BROWSE_USE_RESOLVER` are ON)

  Head position is not about fanout order (Mapbox and Google are disjoint by
  category — Mapbox does fuel only, Google no longer does fuel). It's about
  `discover()`'s dedupe: when the same physical place ever appears from
  multiple sources, `results[0]` is treated as canonical for
  title/coords/description. Mapbox-canonical for fuel-typed tiles is the
  intent when it happens.
- **NO new npm dependency.** Hand-rolled `fetch` against the REST endpoint.
  `@mapbox/search-js-core` and friends carry autocomplete + session-token +
  retrieve-by-id machinery for the /suggest+/retrieve two-step flow, which
  this source deliberately doesn't use — the category endpoint is one URL and
  one JSON parse. Adding an SDK for ~40 lines of hand-roll would fail
  `web/CLAUDE.md`'s "Ask before introducing a dependency" bar without
  proportional benefit. Flagged as a call in this decision doc.

## D7 (`BrowsePlace.source` tag for Mapbox-origin results) — resolved

Adam's task text: "decide a new source tag value (e.g. 'mapbox-live')" for
`BrowsePlace.source`.

**Decision: keep `BrowsePlace.source` at its existing binary `"live" |
"master_place"` distinction; add per-source id `"mapbox"` on
`SourceResult.sourceId` only.** Mapbox-sourced places project to
`BrowsePlace.source: "live"` — same value as any other live source (Google,
Foursquare, rec-gov, USFS, BLM).

**Reasoning:** `BrowsePlace.source` today drives hydration eligibility and
cache-key behavior — the coarse "is this live-fetched or corpus-warehoused"
distinction that gates whether a tile can accept a Google Place Details
graft, whether it counts against a Typesense pagination limit, etc.
`SourceResult.sourceId` is the fine-grained per-source identifier — it's what
`SOURCE_LABEL` reads to render "Sourced from Google" / "Cross-referenced from
Google · Mapbox" mentions on the tile. Adding a per-source axis to
`BrowsePlace.source` would fork the hydration and cache logic that today keys
on the binary; adding it to `SourceResult.sourceId` — already per-source, and
already what surfaces in the UI mention line — is the minimal edit.

Adam's example value "mapbox-live" was a suggestion, not a mandate; keeping
per-source attribution on `sourceId` (where it already lives) rather than
overloading `source` preserves the binary's meaning and doesn't move
hydration logic. Documented in the `SourceId` union comment
(`discovery/types.ts:6-31`) so a future reader doesn't re-derive.

## What this decision deliberately does NOT touch

- **Path A: audit-time fuel-live-resolve (PR #288 / `04e9855`).**
  `pickFuelAtAnchor` and `PlaceResolver.resolveNearby` still hit Google
  `places:searchNearby`. Adam explicitly flagged this as out of scope; it's
  a different code path (audit-time, coordinate-input, persists tile id into
  `trips.payload`) and swapping it to Mapbox requires either a new scope in
  `resolvePlaces()` or a separate `MapboxResolver` — larger design work.
  Tracked in BACKLOG as an open follow-up.
- **`SEARCH_AREA_USE_RESOLVER` / `TRIP_BROWSE_USE_RESOLVER` flags.** Both
  remain OFF by default (unchanged). Flipping them globally would move 8
  other categories through the resolver as a side effect — explicitly out of
  scope per the task. Because Mapbox is added to BOTH source lists (legacy
  AND resolver defaults), fuel-via-Mapbox works IDENTICALLY on both paths
  regardless of flag state. No per-category flag mechanism was invented (per
  Adam's Step 3 constraint) — the fix is same-source-list-on-both-paths, not
  routing-by-category.
- **`categoryForGoogleTypes` fuel arm in `google-places.ts:410`.** A
  free-text search (via `googleTextSearchSource`) returning a
  `gas_station`-typed place is still categorized as `"fuel"` by that mapper —
  Google could therefore surface a fuel-typed result to a user's free-text
  query on `/api/search-area`. Adam's task scoped the swap to category
  discovery; free-text is a distinct UX (user typed a specific place name).
  Left as-is; flagged as a residual Google-fuel path for a possible future
  follow-up.
- **Corpus ingester (`data/ingestion/sources/google-places.ts`).** Still
  ingests `gas_station` primary_type rows into `master_place` with
  `google:<place_id>` external_id. Corpus is warehoused independently of live
  browse; the compliance rule Adam named ("warehousing is not compliant") is
  a real concern here but is scoped separately per Adam's explicit direction
  not to touch it.

## Alternatives considered

- **(a) Drop `"gas_station"` from `TYPES_BY_CATEGORY.fuel` + add Mapbox as a
  source** (the chosen option). Category-based routing already exists per
  source; each source's `query()` filters by categories internally. Mapbox
  handles only fuel, Google handles everything except fuel. No routing layer
  needed.
- **(b) Branch inside existing category-routing logic** (rejected). Would
  require a category → source-list dispatch table somewhere above the
  existing `sources: WaypointSource[]` machinery. Duplicative — each source
  already declares its own supported categories via its `query()` filter.
- **(c) Force fuel through `resolvePlaces()` specifically by adding
  per-category routing** (rejected — Adam's Step 3 explicit "stop and report
  back rather than invent a per-category flag mechanism unilaterally"). The
  same-source-list-on-both-paths approach makes fuel-via-Mapbox behavior
  identical regardless of the `USE_RESOLVER` flag state, sidestepping the
  need for per-category routing entirely.

## Consequences

- **Fuel discovery on `/api/trip-browse` and `/api/search-area` now flows
  through Mapbox Search Box** on every request, regardless of the
  `USE_RESOLVER` flag state.
- **Google no longer receives fuel requests from the category fanout** on
  those two routes. `TYPES_BY_CATEGORY.fuel = []` means the Google
  `includedTypes` array is empty for fuel-only requests, and
  `googlePlacesSource.query()` returns `[]` early when `includedTypes.length
  === 0` (`google-places.ts:114`) — no HTTP call to Google.
- **The 8 other slide categories are unaffected** (`camping`, `scenic`,
  `food`, `oddity`, `attraction`, `overnight`, `interest`, `urban`). Still
  route to Google/FSQ/rec-gov/USFS/BLM as before.
- **New `NEXT_PUBLIC_MAPBOX_TOKEN` dependency for fuel discovery.** The
  token is already required for `mapbox-gl` rendering, Mapbox Geocoding, and
  Mapbox Directions — no new env-var setup needed for any environment that
  already has Mapbox working.
- **Mapbox returns fewer rich fields per POI than Google.** Search Box
  category endpoint gives `mapbox_id`, `name`, `full_address` (or
  `address`), coordinates — no rating, no price tier, no photos, no hours.
  Fuel tiles will render without rating/hours/photos. Not a regression per
  se (Google fuel tiles rarely had photos either; ratings/hours were
  present) — flagged as a UX consequence.
- **D7 as stated in `resolve-places-design.md` § D7 remains open in one
  sense** (unconditional tagging), but the specific per-source aspect Adam
  named ("assumes Google as the only live source") is resolved for Mapbox
  by the `sourceId` route.
- **Path A remains on Google.** Audit-time fuel picks in
  `pickFuelAtAnchor` still call Google's `places:searchNearby` via
  `PlaceResolver.resolveNearby` and persist `google:<placeId>` tiles into
  `trips.payload`. Separate follow-up; STATE.md open-threads note reflects
  this.

## Testing / verification

- **13 unit tests** for `mapboxSearchBoxSource` in
  `web/src/lib/discovery/mapbox-search-box.test.ts` — covers URL builder,
  feature-to-source-result mapping (both address preferences), category
  filter (fuel-only), no-token guard, HTTP error paths (non-OK, network
  throw), happy path with injected fake fetch, bbox/token passthrough,
  empty features. Run: `cd web && npx tsx --test
  src/lib/discovery/mapbox-search-box.test.ts` → 13 pass.
- **One handler test updated:** `search-area/handler.test.ts:159` — the
  fanout size assertion moved from 5 → 6 (Mapbox added to the source list).
  No other handler-test changes needed — the tests DI at the `discover`
  seam and don't inspect source-list contents beyond that count.
- **Local gate PASSES:** `npm run -w web typecheck` exit 0; `cd web && npx
  next build` exit 0; `npm run -w data typecheck` exit 0.
- **No live TEST verification this session.** The Mapbox token would need
  to be set locally to run a live request, and the browse surfaces need a
  seeded TEST trip to exercise end-to-end. Adam should verify on TEST
  before merging — spot-check fuel results in the browse surface and
  confirm 8 other categories still surface Google-sourced tiles. Never
  computed a state-by-state count this session; any spot-check numbers
  would need to be run against a live Mapbox response.

## Follow-ups (tracked in BACKLOG)

- **Path A migration.** Audit-time fuel via `PlaceResolver.resolveNearby`
  → Mapbox. Requires either a new scope on `resolvePlaces()` or a separate
  Mapbox resolver + tile-id-scheme change (`google:` → `mbx:`) that ripples
  to `place-id.ts`, `bake.ts:resolvedToTile`, and every reader that peels
  apart the `google:` prefix.
- **Free-text fuel via `googleTextSearchSource`.** `categoryForGoogleTypes`
  can still assign `"fuel"` to a Google-sourced text-search result. Would
  need Mapbox's `/suggest+/retrieve` two-step flow (SDK or hand-roll with
  session tokens).
- **Corpus ingester.** `data/ingestion/sources/google-places.ts` still
  writes Google fuel to `master_place`. Warehousing compliance separately.
