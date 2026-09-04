import { NextResponse } from "next/server";
import { getTrip } from "@/lib/trips/repository";
import {
  BROWSE_PLACES,
  type SlideCategoryKey,
} from "@/lib/trip-browse/places";
import {
  BROWSE_CARD_CATEGORIES,
  browseCategoryToSlide,
} from "@/lib/trip-browse/palette";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { produceBrowsePlaces } from "./handler";

// The buckets the live discovery fanout actually queries for the "all" view.
// `attraction` is included: the live mappers (OSM/Foursquare/Google) now have
// scoped query sets for museums + cultural/historic landmarks, so the default
// feed surfaces them instead of only showing them when the chip is selected.
// `interest`/`urban` stay OUT — their live query sets are empty and no source
// derives a result into them; they're corpus-backed via the federated RPC.
//
// ⚠️ THIS LIST IS THE `all` EXPANSION ONLY. It used to double as the
// validation allowlist, which is exactly the bug fixed here — see
// REQUESTABLE_CATEGORIES below.
const ALL_VIEW_CATEGORIES: SlideCategoryKey[] = [
  "scenic",
  "food",
  "oddity",
  "attraction",
  "camping",
  "overnight",
  "fuel",
];

/** What a client may legally ASK for — every slide key the browse chip row can
 *  actually produce, derived FROM that row so the two cannot drift apart again.
 *
 *  Deliberately WIDER than `ALL_VIEW_CATEGORIES`. `urban` and `interest` have
 *  empty live query sets, so they contribute nothing to the `all` fanout and
 *  stay out of it — but they are corpus-backed and the filter row renders a
 *  chip for each, so a single-chip request for them is legitimate and must
 *  return a normal (possibly empty) result rather than an HTTP 400.
 *
 *  Before this split, one constant answered both "what does `all` mean" and
 *  "what is legal to request", so tapping the urban or interest chip produced
 *  `400 Invalid category "urban"` — reproduced against this route on
 *  2026-09-03 before the fix. See docs/investigations/
 *  2026-09-02-three-surfaces-place-data-paths.md (the finding) and
 *  2026-09-02-category-source-audit.md §"Finding 1" (the vocabulary split). */
const REQUESTABLE_CATEGORIES: readonly SlideCategoryKey[] = Array.from(
  new Set(BROWSE_CARD_CATEGORIES.map(browseCategoryToSlide)),
);

export type ParsedCategories =
  | { ok: true; categories: SlideCategoryKey[] }
  | { ok: false; error: string };

/**
 * Resolve the requested category set from the query params. PURE — no I/O, so
 * it is unit-testable without a DB or network.
 *
 * Extracted and exported specifically because this is where the urban/interest
 * 400 bug lived. `handler.test.ts` states the route "has no tests of its own
 * because it is a thin wrapper (validate + cache + fixture + shape)" — that
 * assumption is what let a validation bug ship unnoticed, so the validate half
 * now has its own guard in `route.test.ts`.
 *
 * `categories=` wins when both params are present (pre-existing behaviour,
 * unchanged).
 */
export function resolveRequestedCategories(
  categoriesParam: string | null,
  categoryParam: string | null,
): ParsedCategories {
  if (categoriesParam) {
    if (categoriesParam === "all") {
      // `all` still means the LIVE-fanout set only — deliberately narrower
      // than what is requestable. See both constants above.
      return { ok: true, categories: [...ALL_VIEW_CATEGORIES] };
    }
    const parts = categoriesParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bad = parts.find(
      (p) => !REQUESTABLE_CATEGORIES.includes(p as SlideCategoryKey),
    );
    if (bad) {
      return {
        ok: false,
        error: `Invalid category "${bad}". Expected: ${REQUESTABLE_CATEGORIES.join(", ")}`,
      };
    }
    return { ok: true, categories: parts as SlideCategoryKey[] };
  }
  if (categoryParam) {
    if (!REQUESTABLE_CATEGORIES.includes(categoryParam as SlideCategoryKey)) {
      return {
        ok: false,
        error: `Invalid category. Expected one of: ${REQUESTABLE_CATEGORIES.join(", ")}`,
      };
    }
    return { ok: true, categories: [categoryParam as SlideCategoryKey] };
  }
  return { ok: false, error: "Missing `category` or `categories` query param" };
}

/** Server-side flag (default OFF). Gates whether federated `pois_along_corridor`
 *  rows are merged into the feed — a DATA flag, orthogonal to the resolver
 *  cutover (which is now unconditional). Wired into `resolvePlaces` via
 *  `include.federated` in the handler. See the cutover plan §3. */
const USE_FEDERATED_POIS = process.env.USE_FEDERATED_POIS === "true";

/** In-process response cache. Browse data is expensive to compute
 *  (~7s single-category, ~13s all-fanout) but identical across requests
 *  within the cache TTL — discover() reads bbox + categories with no
 *  per-user state. Caching at the route handler level gives near-instant
 *  re-opens of the same panel (chip toggles between cached filter sets,
 *  closing + re-opening a day, etc).
 *
 *  On Vercel: globalThis is per-warm-lambda. First hit on a lambda is
 *  a miss; warm lambdas serve from cache. Cold-start cost unchanged.
 *  Stale-ness: 15 min is well within "place hasn't moved" tolerance;
 *  fresh discovery data isn't load-bearing for the browse UX. */
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

