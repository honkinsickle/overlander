/**
 * Pure parsing/validation for hand-entered lat/lng destination coordinates
 * (the `/plan/expedition` wizard's coordinate-entry mode). Kept separate from
 * `coordinate-input.tsx` so the range-checking logic is testable without
 * mounting a React component.
 */

export type CoordinateEntryResult =
  | { status: "empty" }
  | { status: "error"; message: string }
  | { status: "ok"; coords: [number, number] };

/** Parses two free-text fields into a `[lng, lat]` pair, or reports why not.
 *  "empty" (both fields blank) is distinct from "error" — an untouched pair
 *  of inputs isn't a validation failure, it just has nothing to resolve yet. */
export function parseCoordinateEntry(
  latText: string,
  lngText: string,
): CoordinateEntryResult {
  const lat = latText.trim();
  const lng = lngText.trim();
  if (lat === "" && lng === "") return { status: "empty" };
  if (lat === "" || lng === "")
    return { status: "error", message: "Enter both latitude and longitude." };
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum))
    return { status: "error", message: "Coordinates must be numbers." };
  if (latNum < -90 || latNum > 90)
    return { status: "error", message: "Latitude must be between -90 and 90." };
  if (lngNum < -180 || lngNum > 180)
    return { status: "error", message: "Longitude must be between -180 and 180." };
  return { status: "ok", coords: [lngNum, latNum] };
}

/** Display label for a manually-entered point — no reverse geocoding. */
export function formatCustomPointLabel(coords: [number, number]): string {
  const [lng, lat] = coords;
  return `Custom Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
}
