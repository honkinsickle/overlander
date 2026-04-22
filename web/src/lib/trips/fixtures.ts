import type { Trip } from "./types";

/**
 * Sample trips — in-memory fixtures.
 *
 * Next.js bundles Route Handlers and Server Components into separate
 * module runtimes, so a plain `const TRIPS = {...}` would produce two
 * independent copies. Mutations via Server Actions land in one copy;
 * Route Handlers read from the other and see stale data.
 *
 * Pinning the store on `globalThis` gives every module instance the
 * same reference. Standard Next.js pattern (also used for Prisma etc).
 * Swap this module for a real data source by replacing the `seed`
 * function; keep the shape in `./types.ts`.
 */
const seed = (): Record<string, Trip> => ({
  "la-to-portland": {
    id: "la-to-portland",
    title: "Los Angeles to Portland",
    startDate: "2026-05-31",
    endDate: "2026-06-05",
    startLocation: "Los Angeles, CA",
    endLocation: "Portland, OR",
    weatherHiF: 84,
    weatherLoF: 64,
    days: [
      {
        id: "day-1",
        dayNumber: 1,
        date: "2026-05-29",
        label: "Seattle, WA — Mount Rainier NP",
        waypoints: [
          {
            id: "wp-banff",
            slug: "banff",
            category: "urban",
            title: "Banff Townsite",
            subtitle: "Day 1 · 165 mi from Los Angeles",
            description:
              "Stock up on supplies, grab a proper coffee, and catch a last hot shower before backcountry.",
            tip: "Park at the Hi-Alpine lot. Meters don't run past 5pm.",
            stats: [
              { label: "DETOUR",    value: "+0 mi" },
              { label: "STOP TIME", value: "~45 min" },
              { label: "ETA",       value: "3:20pm" },
            ],
          },
          {
            id: "wp-nakimu",
            slug: "nakimu-caves",
            category: "oddity",
            title: "Abandoned Nakimu Caves",
            subtitle: "Day 1 · 210 mi from Los Angeles",
            description:
              "Closed to the public since 1935. Short bushwhack to a sealed entrance in Glacier NP.",
            tip: "Do not enter — unstable.",
            stats: [
              { label: "DETOUR",    value: "+14 mi" },
              { label: "STOP TIME", value: "~20 min" },
              { label: "ETA",       value: "4:40pm" },
            ],
          },
        ],
        overnight: {
          selected: {
            id: "on-tumalo",
            name: "Tumalo State Park Area",
            type: "Dispersed",
            detourMiles: 6,
            cost: "$15 showers",
            notes: "Cascade mountain views",
          },
          alternatives: [
            { id: "on-hurricane",  name: "Hurricanne Cliffs BLM",   type: "Dispersed", detourMiles: 12, cost: "free" },
            { id: "on-ohanapecosh", name: "Ohanapecosh Campground", type: "State park", detourMiles: 18, cost: "$30/night", notes: "Reservable" },
            { id: "on-cougar",      name: "Cougar Rock Campground", type: "NPS",        detourMiles: 22, cost: "$25/night", notes: "3 sites left" },
          ],
        },
      },
      {
        id: "day-2",
        dayNumber: 2,
        date: "2026-05-30",
        label: "Mount Rainier NP — Bend, OR",
        waypoints: [
          {
            id: "wp-umpqua",
            slug: "umpqua-hot-springs",
            category: "mountain",
            title: "Umpqua Hot Springs",
            subtitle: "Day 2 · +14 mi detour",
            description:
              "Six terraced pools stacked up a forested bluff above the North Umpqua River. Clothing-optional.",
            tip: "Arrive before 10am or after 6pm — parking is tight and fills fast in summer.",
            stats: [
              { label: "DETOUR",    value: "+14 mi" },
              { label: "STOP TIME", value: "~1 hr" },
              { label: "ETA",       value: "11:05am" },
            ],
          },
          {
            id: "wp-crater",
            slug: "crater-lake",
            category: "attraction",
            title: "Crater Lake Rim",
            subtitle: "Day 2 · 40 mi from Bend",
            description:
              "North rim pullout for the classic caldera view. Rim Drive is usually clear by late May.",
            stats: [
              { label: "DETOUR",    value: "+22 mi" },
              { label: "STOP TIME", value: "~30 min" },
              { label: "ETA",       value: "2:15pm" },
            ],
          },
        ],
        overnight: {
          selected: {
            id: "on-tumalo-sp",
            name: "Tumalo State Park Campground",
            type: "State park",
            detourMiles: 4,
            cost: "$24/night",
            notes: "Reservable",
          },
          alternatives: [
            { id: "on-smith-rock", name: "Smith Rock State Park",   type: "State park", detourMiles: 9,  cost: "$8/hiker"              },
            { id: "on-bend-bw",    name: "Bend Dispersed (BLM)",    type: "Dispersed",  detourMiles: 14, cost: "free", notes: "14-day limit" },
          ],
        },
      },
    ],
  },
});

type TripStore = { trips: Record<string, Trip> };
const globalForTrips = globalThis as unknown as { __tripStore?: TripStore };
const store: TripStore =
  globalForTrips.__tripStore ?? (globalForTrips.__tripStore = { trips: seed() });

export const TRIPS: Record<string, Trip> = store.trips;
