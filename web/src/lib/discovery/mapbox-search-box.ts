/**
 * Mapbox Search Box API — the `fuel` category source.
 *
 * WHY THIS EXISTS (2026-08-25). Fuel discovery was previously served by
 * `googlePlacesSource` (`TYPES_BY_CATEGORY.fuel = ["gas_station"]`, since
 * removed). Google Places, when rendered on a non-Google map, requires the
 * Places UI Kit as a compliant display path. Since the app renders on
 * Mapbox GL JS, this source moves fuel to a display-compliant provider —
 * Mapbox Search Box results are permitted for map-rendered results on a
 * Mapbox map.
 *
 * SCOPE. The `fuel` slide bucket, which spans two Find Nearby intents that
 * collapse to the same slide key: Gas (`gas_station`/`truck_stop`/`ev_charging`
 * primaries → Mapbox `gas_station`) and Auto/Repair (`car_repair`/`car_wash`
 * primaries → Mapbox `auto_repair`/`car_wash`, wired 2026-09-03). The source
 * reads the RAW `primaryCategories` to pick which Mapbox category to hit;
 * with none supplied (the day-corridor path passes slide keys only) it
 * defaults to `gas_station`, preserving the original fuel behaviour. Other
 * slide categories return `[]`. This source sits alongside `googlePlacesSource`
 * in both the legacy `LIVE_SOURCES` lists (`/api/trip-browse`,
 * `/api/search-area`) and `resolvePlaces()`'s `DEFAULT_*_LIVE_SOURCES`, so
 * fuel/auto come from Mapbox regardless of the `TRIP_BROWSE_USE_RESOLVER` /
 * `SEARCH_AREA_USE_RESOLVER` flag state.
 *
 * `repair_shop` is deliberately NOT mapped. Live-probed 2026-09-03, its
 * results are appliance / electronics / furniture repair (`poi_category:
 * "repair shop"`), not auto — wiring it would pollute Auto/Repair. The audit
 * (#364) listed it as available; sampling showed it is the wrong category.
 *
 * DELIBERATELY NOT PERSISTED. Mapbox Search Box terms restrict results to
 * temporary/session use — see the caller compliance rule: no cache beyond
 * normal in-request/session React Query. This module does not warehouse.
 * (Distinct from Path A / PR #288's fuel-live-resolve at
 * `web/src/lib/itinerary/fuel-live-resolve.ts`, which is still on Google
 * and DOES persist a `google:<placeId>` tile into `trips.payload` via the
 * audit-time bake — a separate follow-up per Adam's direction.)
 *
 * DEPENDENCY. Hand-rolled `fetch` against the REST endpoint; NO new npm
 * dep (`@mapbox/search-js-*`). Reasoning: the category endpoint is one
 * URL + one JSON parse; the SDK's abstractions (session tokens, autocomplete
 * suggestions, retrieve-by-mapbox_id) are for the /suggest+/retrieve
 * two-step flow that this source deliberately doesn't use. Adding an SDK
 * would carry ~all of Search-Box-JS-core for a call we can express in ~40
 * lines. `web/CLAUDE.md` requires asking before adding deps; the hand-roll
 * is the flagged pick.
 *
 * Docs: https://docs.mapbox.com/api/search/search-box/#category-search
 */
import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";

const CATEGORY_ENDPOINT_BASE =
  "https://api.mapbox.com/search/searchbox/v1/category";

/** Mapbox's canonical category id for gas stations. Matches the "gas_station"
 *  key used elsewhere in this codebase for Google's Places API type; the
 *  string is the same by coincidence, not by mapping. Mapbox docs list
 *  canonical ids under Search Box category search — `gas_station` is the
 *  fuel POI category. */
const MAPBOX_FUEL_CATEGORY = "gas_station";

/** Raw corpus `primary_category` → Mapbox Search Box canonical category id.
 *  The gas family all resolve to `gas_station` (fuel behaviour is unchanged —
 *  today's source queries only `gas_station` for any fuel request, and EV is a
 *  separate open question, see the routing table). Auto/Repair's two primaries
 *  map to their auto-specific Mapbox categories, verified 2026-09-03:
 *  `auto_repair` returns `mechanic` POIs, `car_wash` returns car washes.
 *  `repair_shop` is intentionally absent (see the module docstring). */
const MAPBOX_CATEGORY_FOR_PRIMARY: Record<string, string> = {
  gas_station: "gas_station",
  truck_stop: "gas_station",
  ev_charging: "gas_station",
  car_repair: "auto_repair",
  car_wash: "car_wash",
};

/** Mapbox Search Box category endpoint caps at 25 features per request
 *  (matching `MAX_RESULTS = 20` on the Google side — chose 25 to use the
 *  full Mapbox ceiling since this source is the ONLY fuel provider). */
const MAX_RESULTS = 25;

/** Mapbox Search Box category feature — minimal shape this module reads.
 *  Kept narrow so response-shape drift on unused fields does not fail parse. */
