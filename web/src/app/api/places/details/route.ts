import { NextResponse } from "next/server";
import { placeDetails, type PlaceRich } from "@/lib/discovery/google-places";

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
 */

const MAX_IDS = 40;
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

function parsePlaceIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const ids = (body as { placeIds?: unknown }).placeIds;
  if (!Array.isArray(ids)) return null;
  if (!ids.every((x): x is string => typeof x === "string" && x.length > 0)) {
    return null;
  }
  return Array.from(new Set(ids)).slice(0, MAX_IDS);
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

  const details: Record<string, PlaceRich> = {};
  await Promise.all(
    placeIds.map(async (id) => {
      const cached = cacheGet(id);
      const rich = cached ? cached.value : await placeDetails(id, req.signal);
      if (!cached) cacheSet(id, rich);
      // Only surface ids that yielded rich fields; a null/empty result leaves
      // the tile on essentials.
      if (rich && Object.keys(rich).length > 0) details[id] = rich;
    }),
  );

  return NextResponse.json({ details });
}
