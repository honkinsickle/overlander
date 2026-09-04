import { NextResponse } from "next/server";
import { type PlaceRich } from "@/lib/discovery/google-places";
import { parsePlaceIds } from "./batch";
import { fetchDetailsMap } from "./handler";

/**
 * POST /api/places/details  { placeIds: string[] }
 *   → { details: { [placeId]: PlaceRich } }
 *
 * Corridor tile hydrate-by-place_id: the day-select client sends the visible
 * corpus tiles' Google place_ids; this route fetches live Place Details and
 * returns only the volatile rich fields (rating / reviewCount / photoUrl /
 * hours / priceTier) to graft onto the tiles.
 *
 * Same posture as the browse-day route: the API key stays server-side (the
 * client never sees it), results are held in a 15-min in-process ephemeral
 * cache, and NOTHING is persisted to the DB. Place Details failures resolve
 * to a missing key for that id — the tile stays essentials.
 *
 * THIN WRAPPER: this handler parses/validates, owns the 15-min cache below, and
 * shapes the `{ details }` response. The id → PlaceRich production lives in
 * `./handler`, which delegates cache-misses to `resolvePlaces()`'s
 * `enrichByGoogleId()` capability (cut over unconditionally 2026-09-03 — the
 * `DATE_DETAIL_USE_RESOLVER` flag and the legacy inline loop are gone; parity
 * was verified on TEST first). Every id is served; nothing is discarded. The
 * fan-out ceiling (40) is preserved inside `enrichByGoogleId` (`ENRICH_BATCH`).
 */

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;

type CacheEntry = { timestamp: number; value: PlaceRich | null };

// Per-lambda in-process cache, keyed by place_id — same ephemeral pattern as
// the browse-day route. Never written to a DB; cold lambdas re-fetch live.
const cacheStore = (() => {
  const g = globalThis as unknown as {
    __placeDetailsCache?: Map<string, CacheEntry>;
  };
  if (!g.__placeDetailsCache) g.__placeDetailsCache = new Map();
  return g.__placeDetailsCache;
})();

function cacheGet(id: string): { hit: true; value: PlaceRich | null } | null {
  const entry = cacheStore.get(id);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cacheStore.delete(id);
    return null;
  }
  cacheStore.delete(id);
  cacheStore.set(id, entry); // LRU refresh
  return { hit: true, value: entry.value };
}

function cacheSet(id: string, value: PlaceRich | null): void {
  if (cacheStore.size >= CACHE_MAX_ENTRIES) {
    const oldest = cacheStore.keys().next().value;
    if (oldest !== undefined) cacheStore.delete(oldest);
  }
  cacheStore.set(id, { timestamp: Date.now(), value });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const placeIds = parsePlaceIds(body);
  if (placeIds === null) {
    return NextResponse.json(
      { error: "Body must be { placeIds: string[] }" },
      { status: 400 },
    );
  }

  // Produce the id → PlaceRich map. The resolved-empty `{}` vs `null` semantics
  // (a `{}` rides through so the client's `!hydrated[id]` guard stops
  // re-requesting a place Google has nothing to add about; a `null` stays out
  // but is cached negatively) live in `./handler`. See docs/BACKLOG.md
  // § "Places enrichment: empty vs missing".
  const details: Record<string, PlaceRich> = await fetchDetailsMap(
    placeIds,
    {
      signal: req.signal,
      cache: { get: cacheGet, set: cacheSet },
    },
  );

  return NextResponse.json({ details });
}
