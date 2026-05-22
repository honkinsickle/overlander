"use client";

/**
 * useViewportCoverage — drives the off-cache banner in MapColumn.
 *
 * Subscribes to the map's `idle` event (debounced 200ms), computes
 * whether the current viewport at the current zoom is covered by any
 * primed phase, and returns the result. Resets per-banner dismissal
 * when phases change (e.g. user primes the suggested phase, banner
 * clears and stays gone for the new state).
 *
 * Detection is viewport-based, not request-based — driving from the
 * SW's MAPBOX_FALLTHROUGH messages would flicker the banner during
 * an active prime (every uncached tile fetch fires one). The ADR
 * specifies viewport detection for this exact reason.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { listPhaseStatusesForTrip, type PhaseStatus } from "./prime-status-db";
import {
  findCoveringPhase,
  suggestPhaseForViewport,
  type CoverageStatus,
} from "./coverage";
import type { Trip } from "@/lib/trips/types";

const IDLE_DEBOUNCE_MS = 200;

export type ViewportCoverage = {
  status: CoverageStatus;
  /** Phase suggested for the "Prime Week N" CTA — only populated when
   *  status is "uncovered" AND some phase's geometry reaches the
   *  viewport. Null otherwise. */
  suggestedPhase: import("@/lib/trips/types").OfflinePhase | null;
  /** User dismissed the banner; banner suppressed until phases or
   *  trip identity change. */
  dismissed: boolean;
  dismiss: () => void;
};

export function useViewportCoverage(
  map: mapboxgl.Map | null,
  trip: Trip,
): ViewportCoverage {
  const [status, setStatus] = useState<CoverageStatus>(
    (trip.offlinePhases ?? []).length === 0 ? "no-phases" : "uncovered",
  );
  const [suggestedPhase, setSuggestedPhase] =
    useState<ViewportCoverage["suggestedPhase"]>(null);
  const [dismissed, setDismissed] = useState(false);
  const statusesRef = useRef<Map<string, PhaseStatus>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset dismissal when phase identity changes (priming a phase, adding
  // phases, etc.). Key off length + ids; the hash IDB cache invalidation
  // sits in coverage.ts and is independent.
  const phasesKey = (trip.offlinePhases ?? [])
    .map((p) => `${p.id}:${p.primedPolylineHash ?? "none"}`)
    .join(",");
  useEffect(() => {
    setDismissed(false);
  }, [phasesKey, trip.id]);

  // Reload IDB prime statuses on phase identity change. The hook owns
  // the snapshot so the coverage function doesn't have to re-hit IDB
  // on every map idle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof indexedDB === "undefined") return;
      const list = await listPhaseStatusesForTrip(trip.id);
      if (cancelled) return;
      statusesRef.current = new Map(list.map((r) => [r.phaseId, r]));
      // Re-run coverage in case the snapshot just changed.
      runCoverageNow();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phasesKey, trip.id]);

  const runCoverageNow = useCallback(() => {
    if (!map) return;
    const b = map.getBounds();
    if (!b) return;
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth(),
    ];
    const zoom = map.getZoom();
    const result = findCoveringPhase(bbox, zoom, trip, statusesRef.current);
    setStatus(result.status);
    if (result.status === "uncovered") {
      setSuggestedPhase(suggestPhaseForViewport(bbox, zoom, trip));
    } else {
      setSuggestedPhase(null);
    }
  }, [map, trip]);

  useEffect(() => {
    if (!map) return;
    const onIdle = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(runCoverageNow, IDLE_DEBOUNCE_MS);
    };
    map.on("idle", onIdle);
    // Kick once on attach so the banner reflects initial viewport.
    runCoverageNow();
    return () => {
      map.off("idle", onIdle);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [map, runCoverageNow]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { status, suggestedPhase, dismissed, dismiss };
}
