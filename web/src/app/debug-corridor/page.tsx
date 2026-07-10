"use client";
// TEMP DEBUG HARNESS (fix/corridor-phantom-spine) — REMOVE before merge.
// Reproduces the corridor-rail day-switch reconciliation in isolation: the
// SAME DayDetailCorridor instance (unkeyed, exactly like day-detail-corridor-
// column) receives a swapped `cities` prop across day switches. Day 2 is a
// same-city rest day whose start+end nodes share id "dawson-yt" (duplicate
// React key). No auth / no DB.
import { useState } from "react";
import { DayDetailCorridor } from "@/components/trip/day-detail-corridor";
import type { CorridorCity } from "@/lib/trips/types";

const DAY1: CorridorCity[] = [
  { id: "tok-ak", name: "Tok, AK", kind: "start", coords: [-142.98, 63.33], milesFromStart: 0, placeIds: [] },
  { id: "dawson-yt", name: "Dawson, YT", kind: "end", coords: [-139.56, 64.08], milesFromStart: 177, placeIds: [] },
];
const DAY2: CorridorCity[] = [
  { id: "dawson-yt", name: "Dawson, YT", kind: "start", coords: [-139.56, 64.08], milesFromStart: 0, placeIds: [] },
  { id: "dawson-yt", name: "Dawson, YT", kind: "end", coords: [-139.43, 64.06], milesFromStart: 8, placeIds: [] },
];

export default function DebugCorridor() {
  const [dayIdx, setDayIdx] = useState(0);
  const cities = dayIdx === 0 ? DAY1 : DAY2;
  return (
    <div style={{ padding: 24, background: "#0a0b0c", minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button id="btn-day1" onClick={() => setDayIdx(0)} style={{ padding: "8px 16px" }}>Day 1</button>
        <button id="btn-day2" onClick={() => setDayIdx(1)} style={{ padding: "8px 16px" }}>Day 2</button>
        <span id="rendered-count" style={{ color: "#fff", padding: 8 }} />
      </div>
      {/* Unkeyed — mirrors day-detail-corridor-column.tsx:450 (instance reused across day switches). */}
      <DayDetailCorridor
        dayLabel={`Day ${dayIdx + 1}`}
        dayNumber={dayIdx + 1}
        routeLabel={dayIdx === 0 ? "Tok, AK — Dawson, YT" : "Dawson, YT — Dawson, YT"}
        heroImageUrl={undefined}
        heroAlt=""
        cities={cities}
        places={[]}
        onRemovePlace={() => {}}
        onOpenPlace={() => {}}
        onExploreDay={() => {}}
      />
    </div>
  );
}
