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

# Testing offline behavior — use a production build, not the dev preview

The Mapbox + app-shell service worker at `public/sw.js` short-circuits to plain `fetch(event.request)` (no caching) when `self.location.hostname === 'localhost'`. This is deliberate: dev-mode caching gets confusing fast (HMR fights cached chunks, edited files re-serve stale, etc.).

**Consequence:** the dev preview cannot exercise offline behavior. If you stop the dev server and reload, the browser shows Chrome's `ERR_INTERNET_DISCONNECTED` page — and the Network tab shows `(failed) Provisional headers are shown` for every request. That is correct behavior given the localhost-bypass, not a bug in the SW.

**How to verify offline locally:**
1. `npm run build` — emits the production bundle and (via the `postbuild` hook) writes `public/sw-version.js` from `.next/BUILD_ID`
2. Start a production server: `npm run start -- -p 3211` (or `preview_start name=web-easley-prod` if you've added the prod entry to `.claude/launch.json`)
3. Confirm prod mode: `ps aux | grep next-server` should show `next-server (v…)`, not `next dev`
4. Load `/trips/<id>` once to populate the caches
5. Stop the server (`preview_stop` or kill the PID listening on the port)
6. Hard-reload the page in the browser — the slideup, map canvas, and cached tiles should all serve from Cache Storage

**Flag to override the bypass without going to prod**: set `FORCE_CACHE_IN_DEV = true` at the top of `public/sw.js`, restart the dev preview, register the SW once, then flip back to `false`. Useful for debugging the cache contents but doesn't reproduce the real offline reload path — JS chunks in dev mode contain HMR websocket clients that fail when the dev server is down, so map hydration can stall even when the cache contents are correct. Always do the final offline verification against `next start`.

