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
import gazetteer from "@/lib/corridor/data/gazetteer";
import { stripNodeIdentical } from "@/lib/corridor/node-identity";
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
      // Post-audit each keyStop's `name` holds the resolved ref (corpus id on a
      // pool-hit, the place name on a live-resolve); `note` is the inline
      // context. Key the note by that ref so it reaches the matching tile.
      const noteByRef = new Map(day.keyStops.map((k) => [k.name, k.note]));
      const tiles: BrowsePlace[] = [
        ...corpus.map((t) =>
          noteByRef.has(t.id)
            ? { ...t, curated: true, keyStopNote: noteByRef.get(t.id) }
            : t,
        ),
        ...resolved.map((r) => {
          const tile = resolvedToTile(r);
          return r.where === "keyStop"
            ? { ...tile, curated: true, keyStopNote: noteByRef.get(r.name) }
            : tile;
        }),
      ];

      // Position EVERY tile by along-route mile so on-corridor POIs render IN
      // their spine position (ordered, with day-relative distance-from-start) —
      // not just curated key stops. `line` is the day's own polyline, so
      // `r.miles` is already day-relative. Project directly — independent of the
      // node-bucketing below, which drops on-route picks past maxAttachMi. Keep
      // the mile only when the pick is genuinely on-corridor (offset ≤ buffer);
      // off-corridor tiles stay mile-less per the BrowsePlace contract (absent
      // milesFromStart ⇒ off-corridor). This is what makes the READ view show a
      // real distance for a plain corpus stop, not only a curated one.
      if (line && line.length >= 2) {
        for (let i = 0; i < tiles.length; i++) {
          const t = tiles[i];
          const r = alongRouteMiles(t.coords, line);
          if (r && r.offsetMi <= DEFAULT_CORRIDOR_PARAMS.bufferMi) {
            tiles[i] = { ...t, milesFromStart: Math.round(r.miles) };
          }
        }
      }

      // Derive spine + bucket tiles under nodes.
      let corridorCities: CorridorCity[] | undefined;
      // Node/card dedup (corridor/node-identity): a tile that IS a node isn't a
      // card. Strip before bucketing AND from the returned segmentSuggestions,
      // so the persisted payload never carries a place as both.
      let cardTiles = tiles;
      if (line && line.length >= 2 && start && end) {
        const spine = deriveCorridorCities({
          line,
          start: { name: day.startPlace, coords: start },
          end: { name: day.endPlace, coords: end },
          gazetteer: gazetteer as GazetteerCity[],
        });
        if (spine) {
          cardTiles = stripNodeIdentical(tiles, spine);
          corridorCities = bucketPlacesIntoCorridor({
            cities: spine,
            places: cardTiles.map((t) => ({ id: t.id, coords: t.coords })),
            line,
          });
        }
      }

      return { n: day.n, corridorCities, segmentSuggestions: cardTiles };
    }),
  );
}
