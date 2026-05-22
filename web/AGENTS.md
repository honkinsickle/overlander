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

