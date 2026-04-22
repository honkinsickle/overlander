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
        coords: [-121.7603, 46.8523],
        miles: 95,
        driveHours: 2.3,
        heroGradient:
          "linear-gradient(135deg, #1e3b34 0%, #2d5045 40%, #c8a96e 100%)",
        heroCaption: "HWY 7 · MOUNT RAINIER · DAY 01",
        heroTag: "↑ EASTBOUND",
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
        coords: [-121.3153, 44.0582],
        miles: 280,
        driveHours: 5.8,
        heroGradient:
          "linear-gradient(135deg, #142820 0%, #1e4a3a 50%, #c77429 100%)",
        heroCaption: "US-97 · CASCADE RANGE · DAY 02",
        heroTag: "↓ SOUTHBOUND",
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
      {
        id: "day-3",
        dayNumber: 3,
        date: "2026-05-31",
        label: "Bend, OR — Redwoods NP, CA",
        coords: [-124.0046, 41.2132],
        miles: 410,
        driveHours: 8.2,
        heroGradient:
          "linear-gradient(135deg, #2a1a2e 0%, #5a3a2e 50%, #c77429 100%)",
        heroCaption: "US-101 · REDWOOD COAST · DAY 03",
        heroTag: "↓ SOUTHBOUND",
        waypoints: [
          {
            id: "wp-mckenzie",
            slug: "mckenzie-pass",
            category: "mountain",
            title: "McKenzie Pass",
            subtitle: "Day 3 · OR-242",
            description:
              "Lava-field overlook on a narrow old highway. Closed in winter; summer the visibility is insane.",
            tip: "Top off fuel in Sisters — no gas for 50 mi after.",
            stats: [
              { label: "DETOUR",    value: "+0 mi" },
              { label: "STOP TIME", value: "~20 min" },
              { label: "ETA",       value: "10:40am" },
            ],
          },
          {
            id: "wp-prehistoric",
            slug: "prehistoric-gardens",
            category: "oddity",
            title: "Prehistoric Gardens",
            subtitle: "Day 3 · US-101",
            description:
              "Concrete dinosaurs in a rainforest, built by a WW2 veteran in 1953. Unsubtle.",
            tip: "Cash only. Gift shop has the good t-shirts.",
            stats: [
              { label: "DETOUR",    value: "+2 mi" },
              { label: "STOP TIME", value: "~40 min" },
              { label: "ETA",       value: "3:10pm" },
            ],
          },
        ],
        overnight: {
          selected: {
            id: "on-jedediah",
            name: "Jedediah Smith Redwoods SP",
            type: "State park",
            detourMiles: 3,
            cost: "$35/night",
            notes: "Reserve 6mo ahead in summer",
          },
          alternatives: [
            { id: "on-elk-prairie",   name: "Elk Prairie Campground",   type: "State park", detourMiles: 12, cost: "$35/night" },
            { id: "on-crescent-city", name: "Crescent City Dispersed",  type: "Dispersed",  detourMiles: 6,  cost: "free" },
          ],
        },
      },
      {
        id: "day-4",
        dayNumber: 4,
        date: "2026-06-01",
        label: "Redwoods NP — Portland, OR",
        coords: [-122.6784, 45.5152],
        miles: 380,
        driveHours: 7.0,
        heroGradient:
          "linear-gradient(135deg, #1a2435 0%, #2b3b52 50%, #475c78 100%)",
        heroCaption: "US-101 · PACIFIC COAST · DAY 04",
        heroTag: "↑ NORTHBOUND",
        waypoints: [
          {
            id: "wp-fern-canyon",
            slug: "fern-canyon",
            category: "mountain",
            title: "Fern Canyon",
            subtitle: "Day 4 · Prairie Creek",
            description:
              "50-foot walls draped in five species of fern. Jurassic Park 2 filmed here.",
            tip: "Wear boots you don't mind getting wet — crossings every few hundred feet.",
            stats: [
              { label: "DETOUR",    value: "+8 mi" },
              { label: "STOP TIME", value: "~1.5 hr" },
              { label: "ETA",       value: "9:30am" },
            ],
          },
          {
            id: "wp-cannon-beach",
            slug: "cannon-beach",
            category: "attraction",
            title: "Cannon Beach · Haystack Rock",
            subtitle: "Day 4 · US-101",
            description:
              "Sea-stack tidepools, puffin colony in spring, the classic Pacific NW sunset backdrop.",
            tip: "Check the tide chart — tidepools only open ~2 hr each side of low.",
            stats: [
              { label: "DETOUR",    value: "+0 mi" },
              { label: "STOP TIME", value: "~1 hr" },
              { label: "ETA",       value: "4:45pm" },
            ],
          },
        ],
      },
      {
        id: "day-5",
        dayNumber: 5,
        date: "2026-06-02",
        label: "Portland, OR — Mount Hood NF, OR",
        coords: [-121.6959, 45.3735],
        miles: 88,
        driveHours: 2.0,
        heroGradient:
          "linear-gradient(135deg, #1e3b34 0%, #2d5045 40%, #c8a96e 100%)",
        heroCaption: "US-26 · MOUNT HOOD · DAY 05",
        heroTag: "↑ EASTBOUND",
        waypoints: [
          {
            id: "wp-timberline",
            slug: "timberline-lodge",
            category: "mountain",
            title: "Timberline Lodge",
            subtitle: "Day 5 · Mt Hood",
            description:
              "Depression-era WPA stone-and-timber lodge at 6,000 ft.",
            stats: [
              { label: "DETOUR",    value: "+0 mi" },
              { label: "STOP TIME", value: "~45 min" },
              { label: "ETA",       value: "2:10pm" },
            ],
          },
        ],
      },
      {
        id: "day-6",
        dayNumber: 6,
        date: "2026-06-03",
        label: "Mount Hood NF — Bend, OR",
        coords: [-121.3153, 44.0582],
        miles: 145,
        driveHours: 3.1,
        heroGradient:
          "linear-gradient(135deg, #1a2435 0%, #2b3b52 50%, #475c78 100%)",
        heroCaption: "US-97 · HIGH DESERT · DAY 06",
        heroTag: "↓ SOUTHBOUND",
        waypoints: [
          {
            id: "wp-smith-rock",
            slug: "smith-rock",
            category: "mountain",
            title: "Smith Rock State Park",
            subtitle: "Day 6 · Terrebonne, OR",
            description:
              "Basalt cliffs along the Crooked River — birthplace of American sport climbing.",
            stats: [
              { label: "DETOUR",    value: "+9 mi" },
              { label: "STOP TIME", value: "~1.5 hr" },
              { label: "ETA",       value: "3:40pm" },
            ],
          },
        ],
      },
      {
        id: "day-7",
        dayNumber: 7,
        date: "2026-06-04",
        label: "Bend, OR — Boise, ID",
        coords: [-116.2023, 43.615],
        miles: 325,
        driveHours: 5.2,
        heroGradient:
          "linear-gradient(135deg, #2a1d13 0%, #4a3120 50%, #c77429 100%)",
        heroCaption: "US-20 · OREGON OUTBACK · DAY 07",
        heroTag: "→ EASTBOUND",
        waypoints: [
          {
            id: "wp-malheur",
            slug: "malheur-nwr",
            category: "attraction",
            title: "Malheur Wildlife Refuge",
            subtitle: "Day 7 · High desert wetland",
            description:
              "Wetland-on-desert migratory stopover. Sandhill cranes, trumpeter swans.",
            stats: [
              { label: "DETOUR",    value: "+22 mi" },
              { label: "STOP TIME", value: "~45 min" },
              { label: "ETA",       value: "11:20am" },
            ],
          },
        ],
      },
      {
        id: "day-8",
        dayNumber: 8,
        date: "2026-06-05",
        label: "Boise, ID — Sun Valley, ID",
        coords: [-114.3518, 43.696],
        miles: 155,
        driveHours: 2.8,
        heroGradient:
          "linear-gradient(135deg, #2a3b1d 0%, #4a6330 50%, #9fb66a 100%)",
        heroCaption: "ID-75 · SAWTOOTHS · DAY 08",
        heroTag: "↑ NORTHBOUND",
        waypoints: [
          {
            id: "wp-craters",
            slug: "craters-of-the-moon",
            category: "oddity",
            title: "Craters of the Moon NM",
            subtitle: "Day 8 · Lava field detour",
            description:
              "Basaltic cinder cones and lava tubes. Apollo crews trained here.",
            stats: [
              { label: "DETOUR",    value: "+60 mi" },
              { label: "STOP TIME", value: "~1 hr" },
              { label: "ETA",       value: "1:45pm" },
            ],
          },
        ],
      },
      {
        id: "day-9",
        dayNumber: 9,
        date: "2026-06-06",
        label: "Sun Valley, ID — Reno, NV",
        coords: [-119.8138, 39.5296],
        miles: 420,
        driveHours: 7.4,
        heroGradient:
          "linear-gradient(135deg, #3a1d1d 0%, #5a3030 50%, #c76666 100%)",
        heroCaption: "US-93 · GREAT BASIN · DAY 09",
        heroTag: "↓ SOUTHBOUND",
        waypoints: [
          {
            id: "wp-jarbidge",
            slug: "jarbidge",
            category: "oddity",
            title: "Jarbidge, NV",
            subtitle: "Day 9 · Most remote town in the lower 48",
            description:
              "Former gold-mining camp. Population ~12. Last-chance fuel.",
            stats: [
              { label: "DETOUR",    value: "+38 mi" },
              { label: "STOP TIME", value: "~30 min" },
              { label: "ETA",       value: "12:15pm" },
            ],
          },
        ],
      },
      {
        id: "day-10",
        dayNumber: 10,
        date: "2026-06-07",
        label: "Reno, NV — San Francisco, CA",
        coords: [-122.4194, 37.7749],
        miles: 220,
        driveHours: 4.0,
        heroGradient:
          "linear-gradient(135deg, #1d2a3a 0%, #30455a 50%, #6a8ab6 100%)",
        heroCaption: "I-80 · SIERRA NEVADA · DAY 10",
        heroTag: "↓ WESTBOUND",
        waypoints: [
          {
            id: "wp-donner",
            slug: "donner-pass",
            category: "attraction",
            title: "Donner Pass Vista",
            subtitle: "Day 10 · Sierra crest",
            description:
              "7,000 ft crossing of the Sierra. Rainbow Bridge overlook + the old Donner Lake highway.",
            stats: [
              { label: "DETOUR",    value: "+0 mi" },
              { label: "STOP TIME", value: "~20 min" },
              { label: "ETA",       value: "11:05am" },
            ],
          },
        ],
      },
    ],
  },
});

type TripStore = { trips: Record<string, Trip> };
const globalForTrips = globalThis as unknown as { __tripStore?: TripStore };
const store: TripStore =
  globalForTrips.__tripStore ?? (globalForTrips.__tripStore = { trips: seed() });

export const TRIPS: Record<string, Trip> = store.trips;
