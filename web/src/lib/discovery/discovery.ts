import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";
import { toBrowsePlace } from "./to-browse-place";
import { enrichWithWikipedia } from "./wikipedia";
import { enrichWithMapillary } from "./mapillary";

/** Build a square bbox `[w, s, e, n]` centred on `point`, ±radiusKm
 *  in each direction. We build one of these per day endpoint (rather
 *  than a single bbox spanning the whole leg) — a 460km LA→St.George
 *  leg becomes two ~20km bboxes, so dense categories like restaurants
 *  don't time out Overpass.
 *  Approximation: 1° lat ≈ 111km; lng degrees scale by cos(lat). */
export function bboxFromCoords(
  point: [number, number],
  radiusKm: number,
): [number, number, number, number] {
  const [lng, lat] = point;
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/** Query every source in parallel across all provided bboxes, dedupe
 *  results that look like the same place, and project to
 *  `BrowsePlace[]`. Phase 1 is OSM-only; the dedup step still runs so
 *  adding more sources later is a drop-in change. */
export async function discover(args: {
  bboxes: Array<[number, number, number, number]>;
  categories: SlideCategoryKey[];
  sources: WaypointSource[];
  signal?: AbortSignal;
  /** Free-text path: when set, text-capable sources match this string
   *  within each bbox and ignore `categories`. */
  textQuery?: string;
  /** Called with a source id AND the caught error when that source's query
   *  THROWS (network/DNS unreachable). NOT called when a source returns empty
   *  cleanly — an unconfigured source (missing API key) or an HTTP error is
   *  swallowed to [] inside the adapter and never reaches here, so "not
   *  configured" is not reported as "failed". Aborts (superseded request) are
   *  excluded too. */
  onSourceError?: (sourceId: string, error: unknown) => void;
}): Promise<BrowsePlace[]> {
  const queries = args.sources.flatMap((s) =>
    args.bboxes.map((bbox) =>
      s
        .query({
          bbox,
          categories: args.categories,
          signal: args.signal,
          textQuery: args.textQuery,
        })
        .catch((err) => {
          // A superseded request aborts the signal — normal, not a source
          // failure; stay quiet and don't report it.
          if (err instanceof Error && err.name === "AbortError") {
            return [] as SourceResult[];
          }
          console.error("[discovery] SOURCE_DOWN", s.id, err);
          args.onSourceError?.(s.id, err);
          return [] as SourceResult[];
        }),
    ),
  );
  const all = (await Promise.all(queries)).flat();
  // Photo cascade: Wikipedia by name/coords, then Mapillary street-level
  // for the gaps. Runs across results from ALL sources (Foursquare,
  // RecGov, USFS, BLM in addition to OSM) so non-OSM places aren't
  // stuck with no hero photo. Overpass results may already have a
  // Wikidata photo from its own per-source enrichment — the enrichers
  // skip results that already have `photoUrl`.
  await enrichWithWikipedia(all, args.signal);
  await enrichWithMapillary(all, args.signal);
  const groups = dedupe(all);
  return groups.map(toBrowsePlace);
}

/** Group results that look like the same place. Heuristic: same
 *  category + within ~80m + fuzzy-equal name (case/whitespace-insensitive,
 *  punctuation stripped). Cheap O(n²) — fine for the per-bbox result
 *  sizes we expect (≤MAX_RESULTS per source). */
function dedupe(results: SourceResult[]): SourceResult[][] {
  const groups: SourceResult[][] = [];
  for (const r of results) {
    const match = groups.find((g) => sameSpot(g[0], r));
    if (match) match.push(r);
    else groups.push([r]);
  }
  return groups;
}

/** Same-place heuristic: same category + within ~80m + fuzzy-equal name.
 *  Typed on the minimal shape so it works for both `SourceResult` (dedup
 *  within discovery) and `BrowsePlace` (corpus↔live merge in the wizard
 *  fold) — both carry `category: SlideCategoryKey` / `coords` / `title`. */
export function sameSpot(
  a: { category?: SlideCategoryKey; coords: [number, number]; title: string },
  b: { category?: SlideCategoryKey; coords: [number, number]; title: string },
): boolean {
  if (!a.category || !b.category || a.category !== b.category) return false;
  if (haversineMeters(a.coords, b.coords) > 80) return false;
  return normalizeName(a.title) === normalizeName(b.title);
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}
