import { NextResponse } from "next/server";
import { getTrip } from "@/lib/trips/repository";
import {
  BROWSE_PLACES,
  type BrowsePlace,
  type SlideCategoryKey,
} from "@/lib/trip-browse/places";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { googlePlacesSource } from "@/lib/discovery/google-places";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import {
  haversineMi,
  pointToPolylineMi,
} from "@/lib/routing/point-to-polyline";
import { fetchFederatedPois } from "@/lib/trip-browse/federated";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

/** Per-category search radius around each day endpoint. Camping leans
 *  wider because overlanders detour further for the right site (and
 *  BLM/NFS dispersed sites tend to sit between towns, not in them).
 *  Food stays tight so dense urban bboxes don't time out Overpass. */
const RADIUS_KM_BY_CATEGORY: Record<SlideCategoryKey, number> = {
  food: 5,
  scenic: 15,
  oddity: 25,
  overnight: 15,
  camping: 50,
  fuel: 10,
  attraction: 15,
  interest: 15,
  urban: 10,
};

/** Soft corridor — places within this far from today's route polyline
 *  rank above places beyond it. Matches the "within 10 miles of today's
 *  route" Browse-panel spec. */
const CORRIDOR_MI = 10;

/** Server-side flag (default OFF). When off, this handler is byte-for-byte
 *  unchanged — the federated master_place corridor read is never invoked
 *  and no result is tagged. When on, federated POIs from the
 *  pois_along_corridor RPC are merged ALONGSIDE the live fanout (additive,
 *  never a replacement). */
const USE_FEDERATED_POIS = process.env.USE_FEDERATED_POIS === "true";

/** Federated corridor read uses meters (RPC casts ::geography); 16000m ≈
 *  the 10mi CORRIDOR_MI client-side filter, so federated rows clear it. */
const FEDERATED_BUFFER_M = 16000;

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
  // when flagged) so each category's RPC call reuses it. The day segment
  // (start→end) is the SAME 2-point line the corridor filter below uses.
  const federatedClient = USE_FEDERATED_POIS
    ? await createSupabaseServerClient()
    : null;
  const dayEndCoord = day.coords;

  // Fan out one discover() call per category in parallel — discover()
  // itself dedupes within each call but not across categories, which is
  // fine since a single place rarely qualifies for two slideKeys.
  const perCategory = await Promise.all(
    requested.map(async (slideKey) => {
      const bboxes = points.map((p) =>
        bboxFromCoords(p, RADIUS_KM_BY_CATEGORY[slideKey]),
      );
      const places = await discover({
        bboxes,
        categories: [slideKey],
        sources: [
          googlePlacesSource,
          recGovSource,
          foursquareSource,
          usfsSource,
          blmSource,
        ],
        signal: req.signal,
      });
      const live = places.map<BrowsePlace>((p) => ({ ...p, category: slideKey }));

      // Flag OFF: byte-for-byte the legacy path — untagged live results.
      if (!USE_FEDERATED_POIS) return live;

      // Flag ON: tag live origin, then merge federated RPC rows alongside.
      const liveTagged = live.map<BrowsePlace>((p) => ({
        ...p,
        source: "live" as const,
      }));
      if (!federatedClient || !dayStart || !dayEndCoord) return liveTagged;
      const federated = await fetchFederatedPois({
        supabase: federatedClient,
        slideKey,
        start: dayStart,
        end: dayEndCoord,
        bufferMeters: FEDERATED_BUFFER_M,
        signal: req.signal,
      });
      return [...liveTagged, ...federated];
    }),
  );
  const merged = perCategory.flat();

  // Cross-category de-dupe by id — same place can show up in two
  // categories occasionally (e.g. a campground tagged as both camping
  // and scenic). Keep the first occurrence.
  const seen = new Set<string>();
  const unique: BrowsePlace[] = [];
  for (const p of merged) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    unique.push(p);
  }

  // Filter to within CORRIDOR_MI of today's route; sort by haversine
  // distance from day-start ascending. The "Within 10 mi of today"
  // panel header makes the filter explicit — places beyond the
  // corridor used to slip in (ranked lower) but now drop out entirely.
  //
  // Corridor is computed against TODAY'S segment only — a synthetic
  // two-point line from day-start → day-end. Using the trip-level
  // polyline let places near a different day's segment slip in (e.g.
  // a viewpoint near Day 27 appearing on Day 16's panel because the
  // full trip passes within 10mi of both).
  const dayEnd = day.coords;
  const daySegment: [number, number][] =
    dayStart && dayEnd
      ? [dayStart, dayEnd]
      : dayEnd
        ? [dayEnd]
        : dayStart
          ? [dayStart]
          : [];
  const scored = unique
    .map((p) => ({
      place: p,
      milesOffRoute:
        daySegment.length > 0
          ? pointToPolylineMi(p.coords, daySegment)
          : 0,
      fromStart: dayStart ? haversineMi(p.coords, dayStart) : Infinity,
    }))
    .filter((s) => s.milesOffRoute <= CORRIDOR_MI);
  scored.sort((a, b) => a.fromStart - b.fromStart);
  const sorted = scored.map((s) => s.place);

  const payload = { source: "discovery", places: sorted };
  cacheSet(cacheK, payload);
  return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
}
