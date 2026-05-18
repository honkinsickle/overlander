<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Build and verify in the trip slideup

Trip-detail surfaces (DayDetail, MapColumn, DaySidebar, CategoryBrowsePanel, BrowseDaySection, MapDetailOverlay, LocationBrowseCard, etc.) must be built and verified inside the **trip slideup overlay**, not the legacy full-page `/trip/[id]` route.

**Why:** The slideup overlay anchored to `/trips` (Next.js intercepting route `@modal/(.)trip/[id]`) is the canonical trip-detail surface per the 2026-05-15 shape brief and PR #33. The full-page `/trip/[id]` route is a legacy/fallback view that doesn't exercise slideup-specific layout interactions (z-stacking, the 1113px 3-col body, intercepting-route mounting).

**How to verify in preview:** Navigate `/trips` → click a trip card to open the slideup overlay. Do NOT navigate directly to `/trip/[id]` for verification (that loads the legacy full-page route). If a fixed/absolute-positioned child (like `CategoryBrowsePanel`'s `fixed inset-0` wrapper) might interact with the slideup chrome differently than the full-page view, explicitly check both — but the slideup is the one that must work.

