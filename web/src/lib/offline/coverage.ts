/**
 * Viewport-vs-phase coverage math.
 *
 * Detection in session 4 is viewport-based, not request-based — when
 * the map idles, we ask "is the visible bbox at the current zoom
 * inside the union of tiles for some primed phase?" If yes, no banner.
 * If no, banner ("This area isn't downloaded").
 *
 * Phase tile sets memoize in module scope. Key includes `maxZoom` and
 * `primedPolylineHash` so a re-prime (drift → new hash) auto-
 * invalidates the cached set on next access.
 *
 * Helpers (lngToTileX, latToTileY) are intentionally duplicated from
 * offline-phase-geometry.ts rather than exported across module
 * boundaries — they're three-line Web Mercator conversions and the
 * separation keeps coverage standalone.
 */
import {
  computePhaseGeometry,
  enumerateTiles,
} from "./offline-phase-geometry";
import type { PhaseStatus } from "./prime-status-db";
import type { OfflinePhase, Trip } from "@/lib/trips/types";

type Bbox = [number, number, number, number]; // [west, south, east, north]

const MERC_LAT_MAX = 85.0511287798066;

export type CoverageStatus = "covered" | "uncovered" | "no-phases";

export type CoverageResult = {
  phase: OfflinePhase | null;
  status: CoverageStatus;
};

const phaseTileSetCache = new Map<string, Set<string>>();

/**
 * Does the given viewport at zoom z fit entirely inside this phase's
 * enumerated tile set? Returns false on partial coverage — partial is
 * not "covered" from the user's perspective.
 *
 * Above `phase.maxZoom`, returns false. The map's native overscaling
 * still renders content from cached lower-zoom tiles, but the viewport
 * isn't actually downloaded at the requested zoom; banner-as-warning
 * here is intentional. Refine later if it proves noisy.
 *
 * Antimeridian-crossing bboxes (west > east in lng) return false —
 * accepted simplification; the corridor we ship for is North America.
 */
export function viewportCoveredBy(
  bbox: Bbox,
  zoom: number,
  phase: OfflinePhase,
  trip: Trip,
): boolean {
  const z = Math.floor(zoom);
  if (z > phase.maxZoom) return false;
  if (z < 0) return false;
  if (bbox[0] > bbox[2]) return false; // antimeridian skip

  const viewportTiles = bboxToTilesAtZoom(bbox, z);
  if (viewportTiles.length === 0) return false;

  const phaseSet = getPhaseTileSet(phase, trip);
  // All viewport tiles must be in the phase set; one miss = uncovered.
  for (const key of viewportTiles) {
    if (!phaseSet.has(key)) return false;
  }
  return true;
}

/**
 * Find the phase whose geometry covers this viewport AND is prime-ready
 * on this device. Returns the chosen phase or a status signaling why
 * none applied:
 *  - "no-phases"   → trip has no offlinePhases at all
 *  - "uncovered"   → at least one phase exists, but none cover the
 *                    viewport (either geometry doesn't reach, or the
 *                    one that does isn't primed)
 *  - "covered"     → a primed phase covers the viewport (phase != null)
 *
 * Iteration order: trip.offlinePhases as-is. If multiple cached phases
 * could cover the viewport, the first one wins.
 */
export function findCoveringPhase(
  bbox: Bbox,
  zoom: number,
  trip: Trip,
  primeStatuses: Map<string, PhaseStatus>,
): CoverageResult {
  const phases = trip.offlinePhases ?? [];
  if (phases.length === 0) return { phase: null, status: "no-phases" };

  for (const phase of phases) {
    const status = primeStatuses.get(phase.id);
    // Only "ready" and "partial" phases serve tiles. "priming" is in
    // flight and may not be safe to claim coverage from yet. "error"
    // and missing → treat as uncached.
    if (!status || (status.status !== "ready" && status.status !== "partial")) {
      continue;
    }
    if (viewportCoveredBy(bbox, zoom, phase, trip)) {
      return { phase, status: "covered" };
    }
  }
  return { phase: null, status: "uncovered" };
}

/**
 * For the "Prime Week N" CTA — given an uncovered viewport, return the
 * phase whose geometry geographically covers it (regardless of prime
 * status). If no phase's geometry reaches, return null and the banner
 * falls back to a generic "Set up offline" CTA.
 *
 * If multiple phases cover, returns the first in trip order.
 */
export function suggestPhaseForViewport(
  bbox: Bbox,
  zoom: number,
  trip: Trip,
): OfflinePhase | null {
  const phases = trip.offlinePhases ?? [];
  for (const phase of phases) {
    if (viewportCoveredBy(bbox, zoom, phase, trip)) return phase;
  }
  return null;
}

// ---------------------------------------------------------------- internals

function getPhaseTileSet(phase: OfflinePhase, trip: Trip): Set<string> {
  // Cache key includes primedPolylineHash so a re-prime that changes
  // the hash auto-invalidates the cached set on next access. Phases
  // that have never been primed (hash=null) get keyed on a literal
  // "none" sentinel — fine because the geometry inputs are the same
  // whether primed or not; this just avoids `${...}:null` ambiguity.
  const hashKey = phase.primedPolylineHash ?? "none";
  const key = `${phase.id}:${phase.maxZoom}:${hashKey}`;
  let s = phaseTileSetCache.get(key);
  if (!s) {
    const { coords } = computePhaseGeometry(phase, trip);
    const tiles = enumerateTiles(coords, phase.bufferMi, 6, phase.maxZoom);
    s = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    phaseTileSetCache.set(key, s);
  }
  return s;
}

function bboxToTilesAtZoom(bbox: Bbox, z: number): string[] {
  const [w, s, e, n] = bbox;
  const nClamped = clampMerc(n);
  const sClamped = clampMerc(s);
  // Tile x increases eastward, y increases southward — so north→ymin,
  // south→ymax.
  const xMin = lngToTileX(w, z);
  const xMax = lngToTileX(e, z);
  const yMin = latToTileY(nClamped, z);
  const yMax = latToTileY(sClamped, z);
  const out: string[] = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      out.push(`${z}/${x}/${y}`);
    }
  }
  return out;
}

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      (1 << z),
  );
}

function clampMerc(lat: number): number {
  if (lat > MERC_LAT_MAX) return MERC_LAT_MAX;
  if (lat < -MERC_LAT_MAX) return -MERC_LAT_MAX;
  return lat;
}

/** Test-only hook: drop the memoized phase tile-sets so a sanity
 *  script can start clean. */
export function __resetCoverageCacheForTests(): void {
  phaseTileSetCache.clear();
}
