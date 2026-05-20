import { projectPointToPolyline } from "@/lib/routing/point-to-polyline";

/** Snap a raw GPS coord to the closest point on the trip's road-following
 *  polyline when within `thresholdMi`; otherwise return the raw coord.
 *  Smooths the user-location marker against GPS jitter and lets the dot
 *  visibly hug the planned route while driving.
 *
 *  `snapped` lets the layer tell apart "on route" from "off route" if it
 *  wants to surface that distinction later (e.g. an "X mi off route"
 *  chip). `offRouteMi` is `Infinity` when the path is empty/null. */
export function snapToRoute(
  coord: [number, number],
  path: [number, number][] | null,
  thresholdMi: number,
): { coord: [number, number]; snapped: boolean; offRouteMi: number } {
  if (!path || path.length < 2) {
    return { coord, snapped: false, offRouteMi: Infinity };
  }
  const result = projectPointToPolyline(coord, path);
  if (!result) return { coord, snapped: false, offRouteMi: Infinity };
  if (result.distanceMi <= thresholdMi) {
    return {
      coord: result.coord,
      snapped: true,
      offRouteMi: result.distanceMi,
    };
  }
  return { coord, snapped: false, offRouteMi: result.distanceMi };
}
