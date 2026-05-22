/**
 * Phase drift detection + display-state derivation.
 *
 * The IDB record stores the *literal* prime state (status + counters).
 * "Stale" is computed, not stored: at render time we compare the current
 * phase geometry hash to the hash captured at prime success, and flag
 * stale if they diverge. Same idea for the Mapbox tileset version —
 * a streets-v8 → streets-v9 bump should invalidate downloaded tiles
 * even though the polyline didn't change.
 *
 * Surfaced via `getPhaseDisplayStatus()`, which is the single function
 * the offline panel renders against.
 */
import {
  computePhaseGeometry,
  hashPhasePolyline,
} from "./offline-phase-geometry";
import type { PhaseStatus } from "./prime-status-db";
import type { OfflinePhase, Trip } from "@/lib/trips/types";

/** Tileset version currently in use. Matches the suffix on phase cache
 *  names (`mb-phase-<id>-streetsv8`). Bumped when Mapbox releases a
 *  streets-v9 or we switch to a different vector source. */
export const CURRENT_TILESET_VERSION = "streetsv8";

export type PhaseDisplayStatus =
  | { kind: "not-primed" }
  | { kind: "priming"; tilesPrimed: number; tilesTotal: number }
  | { kind: "ready"; primedAt: string }
  | {
      kind: "partial";
      tilesPrimed: number;
      tilesTotal: number;
      lastError: string | null;
    }
  | {
      kind: "stale";
      reason: "polyline" | "tileset";
      primedAt: string | null;
      tilesPrimed: number;
      tilesTotal: number;
    }
  | { kind: "error"; message: string };

/** Convenience: current geometry hash for a phase. Returns null when
 *  the trip is too sparse for the phase to have any geometry. */
export function computeCurrentPolylineHash(
  phase: OfflinePhase,
  trip: Trip,
): string | null {
  const { coords } = computePhaseGeometry(phase, trip);
  if (coords.length === 0) return null;
  return hashPhasePolyline(coords);
}

/** Single source of truth for "what should the phase row show right
 *  now?" — combines the IDB record with live drift checks against the
 *  current trip + tileset version.
 *
 *  `tilesetVersionNow` defaults to `CURRENT_TILESET_VERSION` and is
 *  parameterized only for tests. */
export function getPhaseDisplayStatus(
  phase: OfflinePhase,
  trip: Trip,
  record: PhaseStatus | null,
  tilesetVersionNow: string = CURRENT_TILESET_VERSION,
): PhaseDisplayStatus {
  if (!record) return { kind: "not-primed" };

  if (record.status === "priming") {
    return {
      kind: "priming",
      tilesPrimed: record.tilesPrimed,
      tilesTotal: record.tilesTotal,
    };
  }

  if (record.status === "error") {
    return { kind: "error", message: record.lastError ?? "Prime failed" };
  }

  // ready + partial both get drift-checked. If geometry or tileset has
  // moved on since the prime, the row surfaces as stale regardless of
  // whether the prime had completed — the cached tiles are wrong either
  // way and the user should know.
  if (record.status === "ready" || record.status === "partial") {
    if (record.tilesetVersion !== tilesetVersionNow) {
      return {
        kind: "stale",
        reason: "tileset",
        primedAt: record.primedAt,
        tilesPrimed: record.tilesPrimed,
        tilesTotal: record.tilesTotal,
      };
    }
    const currentHash = computeCurrentPolylineHash(phase, trip);
    if (
      currentHash &&
      record.primedPolylineHash &&
      currentHash !== record.primedPolylineHash
    ) {
      return {
        kind: "stale",
        reason: "polyline",
        primedAt: record.primedAt,
        tilesPrimed: record.tilesPrimed,
        tilesTotal: record.tilesTotal,
      };
    }
    if (record.status === "partial") {
      return {
        kind: "partial",
        tilesPrimed: record.tilesPrimed,
        tilesTotal: record.tilesTotal,
        lastError: record.lastError,
      };
    }
    return {
      kind: "ready",
      primedAt: record.primedAt ?? "",
    };
  }

  // "not-primed" record (e.g. left over from a setup → delete cycle).
  return { kind: "not-primed" };
}
