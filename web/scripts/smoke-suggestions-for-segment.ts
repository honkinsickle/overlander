/**
 * One-off smoke test for src/lib/routing/suggestions-for-segment.ts.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/smoke-suggestions-for-segment.ts
 *
 * Routes Santa Rosa→Portland, splits into 3-hr days, then queries
 * Foursquare + RIDB for the first day's segment. Burns ~5-10 API calls
 * against each source — keep that in mind if iterating. Prints sample
 * counts + a handful of place titles per category so we can eyeball
 * that the segment-scoped query is returning sensible results.
 */
import { routeBetween } from "../src/lib/routing/route-between";
import { segmentByPace } from "../src/lib/routing/segment-by-pace";
import {
  sampleAlong,
  suggestionsForSegment,
} from "../src/lib/routing/suggestions-for-segment";

const SANTA_ROSA: [number, number] = [-122.7144, 38.4404];
const PORTLAND: [number, number] = [-122.6750, 45.5152];

async function main() {
  const route = await routeBetween([SANTA_ROSA, PORTLAND]);
  const days = segmentByPace(route, { maxDurationS: 3 * 3600 });
  console.log(
    `Route: Santa Rosa→Portland ${(route.distanceM / 1609.34).toFixed(1)} mi ` +
      `· ${(route.durationS / 3600).toFixed(2)} hrs → ${days.length} days at 3hrs/day`,
  );

  const day1 = days[0];
  const day1Mi = (day1.distanceM / 1609.34).toFixed(1);
  const samples = sampleAlong(day1.coordinates, 25);
  console.log(
    `\nDay 1: ${day1Mi} mi · ${day1.coordinates.length} coords · sampled to ${samples.length} bbox centers at 25 mi radius`,
  );

  console.log("\nQuerying Foursquare + RIDB across Day 1 segment…");
  const places = await suggestionsForSegment(day1, { radiusMi: 25 });
  console.log(`Got ${places.length} places.\n`);

  const withPhoto = places.filter((p) => p.photoUrl).length;
  console.log(`  ${withPhoto}/${places.length} have photos`);
  console.log("\nFirst 10 titles:");
  for (const p of places.slice(0, 10)) {
    console.log(`  · ${p.title}`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
