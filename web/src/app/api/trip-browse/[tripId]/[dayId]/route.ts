import { NextResponse } from "next/server";
import { getTrip } from "@/lib/trips/repository";
import {
  BROWSE_PLACES,
  type SlideCategoryKey,
} from "@/lib/trip-browse/places";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { produceBrowsePlaces } from "./handler";

// The buckets the live discovery fanout actually queries for the "all" view.
// `attraction` is included: the live mappers (OSM/Foursquare/Google) now have
// scoped query sets for museums + cultural/historic landmarks, so the default
// feed surfaces them instead of only showing them when the chip is selected.
// `interest`/`urban` stay OUT — their live query sets are empty and no source
// derives a result into them; they're corpus-backed via the federated RPC.
const SLIDE_CATEGORIES: SlideCategoryKey[] = [
  "scenic",
  "food",
  "oddity",
  "attraction",
  "camping",
  "overnight",
  "fuel",
];

/** Server-side flag (default OFF). Gates whether federated `pois_along_corridor`
 *  rows are merged into the feed. Independent of the resolver flag below — see
 *  the cutover plan §3. */
const USE_FEDERATED_POIS = process.env.USE_FEDERATED_POIS === "true";

/** Cut the day-scoped browse feed over to the consolidated `resolvePlaces()`
 *  service (day-corridor scope). Mirrors `SEARCH_AREA_USE_RESOLVER` /
 *  `DATE_DETAIL_USE_RESOLVER`: an env boolean, default OFF. OFF = the exact
 *  pre-cutover discover-fanout body (zero behaviour change). ON = resolvePlaces()
 *  with `include.federated` wired to `USE_FEDERATED_POIS`, so the two flags stay
 *  orthogonal (all four combinations preserve today's behaviour). A flip is a
 *  redeploy → fresh process → fresh cache, so no stale other-mode payload
 *  survives a flip. See docs/architecture/resolve-places-day-scoped-browse-cutover-plan.md. */
const TRIP_BROWSE_USE_RESOLVER =
  process.env.TRIP_BROWSE_USE_RESOLVER === "true";

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
 * `./handler`, behind `TRIP_BROWSE_USE_RESOLVER` (with `USE_FEDERATED_POIS`
 * wired through as the orthogonal data flag).
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

  // Resolve the requested category set. `categories=` wins if both
  // are present.
  let requested: SlideCategoryKey[];
  if (categoriesParam) {
    if (categoriesParam === "all") {
      requested = [...SLIDE_CATEGORIES];
    } else {
      const parts = categoriesParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = parts.find(
        (p) => !SLIDE_CATEGORIES.includes(p as SlideCategoryKey),
      );
      if (bad) {
        return NextResponse.json(
          { error: `Invalid category "${bad}". Expected: ${SLIDE_CATEGORIES.join(", ")}` },
          { status: 400 },
        );
      }
      requested = parts as SlideCategoryKey[];
    }
  } else if (categoryParam) {
    if (!SLIDE_CATEGORIES.includes(categoryParam as SlideCategoryKey)) {
      return NextResponse.json(
        { error: `Invalid category. Expected one of: ${SLIDE_CATEGORIES.join(", ")}` },
        { status: 400 },
      );
    }
    requested = [categoryParam as SlideCategoryKey];
  } else {
    return NextResponse.json(
      { error: "Missing `category` or `categories` query param" },
      { status: 400 },
    );
  }

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
    useResolver: TRIP_BROWSE_USE_RESOLVER,
    useFederated: USE_FEDERATED_POIS,
    supabase: federatedClient,
    signal: req.signal,
  });

  const payload = { source: "discovery", places };
  cacheSet(cacheK, payload);
  return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
}
