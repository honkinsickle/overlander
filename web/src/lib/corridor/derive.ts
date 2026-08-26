/**
 * Corridor city-node derivation. Turns a day's route polyline + the bundled
 * GeoNames gazetteer into the ordered corridorCities[] spine (Start →
 * intermediates → End).
 *
 * ⚠ REDESIGNED 2026-08-26 (ADR docs/decisions/2026-08-26-corridor-city-strict-
 * proximity.md). The old §2.1.2 model — a 15mi buffer pre-filter followed by
 * greedy-by-prominence selection with a 50mi minimum spacing and an adaptive
 * gap-fill — is REPLACED by a strict proximity rule: a city is a corridor node
 * iff its straight-line offset from the polyline is ≤ `corridorMi` (3mi) and it
 * meets the population floor. No prominence ranking, no spacing suppression, no
 * gap-fill fallback. The spacing model let one prominent city suppress
 * genuinely-on-route neighbours (SF hid Concord/Fairfield/Vacaville; Sacramento
 * hid Davis); removing it is the whole point. A day may have zero corridor
 * cities — that is valid and deliberate, not padded.
 *
 * Pure function: no I/O. The caller loads the gazetteer
 * (src/lib/corridor/data/cities-na.json) and supplies the day's polyline slice.
 * All geometry goes through the shared alongRouteMiles() helper — no projection
 * math here.
 *
 * Notes:
 * - `corridorMi` (3mi, city inclusion) is DISTINCT from `bufferMi` (15mi), the
 *   shared on-corridor tolerance bucket.ts / bake.ts / stretches.ts / seeds.ts
 *   still use for place-bucketing and tile-labelling — those are untouched.
 * - `anchorGuardMi` still drops candidates within a few route-miles of
 *   Start/End so the start/end city can't reappear as a corridor node.
 * - placeIds is always [] here — place→node bucketing is separate (bucket.ts).
 */
import { alongRouteMiles, haversineMi } from "@/lib/routing/point-to-polyline";
import type { LngLat } from "@/lib/routing/route-between";
import type { CorridorCity } from "@/lib/trips/types";

/** Canonical definition lives in the payload contract (spec §1.1);
 *  re-exported here for corridor-domain consumers. */
export type { CorridorCity } from "@/lib/trips/types";

/** One row of the bundled gazetteer (cities-na.json). */
export type GazetteerCity = {
  name: string;
  /** Postal state/province abbreviation ("CA", "YT"). */
  admin: string;
  lat: number;
  lng: number;
  pop: number;
  /** Administrative-significance tier precomputed from the GeoNames
   *  feature code at gazetteer build time (scripts/build-cities-na.ts):
   *  5 national capital · 4 admin1 seat · 3 county/borough seat ·
   *  2 generic populated place · 1 city section/locality. */
  tier: number;
};

/** Tunables per spec §2.1.3 — all soft defaults, to be tuned on real routes. */
export type CorridorParams = {
  /** SHARED "on-corridor" tolerance, used by `bucket.ts` (place→node),
   *  `bake.ts` (tile mile-labelling), `stretches.ts`, and `seeds.ts` — NOT the
   *  corridor-city inclusion gate (that is `corridorMi`). Left at 15 so those
   *  consumers are untouched by the 2026-08-26 corridor-city redesign. */
  bufferMi: number;
  /** Corridor-CITY inclusion radius. A gazetteer city is a corridor node iff
   *  its straight-line offset from the day's polyline is ≤ this. This IS the
   *  inclusion rule (redesign 2026-08-26): no prominence ranking, no spacing
   *  suppression. Distinct from `bufferMi` so the tighter city rule does not
   *  bleed into place-bucketing / tile-labelling. */
  corridorMi: number;
  popFloor: number;
  maxNodes: number;
  /** Two gazetteer rows essentially co-located (within this many miles, both
   *  along-route and straight-line) collapse to the more prominent one — a
   *  minimal same-point de-dup (e.g. two rows at one highway exit). This is
   *  NOT the removed 50mi suppression; it only merges near-identical points,
   *  never distinct nearby cities. */
  dedupMi: number;
  /** Candidates projecting within this many route-miles of the Start/End
   *  anchors are dropped — de-dupe tolerance (spec §2.1 step 3) plus
   *  metro-neighborhood suppression (a node too close to the start city
   *  reads as a suburb of it, not a distinct corridor stop). Applied
   *  symmetrically to both ends. */
  anchorGuardMi: number;
  /** Place→node bucketing (spec §2.3, used by bucket.ts, not the spine
   *  filter): a place attaches only if within this many along-route miles
   *  of its nearest node; farther places stay unbucketed. Tuned
   *  2026-07-06 on real routes (spec §2.1.3): 15 orphans legit places,
   *  40 is byte-identical to 25. */
  maxAttachMi: number;
};

