"use client";

import { useState } from "react";
import {
  parseCoordinateEntry,
  formatCustomPointLabel,
} from "@/lib/plan/parse-coordinates";

/**
 * Hand-entered lat/lng destination input — the coordinate-mode counterpart
 * to `LocationAutocomplete`. No geocoding, no reverse geocoding, no
 * `place_id`: the resolved `coords` and a plain "Custom Point (…)" label are
 * the only outputs. Validation is `parseCoordinateEntry`
 * (`lib/plan/parse-coordinates.ts`), re-run on every keystroke so the error
 * message and the resolved state never lag the visible inputs.
 */
export function CoordinateInput({
  defaultLat,
  defaultLng,
  invalid,
  onResolve,
}: {
  defaultLat?: number;
  defaultLng?: number;
  /** Error ring driven by the PARENT's validation (e.g. "unresolved" on
   *  submit) — distinct from this component's own inline range-error text. */
  invalid?: boolean;
  /** Fired on every change. `coords` is null while empty/invalid; the label
   *  is only meaningful when `coords` is non-null. */
  onResolve: (coords: [number, number] | null, label: string) => void;
}) {
  const [lat, setLat] = useState(defaultLat != null ? String(defaultLat) : "");
  const [lng, setLng] = useState(defaultLng != null ? String(defaultLng) : "");

  function commit(nextLat: string, nextLng: string) {
    const result = parseCoordinateEntry(nextLat, nextLng);
    if (result.status === "ok") {
      onResolve(result.coords, formatCustomPointLabel(result.coords));
    } else {
      onResolve(null, "");
    }
  }

  const result = parseCoordinateEntry(lat, lng);
  const error = result.status === "error" ? result.message : null;
  const ring = invalid || error ? "border-input-error!" : "";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          type="text"
          inputMode="decimal"
          placeholder="Lat (-90 to 90)"
          value={lat}
          onChange={(e) => {
            setLat(e.target.value);
            commit(e.target.value, lng);
          }}
          className={`form-field flex-1 ${ring}`}
        />
        <input
          type="text"
          inputMode="decimal"
          placeholder="Lng (-180 to 180)"
          value={lng}
          onChange={(e) => {
            setLng(e.target.value);
            commit(lat, e.target.value);
          }}
          className={`form-field flex-1 ${ring}`}
        />
      </div>
      {error && <span className="text-[11px] text-input-error">{error}</span>}
    </div>
  );
}
