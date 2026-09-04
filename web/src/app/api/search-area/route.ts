import { NextResponse } from "next/server";
import { resolveSearchArea } from "./handler";

/**
 * GET /api/search-area?bbox=W,S,E,N&q=&categories=
 *
 * The top-level "search this area": RICH merged results bounded to the
 * current map viewport, no day/corridor context. Reuses the in-panel slide
 * pipeline — `discover()` (already day-free) for the live half and Typesense
 * + the shared federated hydrate for the corpus half — so results render
 * through the identical LocationBrowseCard.
 *
 *   - q (free-text)   → LIVE: Google `searchText` bounded to the bbox.
 *   - categories       → LIVE: the existing `searchNearby` category fanout,
 *     mapped from corpus primary_category → slide bucket (only where Google
 *     has honest type coverage; overland-only categories run federated-only).
 *   - both paths       → FEDERATED: Typesense `search()` bbox-bounded → the
 *     same `hydratePlacesByIds` projector the corpus path already uses.
 *
 * `categories` is the corpus `primary_category` vocabulary (what Find-Nearby
 * tiles already carry), so the federated facet is a direct pass-through.
 *
 * This handler is a THIN WRAPPER: it parses/validates, owns the LRU cache and
 * the debug gate, and shapes the response. The fanout/merge lives in
 * `./handler`, which delegates to `resolvePlaces()` (cut over unconditionally
 * 2026-09-03 — the `SEARCH_AREA_USE_RESOLVER` flag and the legacy inline body
 * are gone; parity was verified on TEST first).
 */

// ── in-process LRU cache (same pattern as the trip-browse route) ───────
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
type CacheEntry = { timestamp: number; payload: unknown };
const cacheStore = (() => {
  const g = globalThis as unknown as {
    __searchAreaCache?: Map<string, CacheEntry>;
  };
  if (!g.__searchAreaCache) g.__searchAreaCache = new Map();
  return g.__searchAreaCache;
})();

function cacheGet(key: string): unknown | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cacheStore.delete(key);
    return null;
  }
  cacheStore.delete(key);
  cacheStore.set(key, entry);
  return entry.payload;
}
function cacheSet(key: string, payload: unknown): void {
  if (cacheStore.size >= CACHE_MAX_ENTRIES) {
    const oldest = cacheStore.keys().next().value;
    if (oldest) cacheStore.delete(oldest);
  }
  cacheStore.set(key, { timestamp: Date.now(), payload });
}

function parseBbox(
  raw: string | null,
): [number, number, number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  return [w, s, e, n];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const bbox = parseBbox(searchParams.get("bbox"));
  if (!bbox) {
    return NextResponse.json(
      { error: "Missing or invalid `bbox` (expected W,S,E,N)" },
      { status: 400 },
    );
  }

  const q = searchParams.get("q")?.trim() || null;
  const categoriesRaw = searchParams.get("categories");
  const categories = categoriesRaw
    ? categoriesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  if (!q && (!categories || categories.length === 0)) {
    return NextResponse.json(
      { error: "Provide a `q` (free-text) or `categories` (tile)" },
      { status: 400 },
    );
  }

  // Cache key — round the bbox so small jitters reuse a recent result.
  const bboxKey = bbox.map((n) => n.toFixed(3)).join(",");
  const cacheKey = `${bboxKey}|${q ?? ""}|${(categories ?? []).slice().sort().join(",")}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: { "x-cache": "HIT" } });
  }

  // Debug gate for the per-source error text: `?debug=1` or the server env
  // SEARCH_DEBUG_ERRORS=1. Off by default so internal DB error strings never
  // leak to ordinary users. (A Supabase error can name table/column internals.)
  const debug =
    searchParams.get("debug") === "1" || process.env.SEARCH_DEBUG_ERRORS === "1";

  const { places, counts, failedSources, sourceErrors } = await resolveSearchArea(
    {
      bbox,
      q,
      categories,
      signal: req.signal,
      debug,
    },
  );

  const payload = {
    source: "search-area",
    places,
    counts,
    failedSources,
    ...(debug && failedSources.length > 0 ? { sourceErrors } : {}),
  };
  // Don't pin a transient failure: only cache a fully-successful result, so a
  // recovered source isn't masked by a 15-min-stale error payload. (A debug
  // response with failures is never cached — failedSources.length > 0 here.)
  if (failedSources.length === 0) cacheSet(cacheKey, payload);
  return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
}
