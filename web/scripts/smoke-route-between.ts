/**
 * One-off smoke test for src/lib/routing/route-between.ts.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/smoke-route-between.ts
 *
 * Prints a one-line summary for LA→Vegas (one-way and round-trip) so we
 * can eyeball that total distance, duration, and step count look sane.
 */
import { routeBetween } from "../src/lib/routing/route-between";

const LA: [number, number] = [-118.2437, 34.0522];
const VEGAS: [number, number] = [-115.1398, 36.1699];

function fmt(label: string, r: Awaited<ReturnType<typeof routeBetween>>) {
  const mi = (r.distanceM / 1609.34).toFixed(1);
  const hrs = (r.durationS / 3600).toFixed(1);
  console.log(
    `${label}: ${mi} mi · ${hrs} hrs · ${r.coordinates.length} coords · ${r.steps.length} steps`,
  );
}

async function main() {
  fmt("LA→Vegas one-way   ", await routeBetween([LA, VEGAS]));
  fmt("LA→Vegas round-trip", await routeBetween([LA, VEGAS], { roundTrip: true }));
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