type CacheEntry = { timestamp: number; payload: unknown };

const cacheStore = (() => {
  const g = globalThis as unknown as { __browseCache?: Map<string, CacheEntry> };
  if (!g.__browseCache) g.__browseCache = new Map();
  return g.__browseCache;
})();

function cacheKey(
  tripId: string,
  dayId: string,
  categories: readonly SlideCategoryKey[],
): string {
  return `${tripId}|${dayId}|${[...categories].sort().join(",")}`;
}

function cacheGet(key: string): unknown | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cacheStore.delete(key);
    return null;
  }
  // Refresh insertion order so this entry is "most recently used" for
  // the simple LRU eviction below.
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

/**
 * Browse-panel data for one day.
 *
 *   GET /api/trip-browse/:tripId/:dayId?category=scenic         (single)
 *   GET /api/trip-browse/:tripId/:dayId?categories=scenic,food  (multi)
 *   GET /api/trip-browse/:tripId/:dayId?categories=all          (all 6)
 *
 * THIN WRAPPER: this handler validates the category set, owns the LRU cache,
 * runs the fixture fast path, resolves the trip/day geometry, and shapes the
 * `{ source, places }` response. The "produce the ranked places" step lives in
 * `./handler`, which calls `resolvePlaces()` (day-corridor scope) with
 * `USE_FEDERATED_POIS` wired through as the orthogonal data flag.
 *
 * Single-category responses preserve the legacy shape `{ source, places }`.
 * Multi-category responses use `{ source: "discovery", places }` where each
 * place has its `category` set. Fixture trips (la-to-portland) take the
 * single-category fast path only; multi-category falls through to live
 * discovery.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ tripId: string; dayId: string }> },
) {
  const { tripId, dayId } = await context.params;
  const { searchParams } = new URL(req.url);
  const categoriesParam = searchParams.get("categories");
  const categoryParam = searchParams.get("category");

  const parsed = resolveRequestedCategories(categoriesParam, categoryParam);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const requested: SlideCategoryKey[] = parsed.categories;

  // Cache lookup — happens before the trip fetch so a warm cache hit
  // is a single Map.get(). Key includes the normalized category set so
  // chip-toggle re-fetches that match a prior filter combination land
  // here too.
  const cacheK = cacheKey(tripId, dayId, requested);
  const cached = cacheGet(cacheK);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "x-cache": "HIT" },
    });
  }

  const trip = await getTrip(tripId);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  const dayIndex = trip.days.findIndex((d) => d.id === dayId);
  if (dayIndex === -1) {
    return NextResponse.json({ error: "Day not found" }, { status: 404 });
  }
  const day = trip.days[dayIndex];

  // Single-category fixture fast path. Multi-category requests skip the
  // fixture and go straight to live discovery so the merged feed has a
  // consistent shape across categories.
  const isSingle = requested.length === 1 && !categoriesParam;
  const FIXTURE_TRIPS = new Set(["la-to-portland"]);
  if (isSingle && FIXTURE_TRIPS.has(tripId)) {
    const slideKey = requested[0];
    const fixturePlaces = BROWSE_PLACES[day.dayNumber]?.[slideKey];
    if (fixturePlaces && fixturePlaces.length > 0) {
      const stamped = fixturePlaces.map((p) => ({ ...p, category: slideKey }));
      const payload = { source: "fixture", places: stamped };
      cacheSet(cacheK, payload);
      return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
    }
  }

  // Day-start coord for the distance-from-origin sort. Day 1 uses the
  // trip-level start; subsequent days use the previous overnight.
  const prev = trip.days[dayIndex - 1];
  const dayStart: [number, number] | undefined =
    prev?.coords ?? (dayIndex === 0 ? trip.startCoords : undefined);

  // Bbox endpoints — keep parity with the legacy single-category path:
  // this day's coord + previous day's coord (or trip start for Day 1).
  const points: Array<[number, number]> = [];
  if (day.coords) points.push(day.coords);
  if (prev?.coords) points.push(prev.coords);
  else if (dayIndex === 0 && trip.startCoords) points.push(trip.startCoords);

  if (points.length === 0) {
    return NextResponse.json({ source: "discovery", places: [] });
  }

  // Federated path is opt-in. Create the anon+JWT server client once (only
  // when flagged) so the corridor RPC calls reuse it — passed to both the
  // legacy and resolver paths in `./handler`.
  const federatedClient = USE_FEDERATED_POIS
    ? await createSupabaseServerClient()
    : null;

  const places = await produceBrowsePlaces({
    requested,
    dayStart,
    dayEnd: day.coords,
    points,
    useFederated: USE_FEDERATED_POIS,
    supabase: federatedClient,
    signal: req.signal,
  });

  const payload = { source: "discovery", places };
  cacheSet(cacheK, payload);
  return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
}
