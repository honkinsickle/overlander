import type { SourceResult } from "./types";

/**
 * Mapillary v4 photo enrichment.
 *
 * For every `SourceResult` lacking a `photoUrl`, query Mapillary's
 * geosearch around the result's coords and attach the closest
 * street-level thumbnail. Free, geotagged, contributor-supplied —
 * accuracy is "near the place" not "of the place," but for roadside
 * features (overlooks, trailheads, restaurants) it almost always lands
 * something taken at the actual location.
 *
 * Requires `MAPILLARY_TOKEN` in the environment. Without it the
 * enrichment is a no-op so the rest of the discovery pipeline keeps
 * working.
 */

const MAPILLARY_URL = "https://graph.mapillary.com/images";
/** ~50m bbox around each coord — wide enough to catch nearby road
 *  imagery, tight enough to avoid pulling photos of the next block. */
const SEARCH_RADIUS_M = 50;
/** Per-result concurrency cap. Mapillary's free tier rate-limits at
 *  6 req/s; 5 parallel keeps us safely under during a typical
 *  browse-panel batch. */
const CONCURRENCY = 5;
/** Skip enrichment entirely past this many photo-less items per call —
 *  a 30-place panel doesn't need 30 lookups to feel populated. */
const MAX_LOOKUPS = 20;

let warnedMissingToken = false;

type MapillaryImage = {
  id: string;
  thumb_1024_url?: string;
  geometry?: { type: "Point"; coordinates: [number, number] };
};

type MapillaryResponse = { data?: MapillaryImage[] };

/** Convert meters → degrees latitude/longitude for a small bbox.
 *  Latitude is constant (~111 km/deg). Longitude scales by cos(lat). */
function bboxAround(
  [lng, lat]: [number, number],
  radiusMeters: number,
): [number, number, number, number] {
  const dLat = radiusMeters / 111_000;
  const dLng = radiusMeters / (111_000 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/** Haversine distance in meters. */
function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function lookupOne(
  coords: [number, number],
  token: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const [w, s, e, n] = bboxAround(coords, SEARCH_RADIUS_M);
  const url =
    `${MAPILLARY_URL}?access_token=${encodeURIComponent(token)}` +
    `&bbox=${w},${s},${e},${n}` +
    `&fields=id,thumb_1024_url,geometry&limit=10`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      // 4xx is usually a token problem — log once at the call-site level
      // (here we just bail quietly; the warn lands at module scope).
      return null;
    }
    const json = (await res.json()) as MapillaryResponse;
    const images = json.data ?? [];
    if (images.length === 0) return null;
    // Closest image to the queried coord wins.
    let best: MapillaryImage | null = null;
    let bestDist = Infinity;
    for (const img of images) {
      if (!img.thumb_1024_url || !img.geometry) continue;
      const d = distanceM(coords, img.geometry.coordinates);
      if (d < bestDist) {
        best = img;
        bestDist = d;
      }
    }
    return best?.thumb_1024_url ?? null;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return null;
    return null;
  }
}

/** Run async tasks with a concurrency cap. */
async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function enrichWithMapillary(
  results: SourceResult[],
  signal?: AbortSignal,
): Promise<void> {
  const token = process.env.MAPILLARY_TOKEN;
  if (!token) {
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[mapillary] MAPILLARY_TOKEN not set — skipping street-level photo enrichment. " +
          "Get a free token at https://www.mapillary.com/dashboard/developers",
      );
    }
    return;
  }

  const targets = results.filter((r) => !r.photoUrl).slice(0, MAX_LOOKUPS);
  if (targets.length === 0) return;

  const photoUrls = await mapWithConcurrency(targets, CONCURRENCY, (r) =>
    lookupOne(r.coords, token, signal),
  );

  for (let i = 0; i < targets.length; i++) {
    const url = photoUrls[i];
    if (url) targets[i].photoUrl = url;
  }
}
