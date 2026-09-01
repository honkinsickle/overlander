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
import { DEFAULT_CORRIDOR_PARAMS } from "@/lib/corridor/derive";
import { deriveDayCorridor } from "@/lib/corridor/day-corridor";
import { bucketPlacesIntoCorridor } from "@/lib/corridor/bucket";
import { alongRouteMiles, haversineMi } from "@/lib/routing/point-to-polyline";
import { fetchCorpusForSegment } from "@/lib/trips/bake-corridors";
import { primaryCategoryToSlideKey } from "@/lib/trip-browse/federated";
import { stripNodeIdentical } from "@/lib/corridor/node-identity";
import type { CorridorCity } from "@/lib/trips/types";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import type { GenerationInput } from "./facts";
import type { ItineraryOutput, ResolvedPlace } from "./schema";
import type { DayRoute, GroundOutcome } from "./audit";

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

/**
 * The canonical id of the tile that IS a grounded overnight, or null.
 *
 * IDENTITY, not a name substring: a pool-hit overnight's tile carries the
 * corpus id the pool POI already has (the same id `fetchCorpusForSegment`
 * emits and the keyStop pool-hit path keys on); a live-resolved overnight's
 * tile is `resolvedToTile`'s `google:<placeId>`. A dropped/desc-only overnight
 * has no tile — return null and let the prose fallback stand.
 */
export function overnightTileRef(outcome: GroundOutcome): string | null {
  if (outcome.kind === "pool-hit") return outcome.poi.id;
  if (outcome.kind === "resolved") return `google:${outcome.place.placeId}`;
  return null;
}

/**
 * Flag the one tile that IS the day's overnight (matched by id from
 * `overnightTileRef`) so it is the single source of truth for the overnight:
 * `isOvernight` badges it, `curated` features it on the spine rather than
 * demoting it in the pool, and its note becomes the tile's status line.
 *
 * Pure. When `ref` is null (desc-only / dropped) or matches no tile (the
 * overnight is off this day's corridor), nothing is marked — the caller keeps
 * the prose "Overnight —" line as the fallback, same posture as #275.
 */
/** ~805 m — inside Adam's 500 m–1 km window. A CHOSEN constant (flagged): loose
 *  enough for corpus-vs-Google coord drift on the same place, tight enough to
 *  mean "clearly the same physical location", not "same general area". */
export const FUZZY_OVERNIGHT_RADIUS_MI = 0.5;

function overnightNameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** STRICT fuzzy name match: every token of the SHORTER name is present in the
 *  longer one, and the shorter name has ≥2 tokens (a lone generic word like
 *  "Convict" or "Lake" is never enough). "Convict Lake" ≈ "Convict Lake
 *  Campground" ✓; "Convict Lake Campground" vs "Convict Creek Trailhead" ✗. Err
 *  strict — a false positive would mislabel where the traveller sleeps. */
export function fuzzyOvernightNameMatch(a: string, b: string): boolean {
  const ta = overnightNameTokens(a);
  const tb = overnightNameTokens(b);
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.length < 2) return false;
  const longSet = new Set(long);
  return short.every((t) => longSet.has(t));
}

