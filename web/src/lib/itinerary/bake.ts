/**
 * Bake corridors onto generated days (the 4th creation path — like
 * reference/fork/wizard). Turns each generated day into a full corridor day:
 * a derived city spine + POI tiles bucketed under its nodes, so the Day
 * Detail column renders like a real corridor trip instead of the degraded
 * 2-node Start→End fallback.
 *
 * Pure WIRING through shipped machinery — the exact per-day steps
 * `buildRouteAwareDays` (wizard finalize) runs:
 *   routeBetween → fetchCorpusForSegment → deriveCorridorCities →
 *   bucketPlacesIntoCorridor.
 *
 * Fed by the audit: it already routed every day (for distance), so we reuse
 * its polylines and only re-route days whose EXCURSIONS need threading — the
 * tier-2 resolvedPlaces coords become the route vias AND bucket as tiles, so
 * a spur like Salmon Glacier lands under the right node.
 */

import { geocode } from "@/lib/routing/geocode";
import { routeBetween } from "@/lib/routing/route-between";
import { deriveCorridorCities, DEFAULT_CORRIDOR_PARAMS } from "@/lib/corridor/derive";
import { bucketPlacesIntoCorridor } from "@/lib/corridor/bucket";
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
import { fetchCorpusForSegment } from "@/lib/trips/bake-corridors";
import gazetteer from "@/lib/corridor/data/cities-na.json";
import type { GazetteerCity } from "@/lib/corridor/derive";
import type { CorridorCity } from "@/lib/trips/types";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import type { GenerationInput } from "./facts";
import type { ItineraryOutput, ResolvedPlace } from "./schema";
import type { DayRoute } from "./audit";

/** Exactly the client `fetchCorpusForSegment` accepts. */
type ServerClientLike = Parameters<typeof fetchCorpusForSegment>[2];

export type BakedDay = {
  n: number;
  /** Derived + bucketed spine; undefined when the day has no measurable
   *  route (a layover) — that day keeps its degraded 2-node view. */
  corridorCities?: CorridorCity[];
  /** The day's POI tiles (per-day corpus + tier-2 resolved places). Their
   *  ids are what the spine's placeIds reference. */
  segmentSuggestions: BrowsePlace[];
};

/** A resolved tier-2 place as a browsable tile (real place_id → hydratable). */
function resolvedToTile(rp: ResolvedPlace): BrowsePlace {
  return {
    id: `google:${rp.placeId}`,
    coords: rp.coords,
    title: rp.displayName,
    photoAlt: rp.displayName,
    pills: [{ label: "live-resolved" }],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: "",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "",
    placeId: rp.placeId,
  };
}

/**
 * Bake spine + bucketed tiles onto each generated day. `dayRoutes` (from the
 * audit) supplies already-computed endpoints/polylines; days with excursion
 * vias are re-routed through them so the spur is on the line.
 */
export async function bakeGeneratedDays(
  audited: ItineraryOutput,
  input: GenerationInput,
  supabase: ServerClientLike,
  dayRoutes: DayRoute[],
): Promise<BakedDay[]> {
  const routeByN = new Map(dayRoutes.map((r) => [r.n, r]));

  return Promise.all(
    audited.days.map(async (day): Promise<BakedDay> => {
      const dr = routeByN.get(day.n);
      const resolved = day.audit?.resolvedPlaces ?? [];
      const vias = resolved.map((r) => r.coords);

      // Endpoints: reuse the audit's geocoded coords; geocode as a fallback.
      let start = dr?.startCoord ?? null;
      let end = dr?.endCoord ?? null;
      if (!start) start = await geocode(day.startPlace).catch(() => null);
      if (!end) end = await geocode(day.endPlace).catch(() => null);

      // Polyline: reuse the audit's when there are no vias to thread;
      // otherwise route start → vias → end (out-and-back: start → vias → start)
      // so the excursion leg is on the line.
      let line: [number, number][] | null = dr?.polyline ?? null;
      if (start && end && (vias.length > 0 || !line)) {
        const pts =
          vias.length > 0 ? [start, ...vias, end] : [start, end];
        try {
          line = (await routeBetween(pts)).coordinates;
        } catch {
          /* keep whatever we had */
        }
      }

      // Per-day corpus fold (same 2-point corridor query as reference/wizard)
      // + the day's resolved tier-2 places as extra tiles. Flag the LLM's
      // curated key stops: a pool-hit keyStop is an `mp:` id in day.keyStops
      // that matches a corpus tile; a live-resolved keyStop is a resolvedPlace
      // with where==="keyStop". (The overnight is carried via day.overnight,
      // not flagged here.)
      const corpus =
        start && end ? await fetchCorpusForSegment(start, end, supabase) : [];
      const keyStopIds = new Set(day.keyStops);
      const tiles: BrowsePlace[] = [
        ...corpus.map((t) =>
          keyStopIds.has(t.id) ? { ...t, curated: true } : t,
        ),
        ...resolved.map((r) => {
          const tile = resolvedToTile(r);
          return r.where === "keyStop" ? { ...tile, curated: true } : tile;
        }),
      ];

      // Position curated key stops by along-route mile so they render IN their
      // spine position (ordered, with distance-from-start) rather than a
      // detached block. Project onto the polyline directly — independent of the
      // node-bucketing below, which drops on-route picks past maxAttachMi. Keep
      // the mile only when the pick is genuinely on-corridor (offset ≤ buffer).
      if (line && line.length >= 2) {
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i];
          if (!t.curated) continue;
          const r = alongRouteMiles(t.coords, line);
          if (r && r.offsetMi <= DEFAULT_CORRIDOR_PARAMS.bufferMi) {
            tiles[i] = { ...t, milesFromStart: Math.round(r.miles) };
          }
        }
      }

      // Derive spine + bucket tiles under nodes.
      let corridorCities: CorridorCity[] | undefined;
      if (line && line.length >= 2 && start && end) {
        const spine = deriveCorridorCities({
          line,
          start: { name: day.startPlace, coords: start },
          end: { name: day.endPlace, coords: end },
          gazetteer: gazetteer as GazetteerCity[],
        });
        if (spine) {
          corridorCities = bucketPlacesIntoCorridor({
            cities: spine,
            places: tiles.map((t) => ({ id: t.id, coords: t.coords })),
            line,
          });
        }
      }

      return { n: day.n, corridorCities, segmentSuggestions: tiles };
    }),
  );
}