export const DEFAULT_CORRIDOR_PARAMS: CorridorParams = {
  bufferMi: 15,
  corridorMi: 3,
  popFloor: 10_000,
  // Pathology backstop, NOT a design limiter — raised from 4 in the 2026-08-26
  // redesign. Strict 3mi inclusion legitimately surfaces many real cities on a
  // dense day (measured 29 on a San Jose→Reno day), and a low cap would
  // silently truncate the exact cities this redesign exists to surface (Davis
  // was ~18th along that route). 40 sits well above the densest measured real
  // corridor; when it bites, truncation is by ALONG-ROUTE order (never
  // prominence), so it cannot reintroduce the suppression bias.
  maxNodes: 40,
  dedupMi: 0.5,
  anchorGuardMi: 10,
  maxAttachMi: 25,
};

type Candidate = { city: GazetteerCity; mi: number };

/** A NodeSeed already resolved to THIS day's line — its along-route position
 *  precomputed by resolveSeeds (src/lib/corridor/seeds.ts), so derive only
 *  splices it into the spine and never re-projects. Keeping the projection in
 *  one place means the resolver's reported mile and the emitted node's mile
 *  can't drift. */
export type PositionedSeed = {
  id: string;
  name: string;
  coords: LngLat;
  milesFromStart: number;
};

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Derive the ordered corridor city nodes for one day.
 *  Returns null when the polyline is unusable (< 2 points) — callers
 *  fall back to the degraded two-node corridor (spec §4). */
