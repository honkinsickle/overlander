/**
 * Corridor city-node derivation — the §2.1.2 six-step filter from
 * docs/corridor-cities-spec.md. Turns a day's route polyline + the
 * bundled GeoNames gazetteer into the ordered corridorCities[] spine
 * (Start → intermediates → End).
 *
 * Pure function: no I/O. The caller loads the gazetteer
 * (src/lib/corridor/data/cities-na.json) and supplies the day's
 * polyline slice. All geometry goes through the shared
 * alongRouteMiles() helper (spec §2.4) — no projection math here.
 *
 * Interpretation notes against the spec:
 * - min_spacing_mi applies BETWEEN INTERMEDIATES only. Applied against
 *   Start/End it would forbid the spec's own mission example (Ventura at
 *   65 mi sits 30 mi from the 95-mi end node).
 * - The §2.1 step-3 "< 3 mi" tolerance is the anchor guard: gazetteer
 *   candidates projecting within 3 route-miles of Start/End are dropped
 *   so the start/end city can't reappear as a corridor node.
 * - placeIds is always [] here — place→node bucketing is §2.3 and comes
 *   with the finalize wiring, not this filter.
 */
import { alongRouteMiles } from "@/lib/routing/point-to-polyline";
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
  bufferMi: number;
  popFloor: number;
  minSpacingMi: number;
  maxNodes: number;
  maxGapMi: number;
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
  popFloor: 10_000,
  minSpacingMi: 50,
  maxNodes: 4,
  maxGapMi: 150,
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
    if (!r || r.offsetMi > p.bufferMi) continue;
    if (r.miles < p.anchorGuardMi || r.miles > endMi - p.anchorGuardMi) continue;
    candidates.push({ city, mi: r.miles });
  }

  // Steps 3–5: population floor (soft) + spacing + top-N. Greedy by
  // PROMINENCE — administrative tier first (a county seat outranks a
  // bigger raw-population neighborhood; tuned choice, spec §2.1.2),
  // population within a tier, then deterministic tiebreaks. Spacing is
  // enforced between intermediates only. Used by the top-N pass, the
  // spacing cluster winner, and the adaptive gap-fill below.
  const byProminence = (a: Candidate, b: Candidate) =>
    b.city.tier - a.city.tier ||
    b.city.pop - a.city.pop ||
    a.mi - b.mi ||
    a.city.name.localeCompare(b.city.name);

  const selected: Candidate[] = [];
  const preferred = candidates
    .filter((c) => c.city.pop >= p.popFloor)
    .sort(byProminence);
  for (const c of preferred) {
    if (selected.length >= p.maxNodes) break;
    if (selected.every((s) => Math.abs(s.mi - c.mi) >= p.minSpacingMi)) {
      selected.push(c);
    }
  }

  // Step 6: adaptive fallback. Any along-route gap > maxGapMi gets the
  // most prominent unselected candidate inside it, floor relaxed.
  // Precedence (spec §2.1.2): the gap guarantee WINS over maxNodes.
  // Best-effort: a gap with no candidates at all stays open.
  //
  // One-fill-per-gap rule (spec §2.1.2, 2026-07-06): spacing-valid fills
  // always shrink a gap meaningfully and may recurse (successive spaced
  // fills legitimately cure a long gap). An UNSPACED fallback fill is a
  // one-shot: any still-oversized sub-gap it leaves is accepted open —
  // without this, the fallback walks candidate clusters node by node
  // (five Anchorage suburbs in 43 mi) while never curing the real gap.
  const inGap = (c: Candidate, a: number, b: number) => c.mi > a && c.mi < b;
  const acceptedOpen = new Set<string>();
  const gapKey = (a: number, b: number) => `${a}:${b}`;
  for (;;) {
    const anchors = [0, ...selected.map((s) => s.mi), endMi].sort((x, y) => x - y);
    let fill: Candidate | undefined;
    let fillWasUnspaced = false;
    let gapA = 0;
    let gapB = 0;
    for (let i = 1; i < anchors.length && !fill; i++) {
      const [a, b] = [anchors[i - 1], anchors[i]];
      if (b - a <= p.maxGapMi) continue;
      if (acceptedOpen.has(gapKey(a, b))) continue;
      const unselected = candidates.filter(
        (c) => !selected.includes(c) && inGap(c, a, b),
      );
      // Prefer a spacing-valid position within the gap; fall back to any
      // interior candidate (the gap guarantee outranks spacing too).
      const spaced = unselected.filter(
        (c) => c.mi >= a + p.minSpacingMi && c.mi <= b - p.minSpacingMi,
      );
      fill = (spaced.length ? spaced : unselected).sort(byProminence)[0];
      if (fill) {
        fillWasUnspaced = spaced.length === 0;
        gapA = a;
        gapB = b;
      }
    }
    if (!fill) break;
    selected.push(fill);
    if (fillWasUnspaced) {
      if (fill.mi - gapA > p.maxGapMi) acceptedOpen.add(gapKey(gapA, fill.mi));
      if (gapB - fill.mi > p.maxGapMi) acceptedOpen.add(gapKey(fill.mi, gapB));
    }
  }

  selected.sort((a, b) => a.mi - b.mi);

  // Force-include user-authored seeds (spec § node-stack). A seed bypasses
  // popFloor / spacing / maxNodes — a user pin outranks every tuning gate —
  // and keeps its durable id. Seeds within anchorGuardMi of Start/End are
  // dropped as redundant with the endpoint node. A gazetteer pick within
  // minSpacingMi of a seed is dropped (the seed wins), holding the
  // "nodes ≥ minSpacing apart" invariant with user intent dominant. When no
  // seeds are supplied this reduces to the prior gazetteer-only spine.
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
          (sn) => Math.abs(sn.milesFromStart - c.mi) < p.minSpacingMi,
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
