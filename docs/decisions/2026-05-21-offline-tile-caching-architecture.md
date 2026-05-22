# 2026-05-21 — Offline tile caching architecture

## Context

The Overlander trip (LA → Deadhorse, departing 2026-05-29, ~66 days) requires offline map rendering on iPad during low-connectivity stretches. The architecture pairs the existing Next.js web client with iPad-as-Safari-PWA — no native iOS client is in scope before the trip. This shifts work that `web/CLAUDE.md` previously listed as iPad non-goals ("Offline operation beyond degraded read", "Active turn-by-turn navigation") onto the web client. The non-goals entries are now stale.

Mapbox GL JS v3.22 has no built-in OfflineManager and dropped `addProtocol` support, so the only viable offline path is service worker + Cache Storage intercepting Mapbox HTTP requests. iOS Safari PWAs have a practical storage budget of ~1–1.5 GB with aggressive eviction under storage pressure. Full corridor + DEM at z=6–14 would be ~50–70 GB — two orders of magnitude over budget. A tiered, on-demand approach is required.

Stack constraints relevant to the design: Next.js 16.2.4, React 19.2.4, Turbopack-only (no webpack config). `mapbox-gl` ^3.22.0, single Mapbox custom style (`honkingsickle/cmolte3b7003e01so7msf20d3`). Public token via `NEXT_PUBLIC_MAPBOX_TOKEN`. No existing service worker, middleware, or PWA scaffold.

## Decision

**Phase-based caching.** A phase is a corridor segment with a zoom range and buffer. Multiple phases coexist; user primes phases on demand.

- **Per phase:** z=6–13, 20–25 mi buffer, vector-only (no DEM), ~310–390 MB, ~10–13K tile requests
- **Global baseline:** z=0–5 worldwide, primed once on first launch (~1,500 tiles, ~10–20 MB)
- **Phase model:** day-ranges, default 7-day chunks, user editable; ~10 phases for the trip
- **Overlap:** accepted; phase boundaries duplicate tiles (~5–10% waste)
- **Fallback UX:** mapbox-gl-js native parent-tile overscaling + banner prompting Phase N download when off-cache

**Phase persistence — split:**
- Definitions live in `trips.payload.phases` (travels across devices, matches jsonb convention)
- Prime status (downloaded flag, primedAt, tile count, primedPolylineHash) lives in IndexedDB, keyed `(tripId, phaseId)`, per device
- Trip-mutation invalidation: on trip edit, recompute polyline hash; if different from `primedPolylineHash`, surface "Phase X needs re-priming" in UI. Don't auto-invalidate the cache — stale tiles serve as fallback until re-prime succeeds

**Service worker:**
- Single file at `public/sw.js`; add esbuild step only if it grows past one file
- **Scope: Mapbox-only.** Fetch handler returns early for any URL not matching `api.mapbox.com`. HTML, RSC, Supabase, everything else uses normal network paths. No PWA install required for SW to function.
- **Dev: localhost-bypass.** SW registers in dev; fetch handler short-circuits to `fetch(event.request)` when `self.location.hostname === 'localhost'` unless a flag is flipped.
- **Lifecycle: aggressive.** `self.skipWaiting()` on install + `clients.claim()` on activate. In-flight prime queues inherit to the new SW without restart.
- **Tooling: hand-rolled.** `next-pwa` and Serwist are both webpack-only and incompatible with this project's Turbopack-only build. Custom caching logic (token stripping, phase namespacing, drift detection) isn't workbox-shaped anyway.
- **Cache namespacing:** `mb-style-v1`, `mb-baseline-v1`, `mb-phase-<phaseId>-streetsv8`. Tileset version suffix lets a future tileset bump invalidate cleanly.
- **Cache-key normalization:** strip `access_token` and session params before lookup/store.
- **URL patterns intercepted:** style JSON (`api.mapbox.com/styles/v1/...`), sprite + glyphs, vector tiles (`api.mapbox.com/v4/...`), Directions API responses (per-leg). DEM tiles pass through to network (online-only).
- **Client messages:** SW `postMessage`s to clients when a Mapbox fetch falls through to network (drives off-cache banner in session 4).
- **Headers** in `next.config.ts` for `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type: application/javascript; charset=utf-8`.