export type MapboxCategoryFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    mapbox_id: string;
    name: string;
    feature_type?: string;
    /** Preferred pretty-address if present. */
    full_address?: string;
    /** Fallback address (street-address style). */
    address?: string;
    /** Category array + canonical ids array. Not filtered by this source
     *  because the category endpoint returns only the requested category. */
    poi_category?: string[];
    poi_category_ids?: string[];
  };
};

type MapboxCategoryResponse = {
  type: "FeatureCollection";
  features?: MapboxCategoryFeature[];
};

/** Pure — one feature → one SourceResult. Exported for testing.
 *  Every category this source queries (gas, auto_repair, car_wash) lives under
 *  the `fuel` slide parent (Decision 8 — Auto/Repair is in the fuel/Services
 *  cluster), so the result carries `category: "fuel"`. There is no
 *  `car_repair` slide key to stamp; an auto-repair card renders under fuel. */
export function featureToSourceResult(f: MapboxCategoryFeature): SourceResult {
  const address = f.properties.full_address ?? f.properties.address;
  return {
    sourceId: "mapbox",
    externalId: f.properties.mapbox_id,
    coords: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
    category: "fuel",
    title: f.properties.name,
    ...(address ? { address } : {}),
  };
}

/** Pure — build the Mapbox Search Box category URL for a given canonical
 *  category id. Exported for testing. */
export function buildCategoryUrl(
  category: string,
  bbox: [number, number, number, number],
  token: string,
): string {
  const [w, s, e, n] = bbox;
  const u = new URL(`${CATEGORY_ENDPOINT_BASE}/${category}`);
  u.searchParams.set("bbox", `${w},${s},${e},${n}`);
  u.searchParams.set("limit", String(MAX_RESULTS));
  u.searchParams.set("access_token", token);
  return u.toString();
}

/** Back-compat wrapper: the gas-station URL. */
export function buildFuelCategoryUrl(
  bbox: [number, number, number, number],
  token: string,
): string {
  return buildCategoryUrl(MAPBOX_FUEL_CATEGORY, bbox, token);
}

/** Injectable seams for testing — the source uses real `fetch` + real env in
 *  production, and swaps both in unit tests without a global mock. */
export type MapboxSearchBoxDeps = {
  fetchImpl?: typeof fetch;
  tokenFn?: () => string | undefined;
};

let warnedMissingKey = false;

/** Factory — used by tests to inject a fake fetch / token; production callers
 *  should import the ready-made `mapboxSearchBoxSource` default export below. */
export function createMapboxSearchBoxSource(
  deps: MapboxSearchBoxDeps = {},
): WaypointSource {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const tokenFn =
    deps.tokenFn ?? (() => process.env.NEXT_PUBLIC_MAPBOX_TOKEN);

  /** Fetch one Mapbox category endpoint → SourceResult[]. A network throw or
   *  non-OK response degrades to [] (per-category), matching the original
   *  single-category behaviour. */
  const fetchCategory = async (
    category: string,
    bbox: [number, number, number, number],
    token: string,
    signal?: AbortSignal,
  ): Promise<SourceResult[]> => {
    const url = buildCategoryUrl(category, bbox, token);
    let res: Response;
    try {
      res = await fetchImpl(url, { signal });
    } catch {
      return [];
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[mapbox-search-box] HTTP ${res.status} (${category}) ${body.slice(0, 200)}`,
      );
      return [];
    }
    const json = (await res.json().catch(() => null)) as
      | MapboxCategoryResponse
      | null;
    return (json?.features ?? []).map(featureToSourceResult);
  };

  return {
    id: "mapbox",
    async query({ bbox, categories, signal, primaryCategories }) {
      // Fuel-bucket source. Other slide categories return [] so the aggregator
      // can multiplex us alongside `googlePlacesSource` without an extra
      // category-router layer. (Gas AND Auto/Repair both collapse to `fuel`.)
      if (!categories.includes("fuel" as SlideCategoryKey)) return [];

      const token = tokenFn();
      if (!token) {
        if (!warnedMissingKey) {
          console.warn(
            "[mapbox-search-box] NEXT_PUBLIC_MAPBOX_TOKEN not set — " +
              "skipping Mapbox fuel discovery. Set the token in web/.env.local.",
          );
          warnedMissingKey = true;
        }
        return [];
      }

      // Which Mapbox categories to hit, from the RAW primary_category request.
      // When none is supplied (day-corridor passes slide keys only), default to
      // gas_station — the original fuel behaviour, byte-for-byte.
      const mapboxCats = new Set<string>();
      for (const p of primaryCategories ?? []) {
        const mb = MAPBOX_CATEGORY_FOR_PRIMARY[p];
        if (mb) mapboxCats.add(mb);
      }
      if (mapboxCats.size === 0) mapboxCats.add(MAPBOX_FUEL_CATEGORY);

      const perCategory = await Promise.all(
        [...mapboxCats].map((c) => fetchCategory(c, bbox, token, signal)),
      );
      return perCategory.flat();
    },
  };
}

/** Default source — production-wired, no injected deps. Use this from the
 *  legacy `LIVE_SOURCES` arrays and `DEFAULT_*_LIVE_SOURCES` in
 *  `resolve-places.ts`. */
export const mapboxSearchBoxSource: WaypointSource =
  createMapboxSearchBoxSource();