export function markOvernightTile(
  tiles: BrowsePlace[],
  ref: string | null,
  note: string,
  googleId?: string | null,
  fuzzy?: { name: string; coords: [number, number] } | null,
): BrowsePlace[] {
  if (!ref) return tiles;
  // Tier 1 (#279) exact id + Tier 2 (#284) google_place_id bridge: a pool-hit
  // overnight's `mp:` ref, or — when no exact-ref tile exists — the pool POI's
  // google_place_id matching a `google:<gid>` / `placeId` tile for the same
  // place. Never double-marks a present tile.
  const hasExact = tiles.some((t) => t.id === ref);
  const gid = !hasExact && googleId ? googleId : null;
  const idMatch = (t: BrowsePlace) =>
    t.id === ref || (gid != null && (t.id === `google:${gid}` || t.placeId === gid));

  // Tier 3 (#285) — fuzzy name + proximity — runs ONLY when NO id-based tile
  // matched, so tiers 1 and 2 always win a conflict. BOTH the strict name bar
  // AND the tight radius must clear; pick the single CLOSEST qualifying tile.
  // Never a best-guess: nothing clears → nothing marked (prose fallback, exactly
  // like today). Compares against the day's own tiles only — no corpus search.
  // Does NOT address the no-tile gap (Convict Lake / layover): if the place has
  // no tile at all, there is no candidate here and it stays unmarked.
  let fuzzyId: string | null = null;
  if (fuzzy?.name && fuzzy.coords && !tiles.some(idMatch)) {
    const cands = tiles
      .filter(
        (t) =>
          !!t.title &&
          haversineMi(t.coords, fuzzy.coords) <= FUZZY_OVERNIGHT_RADIUS_MI &&
          fuzzyOvernightNameMatch(fuzzy.name, t.title),
      )
      .sort(
        (a, b) => haversineMi(a.coords, fuzzy.coords) - haversineMi(b.coords, fuzzy.coords),
      );
    fuzzyId = cands[0]?.id ?? null;
  }

  return tiles.map((t) =>
    idMatch(t) || (fuzzyId != null && t.id === fuzzyId)
      ? { ...t, isOvernight: true, curated: true, keyStopNote: t.keyStopNote ?? note }
      : t,
  );
}

/** A resolved tier-2 place as a browsable tile (real place_id → hydratable).
 *
 *  `category` maps Google's inferred corpus category (`rp.category`, set by
 *  `inferCategory(primaryType)` in resolve.ts) through the same slide-bucket
 *  taxonomy the corpus mapper uses (`primaryCategoryToSlideKey`). Without
 *  this, every google-resolved tile shipped with `category: undefined` and
 *  fell back to the generic "interest" diamond icon on day-detail cards
 *  (measured 2026-08-31: 352/352 google-resolved tiles across all TEST
 *  baked trips had `category: undefined`). Unknown/null Google types still
 *  land on "interest", so this can only match-or-improve, never regress. */
export function resolvedToTile(rp: ResolvedPlace): BrowsePlace {
  return {
    id: `google:${rp.placeId}`,
    coords: rp.coords,
    title: rp.displayName,
    category: primaryCategoryToSlideKey(rp.category ?? "unknown"),
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
        // Same per-day derivation the backfill audit uses (shared helper), so
        // the rendered spine and the audit's anchor set can't drift apart.
        const spine = deriveDayCorridor(
          line,
          { name: day.startPlace, coords: start },
          { name: day.endPlace, coords: end },
        );
        if (spine.length) {
          cardTiles = stripNodeIdentical(tiles, spine);
          corridorCities = bucketPlacesIntoCorridor({
            cities: spine,
            places: cardTiles.map((t) => ({ id: t.id, coords: t.coords })),
            line,
          });
        }
      }

      // Link the grounded overnight to its own tile by canonical id (identity,
      // not a name match), so the one tile is the single source of truth — the
      // spine badges it, the briefing derives from it, and `to-trip` drops the
      // redundant "Overnight —" note. No-op when the overnight is desc-only /
      // off this day's corridor (ref null or matches no tile).
      const overnightNote =
        day.overnight.rationale || day.overnight.name || "overnight";
      const overnightName = day.audit?.overnightName ?? null;
      const overnightCoords = day.audit?.overnightCoords ?? null;
      const marked = markOvernightTile(
        cardTiles,
        day.audit?.overnightRef ?? null,
        overnightNote,
        day.audit?.overnightGoogleId ?? null,
        overnightName && overnightCoords
          ? { name: overnightName, coords: overnightCoords }
          : null,
      );

      return { n: day.n, corridorCities, segmentSuggestions: marked };
    }),
  );
}
