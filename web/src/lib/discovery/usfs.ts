import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";

/**
 * USFS EDW Recreation Opportunities — public ArcGIS Feature Service of
 * point features for every Forest Service rec site (campgrounds,
 * cabins, lookouts, scenic overlooks, trailheads, byways). No API key.
 *
 *   https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0
 *
 * The schema doesn't carry a clean "category" field — `markertype` is
 * an icon-path enum. We classify by regex on `recareaname` which is
 * reliable in practice (USFS rec sites are conventionally named after
 * their type: "Foo Campground", "Bar Trailhead", etc.).
 *
 * US-only (covers National Forest System lands), so this contributes
 * nothing for the Canadian / non-NFS legs of the trip.
 */
const USFS_URL =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0/query";
const MAX_RESULTS = 50;

type UsfsFeature = {
  attributes: {
    recareaid?: number;
    recareaname?: string;
    recareadescription?: string;
    recareaurl?: string;
    operational_hours?: string | null;
    openstatus?: string | null;
    feedescription?: string | null;
    markertype?: string | null;
  };
  geometry?: { x: number; y: number };
};

type UsfsResponse = { features?: UsfsFeature[]; error?: { message?: string } };

/** Regex-based classifier from `recareaname`. Returns null when the
 *  name doesn't map to any slide category we surface (e.g. "Ranger
 *  District", "Visitor Center"). Order matters: most-specific first. */
function categoryFromName(name: string): SlideCategoryKey | null {
  const n = name.toLowerCase();
  if (/\bcampground|\bcamp ground|\bdispersed\b/.test(n)) return "camping";
  if (/\bcabin\b|\blookout\b/.test(n)) return "overnight";
  if (/\boverlook\b|\bvista\b|\bviewpoint\b|\bbyway\b|\btrailhead\b|\bscenic\b/.test(n))
    return "scenic";
  return null;
}

export const usfsSource: WaypointSource = {
  id: "usfs",
  async query({ bbox, categories, signal }) {
    const [w, s, e, n] = bbox;
    const url =
      `${USFS_URL}?` +
      new URLSearchParams({
        geometry: `${w},${s},${e},${n}`,
        geometryType: "esriGeometryEnvelope",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields:
          "recareaid,recareaname,recareadescription,recareaurl,operational_hours,openstatus,feedescription,markertype",
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
        resultRecordCount: String(MAX_RESULTS),
      }).toString();

    const res = await fetch(url, { signal });
    if (!res.ok) {
      console.warn(`[usfs] HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as UsfsResponse;
    if (json.error) {
      console.warn(`[usfs] error: ${json.error.message}`);
      return [];
    }
    const features = json.features ?? [];
    return features.flatMap((f) => featureToResult(f, categories));
  },
};

function featureToResult(
  f: UsfsFeature,
  wanted: SlideCategoryKey[],
): SourceResult[] {
  const a = f.attributes;
  const name = a.recareaname?.trim();
  if (!name) return [];
  const g = f.geometry;
  if (!g || typeof g.x !== "number" || typeof g.y !== "number") return [];
  const category = categoryFromName(name);
  if (!category || !wanted.includes(category)) return [];
  return [
    {
      sourceId: "usfs",
      externalId: `usfs/${a.recareaid ?? `${g.x},${g.y}`}`,
      coords: [g.x, g.y],
      category,
      title: name,
      description: cleanHtml(a.recareadescription),
      website: a.recareaurl?.trim() || undefined,
      openingHours: a.operational_hours?.trim() || undefined,
      raw: a as unknown as Record<string, unknown>,
    },
  ];
}

function cleanHtml(s?: string | null): string | undefined {
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
