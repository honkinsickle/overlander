<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Build and verify in the trip slideup

Trip-detail surfaces (DayDetail, MapColumn, DaySidebar, CategoryBrowsePanel, BrowseDaySection, MapDetailOverlay, LocationBrowseCard, etc.) must be built and verified inside the **trip slideup overlay**, not the legacy full-page `/trip/[id]` route.

**Why:** The slideup overlay anchored to `/trips` (Next.js intercepting route `@modal/(.)trip/[id]`) is the canonical trip-detail surface per the 2026-05-15 shape brief and PR #33. The full-page `/trip/[id]` route is a legacy/fallback view that doesn't exercise slideup-specific layout interactions (z-stacking, the 1113px 3-col body, intercepting-route mounting).

**How to verify in preview:** Navigate `/trips` → click a trip card to open the slideup overlay. Do NOT navigate directly to `/trip/[id]` for verification (that loads the legacy full-page route). If a fixed/absolute-positioned child (like `CategoryBrowsePanel`'s `fixed inset-0` wrapper) might interact with the slideup chrome differently than the full-page view, explicitly check both — but the slideup is the one that must work.

# Open Claude Code rooted at the worktree, not the parent

When working on a git worktree under `~/.claude/worktrees/<name>/`, open the Claude Code session with the worktree itself as the project root — not `~/` or the original repo.

**Why:** the preview MCP (`mcp__Claude_Preview__preview_*`) reads `<project_root>/.claude/launch.json`. If the session's project root is `~/`, it loads `~/.claude/launch.json`, whose `web` entry points at a *different* tree (the original repo). Your edits to the worktree's source files never get served. The worktree's own `.claude/launch.json` (with the relative `--prefix web`) is the right config, but it's only consulted when project root === worktree.

**Symptom:** preview shows stale behavior; routes that exist in the worktree return 404 (e.g. `/trips/[id]` 404s, `/trips` 307s to `/auth/sign-in` because an older `app/trips/page.tsx` is being served).

**Diagnostic:** `lsof -p $(pgrep -f 'next dev') | grep cwd` — the listed `cwd` should be `<worktree>/web`. If it's anywhere else, the preview is serving the wrong tree.

**Mid-session escape hatch:** if you're already running with the wrong root and can't reopen, add a worktree-specific entry to whatever `launch.json` is active, with `runtimeExecutable: "/bin/sh"` and `runtimeArgs: ["-c", "cd <worktree>/web && exec npm run dev -- -H 0.0.0.0 -p <port>"]`, then `preview_start` that name. Remove the entry when done.

# Testing offline behavior

The Mapbox + app-shell service worker at `public/sw.js` short-circuits to plain `fetch(event.request)` (no caching) when `self.location.hostname === "localhost"` or `"127.0.0.1"`. This avoids dev-mode caching confusion.

**The bypass is hostname-based, not mode-based.** `next start` on localhost still triggers it. A localhost production build alone is *not* sufficient to verify offline behavior — caches won't populate, offline reload will show `ERR_INTERNET_DISCONNECTED`, and the Network tab will show `(failed) Provisional headers are shown` for every request.

**To verify offline locally, do one of:**

1. **Set `FORCE_CACHE_IN_DEV = true`** at the top of `public/sw.js` temporarily (fast iteration). Restart the preview, exercise the page, run the offline test, then flip the flag back. Caveat: dev-mode JS chunks embed HMR websocket clients that fail when the dev server is down, so map hydration may stall against `next dev` even with caches populated. Pair the flag flip with `next start` (not `next dev`) for cleanest local results.

2. **Test against the Vercel preview URL** after pushing (cleanest, most representative — matches the iPad's actual environment). The SW activates, caches populate (`mb-baseline-v1`, `mb-style-v1`, `app-shell-html-<buildId>`, `app-shell-static-<buildId>`), and DevTools → Network → "Offline" → reload renders the full page from Cache Storage.

## Testing phase priming (session 3+)

Phase priming (`OfflinePanel` → kebab → "Offline maps") writes per-phase tile caches (`mb-phase-<phaseId>-streetsv8`) and per-device status to IndexedDB (`overlander-offline` / `phase-status` store, composite key `[tripId, phaseId]`). Same localhost-bypass applies — the prime loop's `fetch()` calls go through the SW, which short-circuits to network on localhost without caching.

**To verify priming end-to-end, test on the Vercel preview URL:**

1. Sign in, open a user-owned trip (UUID, not the `la-to-deadhorse` reference slug) from `/trips`. The kebab → "Offline maps" entry is gated on the trip id being a UUID; reference trips show a disabled stub kebab.
2. Empty state → "Set up offline cache" persists default phases (~7-day chunks) to `trips.payload.offlinePhases` via `setOfflinePhasesAction`.
3. Click "Prime" on a phase. Watch:
   - DevTools → Application → Cache Storage → a `mb-phase-<phaseId>-streetsv8` bucket appears and fills.
   - DevTools → Application → IndexedDB → `overlander-offline` → `phase-status` → row updates every 25 tiles (`tilesPrimed` counter ticks; `status` flips `priming` → `ready` on completion).
   - DevTools → Network → tile requests to `api.mapbox.com/v4/...` succeed; the SW intercepts subsequent same-tile requests from cache (status: "(ServiceWorker)").
4. **Resume:** close the tab mid-prime, reopen the same trip → panel shows "Paused · N / M tiles" with Resume + Delete actions. Clicking Resume skips already-cached tiles (no double-billing the Mapbox meter).
5. **Drift:** edit a day in the phase (e.g. add a waypoint), close + reopen the panel → that phase row surfaces "Trip changed since prime" with "Re-prime to update".
6. **Offline reload:** DevTools → Network → "Offline" → reload the trip. Tiles for a primed phase render; tiles for other phases overscale from baseline z=0–5 (looks blocky, not blank).

**Known verification gaps (manual / synthetic only):**

- **429 + Retry-After:** can't be exercised on a fresh Vercel preview without rate-limiting on purpose. The path is type-checked + reviewed; document any real-world hit.
- **`navigator.storage.persist()` on iOS:** Safari decides opportunistically; the prime loop calls `ensurePersistentStorage()` on first-prime regardless of whether the prompt surfaces.
- **Cross-tab IDB `blocked`:** the wrapper rejects the open promise rather than retrying; user-visible behavior under two tabs simultaneously priming hasn't been tested.

## Off-cache fallback banner (session 4)

`OffCacheBanner` (top of `MapColumn`) surfaces when the visible viewport at the current zoom isn't covered by any primed phase. Detection is viewport-based via `useViewportCoverage`, debounced 200ms off the Mapbox `idle` event. Click the CTA → dispatches `trip:openOfflinePanel` with `{ phaseId? }` → `SlideupShell` opens the panel and scrolls to that row.

**SW fall-through `postMessage` is wired but unconsumed.** The SW emits `{ type: "MAPBOX_FALLTHROUGH", url, key }` whenever a /v4 phase tile (z=6..13) misses every cache and falls through to network. Reserved for future telemetry / UX (e.g. "we noticed you've been driving in uncached territory for 10 minutes — want to prime?"). Don't drive the banner from this stream — it fires per-tile during an active prime and would flicker.


# Styling

All styling derives from `/DESIGN.md` / `globals.css` tokens. Reference `/DESIGN.md` as the only style source. Never hardcode colors, type, spacing, or radii — use `var(--token)`.

The no-raw-hex rule applies to UI styling only. Raw hex is permitted in `lib/trips/` data and route fixtures (map/route colors are data, not theme).
