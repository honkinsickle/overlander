import { NextResponse } from "next/server";
import { discover } from "@/lib/discovery/discovery";
import {
  googlePlacesSource,
  googleTextSearchSource,
} from "@/lib/discovery/google-places";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import { search } from "@/lib/search";
import { hydratePlacesByIds } from "@/lib/trip-browse/hydrate";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

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
 */

/** Corpus `primary_category` → live slide bucket, for the categories that
 *  Google actually covers via TYPES_BY_CATEGORY. Primaries omitted here are
 *  overland-specific (dispersed_camping, trailhead, water, shower,
 *  dump_station, ev_charging, grocery, car_repair, …) — Google has no honest
 *  type for them, so they run federated-only rather than borrowing an
 *  unrelated live result. */
const LIVE_SLIDE_FOR_PRIMARY: Record<string, SlideCategoryKey> = {
  // FOOD — Google food types: restaurant / cafe / bar / bakery
  cafe: "food",
  restaurant: "food",
  fast_food_restaurant: "food",
  diner: "food",
  american_restaurant: "food",
  italian_restaurant: "food",
  mexican_restaurant: "food",
  chinese_restaurant: "food",
  indian_restaurant: "food",
  french_restaurant: "food",
  brazilian_restaurant: "food",
  taco_restaurant: "food",
  pizza_restaurant: "food",
  hamburger_restaurant: "food",
  chicken_restaurant: "food",
  breakfast_restaurant: "food",
  family_restaurant: "food",
  fine_dining_restaurant: "food",
  steak_house: "food",
  sandwich_shop: "food",
  bar_and_grill: "food",
  gastropub: "food",
  brewpub: "food",
  // FUEL — Google: gas_station
  gas_station: "fuel",
  truck_stop: "fuel",
  // CAMPING — Google: campground / rv_park
  campground: "camping",
  rv_park: "camping",
  camping_cabin: "camping",
  // OVERNIGHT — Google: lodging / hotel
  hotel: "overnight",
  motel: "overnight",
  resort_hotel: "overnight",
  // SCENIC — Google: tourist_attraction / park / national_park
  viewpoint: "scenic",
  peak: "scenic",
  mountain_peak: "scenic",
  scenic_spot: "scenic",
  // ODDITY — Google: museum / art_gallery / historical_landmark. Enables the
  // broad "oddity" category chip (the Find-Nearby filter row) to pull live
  // museums/galleries; the corpus carries no oddity rows, so federated is
  // empty here by design.
  museum: "oddity",
  art_gallery: "oddity",
  historical_landmark: "oddity",
};

const LIMIT = 24;

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

  // Sources that THREW (network/DNS unreachable) this request — corpus and/or
  // named live sources. Distinguishes "a source is down" from "a source
  // returned no matches", so the client can say which half is missing. Mutated
  // synchronously inside each half's catch; both halves are single-threaded JS.
  const failedSources = new Set<string>();

  // ── LIVE half ────────────────────────────────────────────────────────
  const livePromise: Promise<BrowsePlace[]> = (async () => {
    try {
      if (q) {
        // Free-text → Google searchText only (FSQ has no text path).
        return await discover({
          bboxes: [bbox],
          categories: [],
          sources: [googleTextSearchSource],
          textQuery: q,
          signal: req.signal,
          onSourceError: (id) => failedSources.add(id),
        });
      }
      // Category tiles → searchNearby fanout, mapped to the buckets Google
      // covers. Overland-only categories drop out here (federated-only).
      const slideKeys = Array.from(
        new Set(
          (categories ?? [])
            .map((c) => LIVE_SLIDE_FOR_PRIMARY[c])
            .filter((k): k is SlideCategoryKey => Boolean(k)),
        ),
      );
      if (slideKeys.length === 0) return [];
      return await discover({
        bboxes: [bbox],
        categories: slideKeys,
        sources: [
          googlePlacesSource,
          foursquareSource,
          recGovSource,
          usfsSource,
          blmSource,
        ],
        signal: req.signal,
        onSourceError: (id) => failedSources.add(id),
      });
    } catch (err) {
      console.warn("[search-area] live discovery failed:", err);
      return [];
    }
  })();

  // ── FEDERATED half ───────────────────────────────────────────────────
  const federatedPromise: Promise<BrowsePlace[]> = (async () => {
    try {
      const hits = await search({
        query: q ?? "*",
        categories: categories ?? undefined,
        bbox,
        limit: LIMIT,
      });
      if (hits.length === 0) return [];
      return await hydratePlacesByIds(hits.map((h) => h.id));
    } catch (err) {
      console.error("[search-area] FEDERATED_DOWN", err);
      failedSources.add("corpus");
      return [];
    }
  })();

  const [live, federated] = await Promise.all([livePromise, federatedPromise]);

  // Merge — distinct id namespaces (live `gpl/…`/`osm/…`, federated `mp:…`)
  // so a cross-source dedupe isn't needed; guard against accidental dupes by
  // keeping first occurrence.
  const seen = new Set<string>();
  const places: BrowsePlace[] = [];
  for (const p of [...live, ...federated]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    places.push(p);
  }

  const failed = [...failedSources];
  const payload = {
    source: "search-area",
    places,
    counts: { live: live.length, federated: federated.length },
    failedSources: failed,
  };
  // Don't pin a transient failure: only cache a fully-successful result, so a
  // recovered source isn't masked by a 15-min-stale error payload.
  if (failed.length === 0) cacheSet(cacheKey, payload);
  return NextResponse.json(payload, { headers: { "x-cache": "MISS" } });
}
