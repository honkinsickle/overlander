/**
 * One-off smoke test for the corridorCities finalize hook path
 * (src/lib/corridor/derive.ts as called from lib/plan/actions.ts).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/smoke-corridor-cities.ts
 *
 * Mirrors buildRouteAwareDays: routeBetween → segmentByPace → per-segment
 * deriveCorridorCities against the real bundled gazetteer, on the demo
 * LA → Portland route at the default 6 hrs/day pace. Prints the corridor
 * spine per day for eyeballing node quality (see the spec §2.1.3 tuning
 * note — parameters get tuned against outputs like this one).
 */
import { routeBetween } from "../src/lib/routing/route-between";
import { segmentByPace } from "../src/lib/routing/segment-by-pace";
import { deriveCorridorCities } from "../src/lib/corridor/derive";
import gazetteer from "../src/lib/corridor/data/cities-na.json";

const LOS_ANGELES: [number, number] = [-118.2437, 34.0522];
const PORTLAND: [number, number] = [-122.675, 45.5152];

async function main() {
  const route = await routeBetween([LOS_ANGELES, PORTLAND]);
  const totalMi = (route.distanceM / 1609.34).toFixed(0);
  console.log(`Route: LA→Portland ${totalMi} mi, ${route.coordinates.length} coords`);

  const segments = segmentByPace(route, { maxDurationS: 6 * 3600 });
  console.log(`Segmented into ${segments.length} day(s)\n`);

  for (const seg of segments) {
    const t0 = performance.now();
    const nodes = deriveCorridorCities({
      line: seg.coordinates,
      start: { name: `Day ${seg.index} start`, coords: seg.startCoord },
      end: { name: `Day ${seg.index} end`, coords: seg.endCoord },
      gazetteer,
    });
    const ms = (performance.now() - t0).toFixed(1);
    const mi = (seg.distanceM / 1609.34).toFixed(0);
    console.log(`Day ${seg.index} (${mi} mi, derived in ${ms} ms):`);
    for (const n of nodes ?? []) {
      console.log(
        `  ${n.kind.padEnd(8)} ${n.milesFromStart.toFixed(1).padStart(6)} mi  ${n.name}`,
      );
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
