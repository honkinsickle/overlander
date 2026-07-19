/**
 * Checked-in test fixture for the partial-replan byte-identical guarantee.
 *
 * A persisted 14-day trip payload + its GenerationInput, structurally faithful
 * to the TEST copy `dawson-cassiar-livingplan-test` (Dawson → Vancouver via the
 * Cassiar, 2026-07-13 → 07-26, Vancouver fixed 7/26). Enriched beyond the bare
 * day table so a sha256 of the frozen prefix is MEANINGFUL: each day carries
 * coords / startCoord / miles / driveHours / a waypoint / an overnight /
 * description — the real content that must survive a tail re-plan byte-for-byte.
 *
 * SCRUBBED / SYNTHETIC: coordinates are approximate real geography; there are no
 * photo URLs, ids, tokens, or any env-specific values. Nothing here touches PROD
 * or the DB — it is inert data a pure test hashes and splices.
 *
 * Two layover days sit in the table on purpose (day 7 Stewart→Stewart glacier
 * day-trip, day 11 Wells→Wells Barkerville day) so the boundary cases can cleave
 * with a rest day as the last-frozen or first-resumed day.
 */

import type { Day } from "@/lib/trips/types";
import type { GenerationInput } from "./facts";
import { encodePolyline } from "@/lib/routing/polyline";

/** Overnight-city anchors, `[lng, lat]` (approximate real geography). */
const CITY: Record<string, [number, number]> = {
  dawson: [-139.4327, 64.0601],
  whitehorse: [-135.0568, 60.7212],
  watson: [-128.7089, 60.0635],
  dease: [-130.0158, 58.4372],
  bell2: [-129.8299, 56.6803],
  meziadin: [-129.2887, 56.1017],
  stewart: [-129.9896, 55.9358],
  smithers: [-127.1686, 54.7804],
  princeGeorge: [-122.7497, 53.9171],
  wells: [-121.5503, 53.0995],
  clinton: [-121.5892, 51.0913],
  hope: [-121.4419, 49.3802],
  vancouver: [-123.1207, 49.2827],
};

const mkDay = (
  n: number,
  date: string,
  label: string,
  startCoord: [number, number],
  endCoord: [number, number],
  miles: number,
  driveHours: number,
  waypointTitle: string,
  overnightName: string,
  description: string,
): Day => ({
  id: `day-${n}`,
  dayNumber: n,
  date,
  label,
  startCoord,
  coords: endCoord,
  miles,
  driveHours,
  description,
  waypoints: [
    {
      id: `wp-${n}-1`,
      slug: `wp-${n}-1`,
      category: "scenic",
      title: waypointTitle,
      subtitle: `Day ${n}`,
      description: `${waypointTitle} — a stop on the day's drive.`,
      stats: [{ label: "Distance", value: `${miles} mi` }],
    },
  ],
  overnight: {
    selected: {
      id: `on-${n}`,
      name: overnightName,
      type: "Provincial park",
      detourMiles: 0,
      cost: "$20/night",
    },
    alternatives: [],
  },
});

/**
 * The 14-day table. Day 7 (Stewart→Stewart) and day 11 (Wells→Wells) are
 * layover days — same start/end place.
 */
