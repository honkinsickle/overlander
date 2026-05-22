"use client";

import { useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";

/** One turn-by-turn step in a driving leg. Mirrors the subset of the
 *  Mapbox Directions API response we actually render — instruction +
 *  road name + sub-polyline + distance/duration. */
export type DirectionStep = {
  instruction: string;
  /** Maneuver kind from Mapbox — "turn", "merge", "depart", "arrive",
   *  "roundabout", "continue", etc. Drives icon selection. */
  type: string;
  /** Direction modifier — "left", "right", "straight", "slight left",
   *  etc. Combined with `type` to pick the icon. */
  modifier?: string;
  /** Coords for this step's sub-segment (LineString). Used by the GPS
   *  matcher to find which step the user is currently in, and by
   *  click-to-fly. */
  coords: [number, number][];
  /** Distance in meters for this step (drive to the next maneuver). */
  distanceMeters: number;
  /** Seconds for this step. */
  durationSec: number;
  /** Road name for this step. Optional — some maneuvers don't carry one. */
  name?: string;
};

export type LegDirections = {
  steps: DirectionStep[];
  totalDistanceMeters: number;
  totalDurationSec: number;
};

export type DirectionsStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: LegDirections }
  | { kind: "error"; message: string };

/** Module-level caches let derived render state stay outside of useRef
 *  (which is forbidden during render by react-hooks/refs). Same key
 *  shape across all hook instances — multiple panels could share. */
const cache = new Map<string, LegDirections>();
const errors = new Map<string, string>();
const inflight = new Set<string>();

function cacheKey(
  start: [number, number],
  end: [number, number],
): string {
  return `${start[0].toFixed(5)},${start[1].toFixed(5)}|${end[0].toFixed(5)},${end[1].toFixed(5)}`;
}

type RawStep = {
  maneuver?: {
    type?: string;
    modifier?: string;
    instruction?: string;
  };
  distance?: number;
  duration?: number;
  name?: string;
  geometry?: { coordinates?: [number, number][] };
};

/** Fetch turn-by-turn directions for a single driving leg. Status is
 *  derived at render time from the module-level cache + errors — so
 *  swapping legs reflects the new key's state immediately without a
 *  stale-data flash. The version counter only exists to trigger
 *  re-renders when an async fetch completes. */
export function useLegDirections(
  start: [number, number] | null,
  end: [number, number] | null,
): DirectionsStatus {
  const requestKey = start && end ? cacheKey(start, end) : null;
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!start || !end || !requestKey) return;
    if (cache.has(requestKey)) return;
    if (errors.has(requestKey)) return;
    if (inflight.has(requestKey)) return;
    inflight.add(requestKey);

    const controller = new AbortController();
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${start[0]},${start[1]};${end[0]},${end[1]}` +
      `?steps=true&geometries=geojson&overview=full` +
      `&access_token=${mapboxgl.accessToken}`;

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Directions ${res.status}`);
        const json = (await res.json()) as {
          routes?: {
            distance?: number;
            duration?: number;
            legs?: { steps?: RawStep[] }[];
          }[];
        };
        const route = json.routes?.[0];
        const rawSteps = route?.legs?.[0]?.steps ?? [];
        if (rawSteps.length === 0) throw new Error("No steps");
        const steps: DirectionStep[] = rawSteps.map((s) => ({
          instruction: s.maneuver?.instruction ?? "",
          type: s.maneuver?.type ?? "continue",
          modifier: s.maneuver?.modifier,
          coords: s.geometry?.coordinates ?? [],
          distanceMeters: s.distance ?? 0,
          durationSec: s.duration ?? 0,
          name: s.name && s.name.length > 0 ? s.name : undefined,
        }));
        cache.set(requestKey, {
          steps,
          totalDistanceMeters: route?.distance ?? 0,
          totalDurationSec: route?.duration ?? 0,
        });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        errors.set(requestKey, err.message);
      })
      .finally(() => {
        inflight.delete(requestKey);
        setVersion((v) => v + 1);
      });

    return () => {
      controller.abort();
      inflight.delete(requestKey);
    };
  }, [requestKey, start, end]);

  if (!requestKey) return { kind: "idle" };
  const cached = cache.get(requestKey);
  if (cached) return { kind: "ready", data: cached };
  const err = errors.get(requestKey);
  if (err) return { kind: "error", message: err };
  return { kind: "loading" };
}
