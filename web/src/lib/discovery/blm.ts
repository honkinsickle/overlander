import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";

/**
 * BLM National Recreation Points — public ArcGIS Feature Service of
 * every Bureau of Land Management rec point feature (campgrounds,
 * primitive/developed campsites, scenic overlooks, picnic areas,
 * fire lookouts, trailheads, points of interest, etc.). No API key.
 *
 *   https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/23
 *
 * Layer 23 = "Recreation Locations - All" — aggregate of every subtype
 * with the most uniform field set. Each feature carries `FET_SUBTYPE`
 * (e.g. "Campground", "Scenic Overlook"), `FET_NAME`, optional
 * `DESCRIPTION`, `WEB_LINK`, and `PHOTO_THUMB`. We classify by subtype
 * regex into our slide categories; rows that don't map are dropped.
 *
 * US-only.
 */
const BLM_URL =
  "https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/23/query";
const MAX_RESULTS = 50;

type BlmFeature = {
  attributes: {
    OBJECTID?: number;
    FET_SUBTYPE?: string;
    FET_NAME?: string;
    DESCRIPTION?: string | null;
    WEB_LINK?: string | null;
    PHOTO_THUMB?: string | null;
    UNIT_NAME?: string | null;
    WEB_DISPLAY?: string | null;
  };
  geometry?: { x: number; y: number };
};

type BlmResponse = { features?: BlmFeature[]; error?: { message?: string } };

/** Map BLM `FET_SUBTYPE` → SlideCategoryKey. Subtype strings sometimes
 *  carry status suffixes (e.g. "Campsite - Primitive - Reservable - No Fee"),
 *  so we match prefixes. Returns null when the subtype doesn't map to
 *  a category we surface. */
function categoryFromSubtype(subtype: string): SlideCategoryKey | null {
  const s = subtype.toLowerCase();
  if (s.startsWith("campground") || s.startsWith("campsite")) return "camping";
  if (s.startsWith("cabin")) return "overnight";
  if (
    s.startsWith("scenic overlook") ||
    s.startsWith("interpretive site") ||
    s.startsWith("trail head") ||
    s.startsWith("point of interest")
  )
    return "scenic";
  if (s.startsWith("fire lookout") || s.startsWith("lighthouse")) return "oddity";
  return null;
}

export const blmSource: WaypointSource = {
  id: "blm",
  async query({ bbox, categories, signal }) {
    const [w, s, e, n] = bbox;
    const url =
      `${BLM_URL}?` +
      new URLSearchParams({
        geometry: `${w},${s},${e},${n}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields:
          "OBJECTID,FET_SUBTYPE,FET_NAME,DESCRIPTION,WEB_LINK,PHOTO_THUMB,UNIT_NAME,WEB_DISPLAY",
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
        resultRecordCount: String(MAX_RESULTS),
      }).toString();

    const res = await fetch(url, { signal });
    if (!res.ok) {
      console.warn(`[blm] HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as BlmResponse;
    if (json.error) {
      console.warn(`[blm] error: ${json.error.message}`);
      return [];
    }
    const features = json.features ?? [];
    return features.flatMap((f) => featureToResult(f, categories));
  },
};

function featureToResult(
  f: BlmFeature,
  wanted: SlideCategoryKey[],
): SourceResult[] {
  const a = f.attributes;
  // BLM has a "WEB_DISPLAY" flag — only surface records flagged for public use.
  if (a.WEB_DISPLAY && a.WEB_DISPLAY.toLowerCase() === "no") return [];
  const name = a.FET_NAME?.trim();
  if (!name) return [];
  const subtype = a.FET_SUBTYPE?.trim();
  if (!subtype) return [];
  const g = f.geometry;
  if (!g || typeof g.x !== "number" || typeof g.y !== "number") return [];
  const category = categoryFromSubtype(subtype);
  if (!category || !wanted.includes(category)) return [];
  return [
    {
      sourceId: "blm",
      externalId: `blm/${a.OBJECTID ?? `${g.x},${g.y}`}`,
      coords: [g.x, g.y],
      category,
      title: name,
      description: clean(a.DESCRIPTION),
      photoUrl: a.PHOTO_THUMB?.trim() || undefined,
      website: a.WEB_LINK?.trim() || undefined,
      raw: a as unknown as Record<string, unknown>,
    },
  ];
}

function clean(s?: string | null): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