export function deriveCorridorCities(input: {
  line: LngLat[];
  start: { name: string; coords: LngLat };
  end: { name: string; coords: LngLat };
  gazetteer: GazetteerCity[];
  /** User-authored node seeds resolved to THIS day (spec § node-stack).
   *  Force-included in the spine, bypassing the gazetteer selection gates. */
  seeds?: PositionedSeed[];
  params?: Partial<CorridorParams>;
}): CorridorCity[] | null {
  const { line, start, end, gazetteer } = input;
  const p = { ...DEFAULT_CORRIDOR_PARAMS, ...input.params };

  if (line.length < 2) return null;
  const endProj = alongRouteMiles(end.coords, line);
  if (!endProj) return null;
  const endMi = endProj.miles;

  // Cheap bbox prefilter so the full 8.8k-row gazetteer isn't projected
  // against every polyline (matters for §3.1 recompute-on-edit). Pad by
  // bufferMi in degrees; lng pad widens with latitude. North-America
  // data — no antimeridian handling needed.
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of line) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const MI_PER_DEG_LAT = 69.093;
  const latPad = p.bufferMi / MI_PER_DEG_LAT;
  const maxAbsLat = Math.max(Math.abs(minLat), Math.abs(maxLat)) + latPad;
  const cosLat = Math.max(Math.cos((maxAbsLat * Math.PI) / 180), 0.2);
  const lngPad = p.bufferMi / (MI_PER_DEG_LAT * cosLat);

  // Step 1 (buffer) + step 2 (along-route order via the shared helper).
  const candidates: Candidate[] = [];
  for (const city of gazetteer) {
    if (
      city.lng < minLng - lngPad ||
      city.lng > maxLng + lngPad ||
      city.lat < minLat - latPad ||
      city.lat > maxLat + latPad
    ) {
      continue;
    }
    const r = alongRouteMiles([city.lng, city.lat], line);
    if (!r || r.offsetMi > p.corridorMi) continue;
    if (r.miles < p.anchorGuardMi || r.miles > endMi - p.anchorGuardMi) continue;
    candidates.push({ city, mi: r.miles });
  }

  // STRICT PROXIMITY inclusion (redesign 2026-08-26 — ADR
  // 2026-08-26-corridor-city-strict-proximity). A city is a corridor node iff
  // it cleared the `corridorMi` (3mi) gate above and meets the population
  // floor — full stop. NO prominence ranking and NO minSpacing suppression:
  // the old "greedy-by-prominence + 50mi spacing" model let one dominant city
  // suppress its whole neighbourhood (San Francisco hid Concord/Fairfield/
  // Vacaville; Sacramento hid Davis), dropping cities that were genuinely on
  // the driven route. That model is removed entirely. Order by along-route
  // mile; a day with zero qualifying cities is a valid, empty spine (no
  // reach-further fallback, by design).
  //
  // `byProminence` survives ONLY as a tiebreak: for co-located duplicates in
  // the de-dup below, and to make truncation deterministic. It never decides
  // inclusion.
  const byProminence = (a: Candidate, b: Candidate) =>
    b.city.tier - a.city.tier ||
    b.city.pop - a.city.pop ||
    a.mi - b.mi ||
    a.city.name.localeCompare(b.city.name);

  const ordered = candidates
    .filter((c) => c.city.pop >= p.popFloor)
    .sort((a, b) => a.mi - b.mi || byProminence(a, b));

  // Minimal same-point de-dup: two rows essentially co-located (within
  // `dedupMi` both along-route AND straight-line) collapse to the more
  // prominent one. This is NOT the removed 50mi suppression — it only merges
  // near-identical points (two gazetteer rows at one highway exit), never
  // distinct nearby cities.
  const deduped: Candidate[] = [];
  for (const c of ordered) {
    const dupIdx = deduped.findIndex(
      (d) =>
        Math.abs(d.mi - c.mi) < p.dedupMi &&
        haversineMi([d.city.lng, d.city.lat], [c.city.lng, c.city.lat]) <
          p.dedupMi,
    );
    if (dupIdx >= 0) {
      if (byProminence(c, deduped[dupIdx]) < 0) deduped[dupIdx] = c;
      continue;
    }
    deduped.push(c);
  }

  // maxNodes is a pathology backstop only (see the constant). It never bites a
  // real corridor; when it would, it truncates by ALONG-ROUTE order (the array
  // is already mile-sorted) — never by prominence — so it cannot reintroduce
  // the suppression bias.
  const selected = deduped.slice(0, p.maxNodes);

  // Force-include user-authored seeds (spec § node-stack). A seed bypasses
  // popFloor / maxNodes — a user pin outranks every tuning gate — and keeps its
  // durable id. Seeds within anchorGuardMi of Start/End are dropped as
  // redundant with the endpoint node. A gazetteer pick essentially co-located
  // with a seed (within `dedupMi`) is dropped (the seed wins) — the same
  // tight same-point de-dup used above, NOT the removed 50mi suppression, so a
  // seed never hides a distinct nearby city. When no seeds are supplied this
  // reduces to the plain gazetteer spine.
  const seedNodes: CorridorCity[] = (input.seeds ?? [])
    .filter(
      (s) =>
        s.milesFromStart > p.anchorGuardMi &&
        s.milesFromStart < endMi - p.anchorGuardMi,
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      kind: "corridor" as const,
      coords: s.coords,
      milesFromStart: s.milesFromStart,
      placeIds: [],
    }));

  const gazNodes: CorridorCity[] = selected
    .filter(
      (c) =>
        !seedNodes.some(
          (sn) => Math.abs(sn.milesFromStart - c.mi) < p.dedupMi,
        ),
    )
    .map((c) => ({
      id: slugify(`${c.city.name} ${c.city.admin}`),
      name: `${c.city.name}, ${c.city.admin}`,
      kind: "corridor" as const,
      coords: [c.city.lng, c.city.lat] as LngLat,
      milesFromStart: c.mi,
      placeIds: [],
    }));

  const mid = [...gazNodes, ...seedNodes].sort(
    (a, b) => a.milesFromStart - b.milesFromStart,
  );

  return [
    {
      id: slugify(start.name),
      name: start.name,
      kind: "start",
      coords: start.coords,
      milesFromStart: 0,
      placeIds: [],
    },
    ...mid,
    {
      id: slugify(end.name),
      name: end.name,
      kind: "end",
      coords: end.coords,
      milesFromStart: endMi,
      placeIds: [],
    },
  ];
}