**PWA scaffold:**
- Manifest at `app/manifest.ts` (Next 16 file convention)
- Icons: apple-touch-icon 180×180, PWA 192×192 + 512×512, in `public/`
- `navigator.storage.persist()` deferred to first phase prime (session 3), not PWA install

**DEM dropped offline.** Style references `mapbox-terrain-dem-v1`; map renders flat where DEM is missing. Visual cost during nav is low (route, labels, position dot all render correctly); halves storage. Online users still see full terrain.

**Tile coverage math: hand-rolled** in `lib/offline/` (next to the SW + storage helpers), no new dependencies. Phase polyline + buffer → `{z, x, y}` enumeration via Web Mercator.

**Tile enumeration signature: `enumerateTiles(coords, bufferMi, zMin, zMax)`** — takes the polyline sample set, not a bbox. A bbox over a non-rectangular corridor over-counts ~5× (LA→Jasper week 1 has a bbox of ~444K sq mi vs ~95K sq mi of actual 25mi-buffered road). Per-sample neighborhood expansion with a disc-shaped filter yields a corridor-shaped tile union that matches the analytical prediction for the phase's true buffered area.

**Rate limiting:** prime loop catches 429, parses `Retry-After`, exponential backoff with jitter. Concurrency throttle (6–8 in-flight) stays, but isn't the only safeguard.

**Implementation: 4 PRs.**
1. PWA scaffold + service worker + global baseline cache + `navigator.storage.estimate()` helper
2. Phase model + geometry (data layer, no UI; types in `lib/trips/types.ts`, math in `lib/routing/`)
3. Phase priming + status UI (prime loop, throttle, 429 handling, progress, quota UI, resume-after-interruption)
4. Off-cache fallback UX (banner + detection via SW client messages)

## Consequences

**Trade-offs accepted:**
- **Max offline zoom is z=13.** z=14 detail (city-block granularity) overscales from cached z=13 — acceptable for highway/2-lane driving; suboptimal for dense urban grids. The corridor's urban segments (LA, Anchorage, Whitehorse, Fairbanks) are short fractions of total drive time.
- **DEM unavailable offline.** Mountain regions (Rockies, Yukon, Brooks Range) render flat. No routing or labeling impact.
- **Phase overlap.** ~5–10% storage waste at boundaries, in exchange for simpler phase-geometry code.
- **Stale tiles after trip edit.** Old tiles serve as fallback until user re-primes; "needs re-priming" status surfaces in UI.
- **Dev iteration cost.** SW registers in dev but doesn't cache. Testing cache behavior locally requires flipping the localhost-bypass flag (single line).
- **Open-animation regression on the detail card** (already shipped in PR #43) traded for layout-leak fix; orthogonal to this ADR but part of the same shipping window.

**Downstream work:**
- Remove the stale "Offline operation beyond degraded read (iPad)" and "Active turn-by-turn navigation (iPad)" entries from `web/CLAUDE.md`'s Non-goals list. Follow-up commit after first offline PR lands.
- Mapbox monthly tile request meter: ~100–130K requests over trip prep (10 phases × ~13K each). Fits free tier if spread across months; concentrated prime may hit paid tier (order of $25, not $500). Verify against dashboard.
- iOS storage caps mean 3–4 simultaneous phases practical (~1.2–1.5 GB ceiling). User must manually remove old phases to free space — UI surface in session 3.

**Risks and watch items:**
- Mapbox tileset versioning: `mapbox.mapbox-streets-v8` could bump. Cache namespacing already includes `-streetsv8` for a clean invalidation path.
- iOS PWA storage eviction is opportunistic and unpredictable; `navigator.storage.persist()` may not be honored on iOS.
- Cross-tab coordination: SW broadcasts via `clients.matchAll()`; multi-tab usage (planning + trip viewer) should stay coherent.
- Resume-after-interruption: tab close mid-prime leaves partial state. Session 3 handles via tilesPrimed/tilesTotal counters and a Resume button.
- HTTPS required for SW in production; localhost is exempt for dev. Vercel preview/prod is HTTPS — no special config.