export const FIXTURE_DAYS: Day[] = [
  mkDay(1, "2026-07-13", "Dawson City, Yukon — Whitehorse, YT", CITY.dawson, CITY.whitehorse, 332, 6.6, "Klondike Highway", "Whitehorse RV", "South down the Klondike to Whitehorse."),
  mkDay(2, "2026-07-14", "Whitehorse, YT — Watson Lake, YT", CITY.whitehorse, CITY.watson, 272, 5.4, "Sign Post Forest", "Watson Lake CG", "Alaska Highway east to Watson Lake."),
  mkDay(3, "2026-07-15", "Watson Lake, YT — Dease Lake, BC", CITY.watson, CITY.dease, 159, 3.6, "Cassiar Highway 37", "Dease Lake Pullout", "Onto the Cassiar, southbound."),
  mkDay(4, "2026-07-16", "Dease Lake, BC — Bell II, BC", CITY.dease, CITY.bell2, 149, 3.4, "Bell-Irving River", "Bell II Lodge", "Deeper into the Cassiar corridor."),
  mkDay(5, "2026-07-17", "Bell II, BC — Meziadin Lake Provincial Park, BC", CITY.bell2, CITY.meziadin, 57, 1.4, "Meziadin Junction", "Meziadin Lake PP", "Short hop to Meziadin Lake."),
  mkDay(6, "2026-07-18", "Meziadin Lake Provincial Park, BC — Stewart, British Columbia", CITY.meziadin, CITY.stewart, 38, 0.9, "Bear Glacier", "Stewart Waterfront", "The spur to Stewart past Bear Glacier."),
  mkDay(7, "2026-07-19", "Stewart, British Columbia — Stewart, British Columbia", CITY.stewart, CITY.stewart, 60, 2.0, "Salmon Glacier", "Stewart Waterfront", "Layover: the Salmon Glacier road day-trip."),
  mkDay(8, "2026-07-20", "Stewart, British Columbia — Smithers, BC", CITY.stewart, CITY.smithers, 204, 4.3, "Kitwanga", "Smithers Muni", "Back down the Cassiar, east to Smithers."),
  mkDay(9, "2026-07-21", "Smithers, BC — Prince George, BC", CITY.smithers, CITY.princeGeorge, 231, 4.6, "Hazelton", "Prince George KOA", "Yellowhead Highway to Prince George."),
  mkDay(10, "2026-07-22", "Prince George, BC — Wells, BC", CITY.princeGeorge, CITY.wells, 113, 2.5, "Cottonwood House", "Wells Municipal", "East to the goldfields."),
  mkDay(11, "2026-07-23", "Wells, BC — Wells, BC", CITY.wells, CITY.wells, 15, 0.5, "Barkerville", "Wells Municipal", "Layover: Barkerville historic town."),
  mkDay(12, "2026-07-24", "Wells, BC — Clinton, BC", CITY.wells, CITY.clinton, 224, 4.7, "Quesnel", "Clinton Pines", "South down the Cariboo."),
  mkDay(13, "2026-07-25", "Clinton, BC — Hope, BC", CITY.clinton, CITY.hope, 145, 3.2, "Marble Canyon", "Hope Valley RV", "Fraser Canyon to Hope."),
  mkDay(14, "2026-07-26", "Hope, BC — Vancouver, British Columbia", CITY.hope, CITY.vancouver, 93, 2.0, "Bridal Veil Falls", "Vancouver arrival", "Final leg into Vancouver."),
];

export const FIXTURE_INPUT: GenerationInput = {
  anchors: [
    { place: "Dawson City, Yukon", role: "start", datePin: "fixed", date: "2026-07-13", dwell: 0, note: null },
    { place: "Stewart, British Columbia", role: "waypoint", datePin: "fixed", date: "2026-07-18", dwell: 1, note: "glacier spur" },
    { place: "Barkerville", role: "waypoint", datePin: "flexible", date: null, dwell: 0, note: "gold-rush town", coords: [-121.5108, 53.0686] },
    { place: "Vancouver, British Columbia", role: "end", datePin: "fixed", date: "2026-07-26", dwell: 0, note: null },
  ],
  params: {
    startDate: "2026-07-13", endDate: "2026-07-26", budget: "mid",
    maxDailyDriveMi: 350, bufferDays: 0, avoid: [], returnRouting: "shortest",
  },
  rig: { vehicle: "GX470", build: [], fuelRangeMi: 400, capability: "moderate", groupSize: "1", skill: "intermediate", preferences: [] },
};

/** Ordered route spine (skips layover repeats — a rest day adds no road). */
const ROUTE_SPINE: [number, number][] = [
  CITY.dawson, CITY.whitehorse, CITY.watson, CITY.dease, CITY.bell2,
  CITY.meziadin, CITY.stewart, CITY.smithers, CITY.princeGeorge,
  CITY.wells, CITY.clinton, CITY.hope, CITY.vancouver,
];

/** Densify each leg with interpolated vertices so `alongRouteMiles` has a
 *  realistic multi-vertex line to project the resume point onto. Deterministic. */
function densify(spine: [number, number][], perLeg: number): [number, number][] {
  const out: [number, number][] = [spine[0]];
  for (let i = 0; i < spine.length - 1; i++) {
    const [ax, ay] = spine[i];
    const [bx, by] = spine[i + 1];
    for (let k = 1; k <= perLeg; k++) {
      const t = k / perLeg;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  return out;
}

/** The pre-baked full-trip geometry, encoded exactly as `Trip.routePolyline`
 *  is stored (Google polyline, precision 5). Prince George is a spine vertex,
 *  so a cleave there projects onto a real vertex. */
export const FIXTURE_ROUTE_POLYLINE: string = encodePolyline(densify(ROUTE_SPINE, 8));

/** Convenience: the full persisted trip payload (payload-faithful subset). */
export const FIXTURE_TRIP = {
  id: "dawson-cassiar-livingplan-test",
  title: "Dawson → Vancouver (Cassiar)",
  startDate: "2026-07-13",
  endDate: "2026-07-26",
  startLocation: "Dawson City, Yukon",
  endLocation: "Vancouver, British Columbia",
  startCoords: CITY.dawson,
  routePolyline: FIXTURE_ROUTE_POLYLINE,
  generated: true,
  days: FIXTURE_DAYS,
  weatherHiF: 68,
  weatherLoF: 48,
};
