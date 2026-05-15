/**
 * One-off smoke test for src/lib/routing/segment-by-pace.ts.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/smoke-segment-by-pace.ts
 *
 * Exercises the closest-to-limit boundary rule against a real Mapbox
 * route (LA → Vegas, ~270 mi / 4.7 hrs / 20 steps). Prints one line
 * per day showing distance + duration + step count so we can eyeball
 * that boundaries are landing near the chosen limit on both sides.
 */
import { routeBetween } from "../src/lib/routing/route-between";
import { segmentByPace, type DaySegment } from "../src/lib/routing/segment-by-pace";

const SANTA_ROSA: [number, number] = [-122.7144, 38.4404];
const PORTLAND: [number, number] = [-122.6750, 45.5152];

function fmt(days: DaySegment[], limitLabel: string) {
  console.log(`\n=== ${limitLabel} → ${days.length} day(s) ===`);
  for (const d of days) {
    const mi = (d.distanceM / 1609.34).toFixed(1);
    const hrs = (d.durationS / 3600).toFixed(2);
    console.log(
      `  Day ${d.index}: ${mi} mi · ${hrs} hrs · ${d.steps.length} steps · ${d.coordinates.length} coords`,
    );
  }
}

async function main() {
  const route = await routeBetween([SANTA_ROSA, PORTLAND]);
  const totalMi = (route.distanceM / 1609.34).toFixed(1);
  const totalHrs = (route.durationS / 3600).toFixed(2);
  console.log(
    `Route: Santa Rosa→Portland ${totalMi} mi · ${totalHrs} hrs · ${route.steps.length} steps`,
  );

  fmt(segmentByPace(route, { maxDurationS: 3 * 3600 }), "3 hrs / day");
  fmt(segmentByPace(route, { maxDurationS: 1 * 3600 }), "1 hr / day");
  fmt(segmentByPace(route, { maxDistanceM: 100 * 1609.34 }), "100 mi / day");
  fmt(segmentByPace(route, { maxDistanceM: 500 * 1609.34 }), "500 mi / day");
  fmt(segmentByPace(route, { maxDistanceM: 1000 * 1609.34 }), "1000 mi / day (one day fits)");

  // Negative cases.
  let threw = 0;
  try {
    segmentByPace(route, {});
  } catch {
    threw++;
  }
  try {
    segmentByPace(route, { maxDurationS: 3600, maxDistanceM: 100 * 1609.34 });
  } catch {
    threw++;
  }
  console.log(
    `\nValidation: ${threw === 2 ? "✓" : "✗"} both empty and both-set throw as expected`,
  );
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
