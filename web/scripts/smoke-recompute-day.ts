/**
 * One-off smoke test for edit-time day recompute (lib/trips/recompute-day.ts).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/smoke-recompute-day.ts
 *
 * Builds a synthetic LA→Santa Barbara day, runs recomputeDay against the
 * REAL Mapbox Directions API twice — without and with a detour waypoint
 * (Ojai, ~12 mi inland off US-101) — and prints both derivations. Shows
 * the through-stops semantics: the waypoint bends the route, raises
 * miles/driveHours, and re-derives the corridor spine + bucketing.
 */
import { recomputeDay } from "../src/lib/trips/recompute-day";
import type { Trip, Waypoint } from "../src/lib/trips/types";

const OJAI: [number, number] = [-119.243, 34.448];

function makeTrip(waypoints: Waypoint[]): Trip {
  return {
    id: "smoke",
    title: "Smoke",
    startDate: "2026-05-30",
    endDate: "2026-05-30",
    startLocation: "Los Angeles, CA",
    endLocation: "Santa Barbara, CA",
    startCoords: [-118.2437, 34.0522],
    weatherHiF: 75,
    weatherLoF: 55,
    days: [
      {
        id: "day-1",
        dayNumber: 1,
        date: "2026-05-30",
        label: "Los Angeles, CA — Santa Barbara, CA",
        startCoord: [-118.2437, 34.0522],
        coords: [-119.6982, 34.4208],
        waypoints,
      },
    ],
  };
}

const ojaiStop: Waypoint = {
  id: "wp-ojai",
  slug: "wp-ojai",
  category: "scenic",
  title: "Ojai Overlook",
  subtitle: "",
  description: "",
  stats: [],
  coords: OJAI,
};

async function run(label: string, waypoints: Waypoint[]) {
  const t0 = performance.now();
  const r = await recomputeDay(makeTrip(waypoints), "day-1");
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`\n■ ${label} (${ms} ms)`);
  if (!r) {
    console.log("  (null — no recompute)");
    return;
  }
  console.log(`  miles ${r.miles} · driveHours ${r.driveHours}`);
  for (const c of r.corridorCities ?? []) {
    const places = c.placeIds.length ? `  [${c.placeIds.join(", ")}]` : "";
    console.log(
      `  ${c.kind.padEnd(8)} ${c.milesFromStart.toFixed(1).padStart(6)} mi  ${c.name}${places}`,
    );
  }
}

async function main() {
  await run("No waypoints (direct US-101)", []);
  await run("With Ojai detour waypoint", [ojaiStop]);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
