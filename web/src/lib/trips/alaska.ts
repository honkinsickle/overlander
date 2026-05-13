import type { Day, Trip, Waypoint } from "./types";
import { LA_TO_DEADHORSE_POLYLINE } from "./alaska-route";
import { enrichTrip } from "./enrich";
import { resolveOvernights } from "./resolve-overnights";
import { resolveSuggestions } from "./resolve-suggestions";
import { resolveWeather } from "./resolve-weather";
import {
  loadAlaskaDoc,
  findFixedEventByDate,
  resolvePermitStatuses,
  type ParsedAlaskaDoc,
} from "./alaska-md";

/**
 * 82-day overland trip from Los Angeles to Deadhorse (Prudhoe Bay), AK.
 * Generated from `Overlanding_Reference_Alaska_v2.docx` per the
 * Overlanding Master Prompt v0.7.6 — see Diary/2026-05-01 for context.
 *
 * Source-of-truth for waypoints: the reference doc's day-by-day Notes
 * column, Fixed Date Events table, Photography Priority Locations,
 * Food & Local Eats, and Permits & Border Crossings tables.
 *
 * Plausible-but-invented fields (flagged here for honesty):
 *   - Specific ETA times on waypoints (10:30am etc.)
 *   - Detour mileage estimates where not in the doc
 *   - Some overnight alternative names (real campgrounds picked by region;
 *     selected = doc-driven where the doc names a spot)
 */

const HERO_DESERT =
  "linear-gradient(135deg, #2a1d13 0%, #4a3120 50%, #c77429 100%)";
const HERO_ROCKIES =
  "linear-gradient(135deg, #1e3b34 0%, #2d5045 40%, #c8a96e 100%)";
const HERO_ALASKA_HWY =
  "linear-gradient(135deg, #1a2b28 0%, #2a4540 50%, #6a8b80 100%)";
const HERO_YUKON =
  "linear-gradient(135deg, #1d2535 0%, #2f3b54 50%, #5a6e8e 100%)";
const HERO_KENAI =
  "linear-gradient(135deg, #142820 0%, #1e4a3a 50%, #5a8a76 100%)";
const HERO_ARCTIC =
  "linear-gradient(135deg, #1a2030 0%, #2a3548 50%, #6a7a98 100%)";
const HERO_CASSIAR =
  "linear-gradient(135deg, #1d3528 0%, #2f5040 50%, #6e8a76 100%)";
const HERO_COAST =
  "linear-gradient(135deg, #1a2435 0%, #2b3b52 50%, #475c78 100%)";
const HERO_PNW =
  "linear-gradient(135deg, #1e3b34 0%, #2d5045 40%, #6a8a72 100%)";
const HERO_CASCADES =
  "linear-gradient(135deg, #1a2a1d 0%, #2d4530 50%, #8aa66a 100%)";

/**
 * Sidecar overrides for the Alaska trip. The reference doc (parsed via
 * `alaska-md.ts`) is the source of truth for dates / labels / fixed
 * events / permit status. This object holds everything markdown can't
 * carry: per-day coords, hero images, waypoint prose, overnight picks.
 *
 * Days 1-66 align by date with §04 of the reference doc. Days 67-82 in
 * the original draft were a Seattle → Enchantments side-trip not in
 * v3.4 — content-bearing days have been moved to `RETURN_LEG_DAYS`
 * below; empty stub days were dropped.
 */
const LA_TO_DEADHORSE_RAW: Trip = {
  id: "la-to-deadhorse",
  title: "Los Angeles to Deadhorse",
  startDate: "2026-05-29",
  endDate: "2026-08-18",
  startLocation: "Los Angeles, CA",
  endLocation: "Deadhorse (Prudhoe Bay), AK",
  startCoords: [-118.2437, 34.0522],
  routePolyline: LA_TO_DEADHORSE_POLYLINE,
  heroImage: "https://picsum.photos/seed/dalton-highway-arctic/1200/800",
  weatherHiF: 60,
  weatherLoF: 38,
  kicker: "82 days to the arctic",
  days: [
    {
      id: "day-1",
      dayNumber: 1,
      date: "2026-05-29",
      label: "Los Angeles, CA — St. George, UT",
      coords: [-113.5163, 37.0469],
      miles: 385,
      driveHours: 5.75,
      heroImage: "https://picsum.photos/seed/la-departure/800/500",
      heroGradient: HERO_DESERT,
      heroCaption: "I-15 N · MOJAVE · DAY 01",
      heroTag: "↑ NORTHBOUND",
      description:
        "Trip start. Shakedown day — confirm fridge, solar, storage. ~385 mi / 5h 45m via I-15 N. Cajon Pass, Mojave Preserve viewpoint, Virgin River Gorge into UT.",
      weather: {
        departure: "75-82F dry",
        arrival: "88-95F day / 60-65F night",
      },
      notes: [
        "Breakfast send-off: Grand Central Market / Eggslut before departure",
        "Top off fuel in Barstow",
        "Full water tanks before leaving CA",
        "Check tire pressures after Cajon Pass climb",
        "Backup camp: Sand Hollow State Park · (435) 680-0715 · stateparks.utah.gov",
      ],
      waypoints: [
        {
          id: "wp-eggslut",
          slug: "eggslut-grand-central",
          category: "food",
          title: "Eggslut · Grand Central Market",
          subtitle: "Day 1 · Send-off breakfast in DTLA",
          description:
            "The Fairfax egg sandwich on a brioche bun with sriracha aioli. Last city food before the desert.",
          tip: "Arrive before 9am — the line stretches across the market by 10.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "8:15am" },
          ],
          coords: [-118.2492, 34.0506],
          photoUrl:
            "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=800&q=80",
        },
        {
          id: "wp-guisados",
          slug: "guisados-east-la",
          category: "food",
          title: "Guisados",
          subtitle: "Day 1 · Boyle Heights, optional swap",
          description:
            "Tinga and lamb barbacoa tacos on hand-pressed corn. East LA institution if breakfast doesn't fit.",
          stats: [
            { label: "DETOUR", value: "+3 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "12:30pm" },
          ],
          coords: [-118.2092, 34.0419],
          photoUrl:
            "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800&q=80",
        },
        {
          id: "wp-barstow-fuel",
          slug: "barstow-fuel",
          category: "fuel",
          title: "Barstow Fuel Stop",
          subtitle: "Day 1 · Last cheap fuel before UT",
          description:
            "Top off in Barstow — last reliably cheap gas before crossing into Utah. Multiple stations off I-15 (Lenwood Rd, exit 178).",
          tip: "Pilot or Love's on Lenwood Rd has the most space for a roof-rack rig.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~15 min" },
            { label: "ETA", value: "11:00am" },
          ],
          coords: [-117.0773, 34.8717],
          photoUrl:
            "https://images.unsplash.com/photo-1545459720-aac8509eb02c?w=800&q=80",
        },
        {
          id: "wp-mojave-viewpoint",
          slug: "mojave-preserve-viewpoint",
          category: "mountain",
          title: "Mojave Preserve Viewpoint",
          subtitle: "Day 1 · Scenic break on I-15",
          description:
            "Pull-out east of Baker offering long views into Mojave National Preserve. Quick leg-stretch on the longest stretch of the day.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~15 min" },
            { label: "ETA", value: "12:30pm" },
          ],
          coords: [-116.0775, 35.2683],
          photoUrl:
            "https://images.unsplash.com/photo-1473580044384-7ba9967e16a0?w=800&q=80",
        },
        {
          id: "wp-virgin-river-gorge",
          slug: "virgin-river-gorge",
          category: "mountain",
          title: "Virgin River Gorge",
          subtitle: "Day 1 · Last 20 mi into UT",
          description:
            "I-15 threads through near-vertical walls cut by the Virgin River for the final stretch before St. George. Stop at the Cedar Pocket interpretive site.",
          tip: "Cedar Pocket is the only safe pull-out — don't try the shoulder inside the gorge.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "3:00pm" },
          ],
          coords: [-113.8442, 36.9215],
          photoUrl:
            "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&q=80",
        },
      ],
      overnight: {
        selected: {
          id: "on-st-george-blm",
          name: "BLM dispersed near St. George, UT",
          type: "Dispersed",
          detourMiles: 8,
          cost: "free",
          notes: "Warner Valley Rd / Sand Mountain OHV area; easy rig access, red rock views, no services",
        },
        alternatives: [
          {
            id: "on-sand-hollow",
            name: "Sand Hollow State Park",
            type: "State park",
            detourMiles: 15,
            cost: "$35/night",
            notes: "Reservable backup; (435) 680-0715; stateparks.utah.gov",
          },
          {
            id: "on-snow-canyon",
            name: "Snow Canyon State Park",
            type: "State park",
            detourMiles: 12,
            cost: "$35/night",
            notes: "Reservable; flush toilets, showers",
          },
          {
            id: "on-st-george-rv",
            name: "St. George RV Park",
            type: "RV park",
            detourMiles: 4,
            cost: "$45/night",
            notes: "Full hookups; reset option",
          },
        ],
      },
    },
    {
      id: "day-2",
      dayNumber: 2,
      date: "2026-05-30",
      label: "St. George, UT — Monte Cristo Summit, UT",
      coords: [-111.5036, 41.4631],
      miles: 330,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/wasatch-cache/800/500",
      heroGradient: HERO_DESERT,
      heroCaption: "I-15 N · WASATCH FRONT · DAY 02",
      heroTag: "↑ NORTHBOUND",
      description:
        "~330 mi / 5h via I-15 N to US-89 to SR-39 E. Cove Fort historic stop; optional Logan Canyon scenic byway detour; SR-39 climb out of Huntsville. Elevation ~8000 ft.",
      weather: { arrival: "55-65F day / 30-40F night" },
      notes: [
        "Lunch: Red Iguana SLC (mole negro)",
        "First cold night - test sleep system",
        "Watch for cattle on SR-39 at dusk",
        "Top off fuel in Ogden or Huntsville",
      ],
      waypoints: [
        {
          id: "wp-cove-fort",
          slug: "cove-fort-historic",
          category: "attraction",
          title: "Cove Fort Historic Site",
          subtitle: "Day 2 · Quick history stop",
          description:
            "Basalt fort built in 1867 as a way station on the Mormon Road. Free 30-min tour by LDS missionaries; clean grounds; restrooms.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "10:00am" },
          ],
          coords: [-112.58, 38.6075],
          photoUrl:
            "https://images.unsplash.com/photo-1564564321837-a57b7070ac4f?w=800&q=80",
        },
        {
          id: "wp-red-iguana",
          slug: "red-iguana-slc",
          category: "food",
          title: "Red Iguana · Salt Lake City",
          subtitle: "Day 2 · Lunch detour",
          description:
            "Legendary mole negro. Half-day-old SLC institution. Expect a wait — they don't take reservations.",
          tip: "Walk-in by 11:15 or grab a table at Red Iguana 2 across the river.",
          stats: [
            { label: "DETOUR", value: "+5 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "12:00pm" },
          ],
          coords: [-111.9234, 40.7711],
          photoUrl:
            "https://images.unsplash.com/photo-1574942537135-93c4a3f0e7e8?w=800&q=80",
        },
        {
          id: "wp-publik-coffee",
          slug: "publik-coffee-slc",
          category: "food",
          title: "Publik Coffee · SLC",
          subtitle: "Day 2 · Post-lunch coffee",
          description:
            "Local-favorite roaster on 9th South. Pour-over, espresso, brioche pastries. Good wifi for a quick laptop break.",
          stats: [
            { label: "DETOUR", value: "+2 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "1:30pm" },
          ],
          coords: [-111.8742, 40.7395],
          photoUrl:
            "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=80",
        },
      ],
      overnight: {
        selected: {
          id: "on-monte-cristo",
          name: "Monte Cristo Summit dispersed",
          type: "Dispersed",
          detourMiles: 0,
          cost: "free",
          notes: "Wasatch-Cache NF along SR-39, ~8,000 ft; pine forest pull-outs, cold nights, dark sky, no services",
        },
        alternatives: [
          {
            id: "on-monte-cristo-cg",
            name: "Monte Cristo Campground",
            type: "USFS",
            detourMiles: 1,
            cost: "$22/night",
            notes: "Pit toilets, no water; first-come",
          },
          {
            id: "on-ogden-blm",
            name: "Ogden Valley dispersed",
            type: "Dispersed",
            detourMiles: 18,
            cost: "free",
          },
        ],
      },
    },
    {
      id: "day-3",
      dayNumber: 3,
      date: "2026-05-31",
      label: "Monte Cristo Summit — Whitefish, MT",
      coords: [-114.1131, 48.4944],
      miles: 600,
      driveHours: 10.0,
      heroImage: "https://picsum.photos/seed/whitefish-blankenship/800/500",
      heroGradient: HERO_ROCKIES,
      heroCaption: "US-93 N · BITTERROOTS · DAY 03",
      heroTag: "⚓ FIXED",
      description:
        "~600 mi / 10h via I-15 N to I-90 to US-93 N. Longest day of trip. Lost Trail Pass MT/ID border break; fuel at Missoula. Late-spring rain possible; mosquitoes starting.",
      weather: { arrival: "50-68F day / 35-45F night" },
      notes: [
        "FIXED EVENT",
        "Plan dawn departure ~5:30 AM",
        "Two drivers ideal",
        "Fuel cadence: SLC to Pocatello to Butte to Missoula to Whitefish",
        "Verify Blankenship access road in daylight - last 2 mi gravel",
      ],
      waypoints: [
        {
          id: "wp-lost-trail-pass",
          slug: "lost-trail-pass",
          category: "mountain",
          title: "Lost Trail Pass · MT/ID Border",
          subtitle: "Day 3 · Midday leg-stretch",
          description:
            "7,014-ft pass on the Continental Divide marking the MT/ID border. Pull-out with interpretive signs about the Lewis & Clark route. Critical break on the longest drive day.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "1:30pm" },
          ],
          coords: [-113.9492, 45.6797],
          photoUrl:
            "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80",
        },
        {
          id: "wp-missoula-fuel",
          slug: "missoula-fuel",
          category: "fuel",
          title: "Missoula Fuel Stop",
          subtitle: "Day 3 · Last fuel before Whitefish",
          description:
            "Top off in Missoula — fuel cadence is critical on this leg (SLC → Pocatello → Butte → Missoula → Whitefish, ~200 mi each). Stations off I-90 exit 96 (Reserve St).",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~15 min" },
            { label: "ETA", value: "4:30pm" },
          ],
          coords: [-114.0286, 46.8702],
          photoUrl:
            "https://images.unsplash.com/photo-1520975954732-35dd22299614?w=800&q=80",
        },
        {
          id: "wp-loulas",
          slug: "loulas-whitefish",
          category: "food",
          title: "Loula's · Whitefish",
          subtitle: "Day 3 · Late dinner if open",
          description:
            "French toast, eggs benedict, and full dinner menu in a converted house downtown. If arriving before 9pm, fits as dinner; otherwise hold for Day 4 breakfast.",
          tip: "Closes at 9pm — verify hours before detouring off US-93.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "8:00pm" },
          ],
          coords: [-114.3375, 48.4111],
          photoUrl:
            "https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=800&q=80",
        },
        {
          id: "wp-blankenship",
          slug: "blankenship-bridge",
          category: "camping",
          title: "Blankenship Bridge — Dispersed",
          subtitle: "Day 3 · Fixed event camp",
          description:
            "Free dispersed camping along the North Fork Flathead River near Columbia Falls. No permit. Level gravel pull-outs along the river.",
          tip: "Arrive before 5pm — the prime sites along the water fill up fast on weekends.",
          stats: [
            { label: "DETOUR", value: "+12 mi" },
            { label: "STOP TIME", value: "OVERNIGHT" },
            { label: "ETA", value: "6:00pm" },
          ],
          coords: [-114.1131, 48.4944],
          photoUrl:
            "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800&q=80",
        },
      ],
      overnight: {
        selected: {
          id: "on-blankenship",
          name: "Blankenship Bridge Dispersed",
          type: "Dispersed",
          detourMiles: 12,
          cost: "free",
          notes: "Riverfront pull-outs; no services; pack in/out",
        },
        alternatives: [
          {
            id: "on-glacier-rim",
            name: "Glacier Rim FAS",
            type: "State recreation",
            detourMiles: 3,
            cost: "$15/night",
            notes: "Pit toilets, river access",
          },
          {
            id: "on-whitefish-rv",
            name: "Whitefish KOA",
            type: "RV park",
            detourMiles: 5,
            cost: "$58/night",
            notes: "Full hookups; reset option",
          },
        ],
      },
    },
    {
      id: "day-4",
      dayNumber: 4,
      date: "2026-06-01",
      label: "Whitefish, MT — Banff, AB",
      coords: [-115.5708, 51.1784],
      miles: 250,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/banff-townsite/800/500",
      heroGradient: HERO_ROCKIES,
      heroCaption: "US-93 N · CROWN OF THE CONTINENT · DAY 04",
      heroTag: "↑ NORTHBOUND",
      description:
        "~250 mi / 5h via US-93 N to Crowsnest Pass (Hwy 3) to Hwy 22 to Hwy 1 W. US/CA border crossing at Sweetgrass/Coutts (open 24h). Crowsnest Pass viewpoint; Frank Slide interpretive. Snow flurries possible at Crowsnest.",
      weather: { arrival: "40-60F day / 28-38F night" },
      notes: [
        "Border prep: US passport, vehicle reg, proof of insurance (CDN-valid)",
        "Declare food, alcohol, fuel cans",
        "No firearms",
        "Buy Canadian Rocky Mountain Parks Pass online before crossing",
        "Breakfast: Loulas Whitefish before 9am",
        "Dinner: Tooloulous Banff",
      ],
      waypoints: [
        {
          id: "wp-sweetgrass",
          slug: "sweetgrass-coutts-border",
          category: "neutral",
          title: "Sweetgrass / Coutts Border Crossing",
          subtitle: "Day 4 · USA → Canada",
          description:
            "Open 24 hrs. Standard land crossing. Need passport, vehicle registration, insurance, and Canadian Parks Pass purchased ahead.",
          tip: "Declare any food, alcohol, and fuel cans. Have the Parks Canada pass print-out visible.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "11:15am" },
          ],
        },
        {
          id: "wp-tooloulous",
          slug: "tooloulous-banff",
          category: "food",
          title: "Tooloulou's · Banff",
          subtitle: "Day 4 · Cajun arrival dinner",
          description:
            "Best smoked meat and gumbo in Banff. Dimly-lit, low-ceiling cajun joint a block off Banff Ave.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1.5 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-tunnel-mountain-1",
          name: "Tunnel Mountain Village II",
          type: "NPS",
          detourMiles: 2,
          cost: "$30/night CAD",
          notes: "Reservation required 3-4 mo ahead (877-737-3783); electric sites, showers, walk to townsite",
        },
        alternatives: [
          {
            id: "on-two-jack",
            name: "Two Jack Lakeside",
            type: "NPS",
            detourMiles: 6,
            cost: "$32/night CAD",
            notes: "Lakefront, very popular",
          },
          {
            id: "on-banff-hi",
            name: "HI Banff Alpine Centre",
            type: "Hostel",
            detourMiles: 1,
            cost: "$45/night CAD",
            notes: "Indoor reset; bunks or private rooms",
          },
        ],
      },
    },
    {
      id: "day-5",
      dayNumber: 5,
      date: "2026-06-02",
      label: "Banff, AB · Moraine Lake",
      coords: [-116.1860, 51.3217],
      miles: 140,
      driveHours: 3.0,
      heroImage: "https://picsum.photos/seed/moraine-lake/800/500",
      heroGradient: HERO_ROCKIES,
      heroCaption: "MORAINE LAKE RD · VALLEY OF TEN PEAKS · DAY 05",
      heroTag: "★ PHOTO PRIORITY",
      description:
        "~140 mi RT / 3h driving plus day at lake. Moraine Lake - Valley of Ten Peaks (Rockpile Trail, Consolation Lakes hike); Lake Louise lakeshore; Vermilion Lakes evening drive. Lake may still have ice ring. Afternoon thunderstorm risk.",
      weather: { arrival: "40-60F day / 30-38F night" },
      notes: [
        "Moraine Lake vehicle access is reservation-only in peak season - confirm timed-entry",
        "Best photo window 6-8 AM east-facing light before tour buses",
        "Breakfast: Whitebark Cafe espresso",
        "Lunch: Laggans Mountain Bakery cinnamon roll",
        "Fuel up in Banff - no fuel for 105 mi between Lake Louise and Saskatchewan River Crossing tomorrow",
      ],
      waypoints: [
        {
          id: "wp-moraine-lake",
          slug: "moraine-lake",
          category: "mountain",
          title: "Moraine Lake · Valley of Ten Peaks",
          subtitle: "Day 5 · Vehicle reservation required",
          description:
            "Turquoise glacial lake reflected against the Valley of Ten Peaks. Vehicle access requires a Parks Canada reservation booked 3-4 months ahead — no walk-up in peak season.",
          tip: "6-8am, east-facing morning light. Be at the gate before tour buses arrive.",
          stats: [
            { label: "DETOUR", value: "+9 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "6:30am" },
          ],
        },
        {
          id: "wp-whitebark",
          slug: "whitebark-cafe",
          category: "food",
          title: "Whitebark Café · Banff",
          subtitle: "Day 5 · Espresso stop",
          description:
            "Best espresso in Banff. Tiny shop on Banff Ave. Take it to Cascade Gardens.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "10:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-tunnel-mountain-2",
          name: "Tunnel Mountain Village II (night 2)",
          type: "NPS",
          detourMiles: 2,
          cost: "$30/night CAD",
        },
        alternatives: [
          {
            id: "on-johnston-canyon",
            name: "Johnston Canyon Campground",
            type: "NPS",
            detourMiles: 14,
            cost: "$28/night CAD",
          },
        ],
      },
    },
    {
      id: "day-6",
      dayNumber: 6,
      date: "2026-06-03",
      label: "Lake Louise — Icefields Pkwy — Jasper, AB",
      coords: [-118.0814, 52.8734],
      miles: 175,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/peyto-lake/800/500",
      heroGradient: HERO_ROCKIES,
      heroCaption: "AB-93 · ICEFIELDS PARKWAY · DAY 06",
      heroTag: "★ PHOTO PRIORITY",
      description:
        "~180 mi / 5h via Hwy 1 to Icefields Pkwy (Hwy 93 N). Major scenic stops: Bow Lake, Peyto Lake overlook (wolf-head turquoise lake), Saskatchewan River Crossing, Columbia Icefield / Athabasca Glacier, Sunwapta Falls, Athabasca Falls. Possible snow at Sunwapta Pass (6675 ft).",
      weather: { arrival: "35-65F day / 28-38F night" },
      notes: [
        "FUEL: Last fuel at Lake Louise before 105 mi gap to Saskatchewan River Crossing",
        "Photo priorities: Peyto Lake 10am-noon, Athabasca Glacier overcast ideal",
        "Watch for wildlife (elk, sheep, bears) on Icefields Pkwy",
      ],
      waypoints: [
        {
          id: "wp-laggans",
          slug: "laggans-bakery",
          category: "food",
          title: "Laggan's Mountain Bakery · Lake Louise",
          subtitle: "Day 6 · Mandatory cinnamon roll",
          description:
            "Legendary cinnamon roll the size of a paperback. Fuel for the Icefields Parkway.",
          tip: "Top off fuel at the Lake Louise station — no fuel for 105 mi after.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "8:45am" },
          ],
        },
        {
          id: "wp-peyto",
          slug: "peyto-lake",
          category: "mountain",
          title: "Peyto Lake Overlook",
          subtitle: "Day 6 · Wolf-head turquoise lake",
          description:
            "Wolf-head shaped glacial lake from the Bow Summit overlook. One of the most photographed views in the Canadian Rockies.",
          tip: "Mid-morning 10am-noon. Avoid midday haze.",
          stats: [
            { label: "DETOUR", value: "+1 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "10:45am" },
          ],
        },
        {
          id: "wp-athabasca",
          slug: "athabasca-glacier",
          category: "mountain",
          title: "Athabasca Glacier · Columbia Icefield",
          subtitle: "Day 6 · Terminal moraine walk",
          description:
            "Glacier face from the Toe of the Athabasca trail. Walk the terminal moraine to feel the scale.",
          tip: "Overcast days give the best even light on the ice.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "1:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-whistlers",
          name: "Whistlers Campground · Jasper",
          type: "NPS",
          detourMiles: 3,
          cost: "$30/night CAD",
          notes: "Reserved 3-4 mo ahead; flush toilets, showers, RTT-friendly",
        },
        alternatives: [
          {
            id: "on-wapiti",
            name: "Wapiti Campground",
            type: "NPS",
            detourMiles: 4,
            cost: "$28/night CAD",
            notes: "Quieter alternative",
          },
        ],
      },
    },
    {
      id: "day-7",
      dayNumber: 7,
      date: "2026-06-04",
      label: "Jasper, AB · Rest & resupply",
      coords: [-118.0814, 52.8734],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/jasper-rest/800/500",
      heroGradient: HERO_ROCKIES,
      heroCaption: "JASPER · LAYOVER · DAY 07",
      heroTag: "◆ REST DAY",
      description:
        "Rest day. Maligne Canyon walk (free, 1-2h); Maligne Lake drive (30 mi each way) if energy permits; Jasper SkyTram optional. Vehicle inspection: fluids, tire pressure, undercarriage check before AK Hwy push.",
      weather: { arrival: "35-65F day / 30-40F night" },
      notes: [
        "Resupply at Robinson's IGA",
        "Laundry in town",
        "Breakfast: Cocos Cafe",
        "Dinner: Evil Daves Grill (elk, bison - last real dinner before highway)",
        "Top off fuel in Jasper",
        "Print or download offline maps - cell service drops north of here",
      ],
      waypoints: [
        {
          id: "wp-cocos",
          slug: "cocos-cafe",
          category: "food",
          title: "Coco's Café",
          subtitle: "Day 7 · Best coffee in Jasper",
          description:
            "Homemade breakfast and the best coffee in Jasper. Tiny, locals' spot.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "8:30am" },
          ],
        },
        {
          id: "wp-evil-daves",
          slug: "evil-daves",
          category: "food",
          title: "Evil Dave's Grill",
          subtitle: "Day 7 · Last real dinner before the highway",
          description:
            "Creative Canadian. Elk and bison features. Real menu before days of camp food.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-whistlers-2",
          name: "Whistlers Campground (night 2)",
          type: "NPS",
          detourMiles: 3,
          cost: "$30/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-8",
      dayNumber: 8,
      date: "2026-06-05",
      label: "Jasper, AB — Dawson Creek, BC",
      coords: [-120.2356, 55.7596],
      miles: 410,
      driveHours: 7.0,
      heroImage: "https://picsum.photos/seed/dawson-creek-mile-0/800/500",
      heroGradient: HERO_ALASKA_HWY,
      heroCaption: "BC-43 · MILE 0 · DAY 08",
      heroTag: "↑ NORTHBOUND",
      description:
        "~360 mi / 6.5h via Hwy 16 E to Hwy 40 N (Bighorn Hwy) through Grande Cache and Grande Prairie. Photo at Mile 0 Post in downtown Dawson Creek. Alaska Highway officially begins here.",
      weather: { arrival: "45-70F day / 38-50F night" },
      notes: [
        "Fuel up in Grande Prairie - last major resupply before northern BC",
        "Pick up bear spray if not already carrying",
        "Cell coverage solid in Dawson Creek - use it for downloads/uploads before the gap begins",
      ],
      waypoints: [
        {
          id: "wp-mile-0",
          slug: "mile-0-post",
          category: "attraction",
          title: "Mile 0 Post · Dawson Creek",
          subtitle: "Day 8 · Alaska Highway begins",
          description:
            "The official Mile 0 cairn at the start of the Alaska Highway. Photo at the post — non-negotiable.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "5:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-mile-0-rv",
          name: "Mile 0 RV Park & Campground",
          type: "RV park",
          detourMiles: 2,
          cost: "$40/night CAD",
          notes: "Full hookups, showers, laundry; staging for the highway",
        },
        alternatives: [
          {
            id: "on-northern-lights-rv",
            name: "Northern Lights RV Park",
            type: "RV park",
            detourMiles: 4,
            cost: "$38/night CAD",
          },
        ],
      },
    },
    {
      id: "day-9",
      dayNumber: 9,
      date: "2026-06-06",
      label: "Dawson Creek — Fort Nelson, BC",
      coords: [-122.6970, 58.8052],
      miles: 280,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/fort-nelson/800/500",
      heroGradient: HERO_ALASKA_HWY,
      heroCaption: "AK HWY · BOREAL FOREST · DAY 09",
      heroTag: "↑ NORTHBOUND",
      description:
        "~280 mi / 5h via Alaska Hwy 97 N. Final full-service stop before Watson Lake (next major town 325 mi north). Stops: Kiskatinaw Curved Wooden Bridge (historic), Pink Mountain viewpoint.",
      weather: { arrival: "40-70F day / 38-48F night" },
      notes: [
        "CRITICAL FUEL STOP",
        "Fill main tank PLUS spare cans completely - 325 mi gap ahead with only Toad River (~75 mi) as midpoint option",
        "Stock 2-3 days of food",
        "Bears active along Alaska Hwy from here north",
        "Cell service unreliable past Fort Nelson",
      ],
      waypoints: [
        {
          id: "wp-fort-nelson-fuel",
          slug: "fort-nelson-fuel-prep",
          category: "fuel",
          title: "Fort Nelson · Final Full-Service Stop",
          subtitle: "Day 9 · Last full-service before Watson Lake",
          description:
            "Last full-service town before the 325-mile fuel gap to Watson Lake. Top off everything: main tank, jerry cans, water, propane.",
          tip: "Stop at Toad River (~75 mi north) if it's open, but don't count on it.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "3:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-fort-nelson-pa",
          name: "Triple G Hideaway RV Park",
          type: "RV park",
          detourMiles: 1,
          cost: "$35/night CAD",
          notes: "Full hookups, showers; Saturday night reset before fuel gap",
        },
        alternatives: [
          {
            id: "on-fort-nelson-rec",
            name: "Fort Nelson recreation pull-out",
            type: "Dispersed",
            detourMiles: 6,
            cost: "free",
            notes: "Forest service road; level gravel",
          },
        ],
      },
    },
    {
      id: "day-10",
      dayNumber: 10,
      date: "2026-06-07",
      label: "Fort Nelson — Watson Lake, YT",
      coords: [-128.7989, 60.0631],
      miles: 325,
      driveHours: 7.5,
      heroImage: "https://picsum.photos/seed/muncho-lake/800/500",
      heroGradient: HERO_ALASKA_HWY,
      heroCaption: "AK HWY · STONE MOUNTAIN PP · DAY 10",
      heroTag: "⚠ FUEL GAP 325 MI",
      description:
        "~325 mi / 7h via Alaska Hwy. Stone sheep at Stone Mountain Provincial Park; Muncho Lake (turquoise, often glassy AM); Liard River Hot Springs Provincial Park (worth 1-2h soak); cross into Yukon Territory. Sign Post Forest in Watson Lake.",
      weather: { arrival: "40-65F day / 35-45F night" },
      notes: [
        "FUEL: Fill at Toad River (~75 mi in) if open - confirm hours",
        "Liard Hot Springs is a must-stop - one of the best on the entire AK Hwy",
        "Sign Post Forest tradition: bring a small sign with your hometown",
        "Bison commonly on road - drive cautiously dawn/dusk",
      ],
      waypoints: [
        {
          id: "wp-toad-river",
          slug: "toad-river-fuel",
          category: "fuel",
          title: "Toad River Lodge",
          subtitle: "Day 10 · ~75 mi in — verify open",
          description:
            "Iconic ceiling-of-hats lodge with fuel pumps. Verify open before depending on it. Splash pad of a fuel stop, not a guaranteed one.",
          tip: "If Toad River is closed, don't panic — Liard River Hot Springs has services 100 mi further.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "11:00am" },
          ],
        },
        {
          id: "wp-muncho-lake",
          slug: "muncho-lake",
          category: "mountain",
          title: "Muncho Lake",
          subtitle: "Day 10 · Northern Rockies overlook",
          description:
            "12-mile-long jade-green lake along the highway. Bighorn sheep on the shoulder are common. Stretch the legs.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "1:30pm" },
          ],
        },
        {
          id: "wp-liard",
          slug: "liard-hot-springs",
          category: "attraction",
          title: "Liard River Hot Springs",
          subtitle: "Day 10 · Mid-day soak",
          description:
            "Boardwalk through warm marsh to two natural hot pools in boreal forest. The reward of the long drive.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "2:45pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-watson-lake-cg",
          name: "Watson Lake Downtown RV Park",
          type: "RV park",
          detourMiles: 1,
          cost: "$32/night CAD",
          notes: "Walking distance to Sign Post Forest",
        },
        alternatives: [
          {
            id: "on-watson-lake-yt",
            name: "Watson Lake Territorial Campground",
            type: "Territorial",
            detourMiles: 3,
            cost: "$20/night CAD",
            notes: "Pit toilets, lakefront",
          },
        ],
      },
    },
    {
      id: "day-11",
      dayNumber: 11,
      date: "2026-06-08",
      label: "Watson Lake — Whitehorse, YT",
      coords: [-135.0568, 60.7211],
      miles: 275,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/sign-post-forest/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "AK HWY · YUKON · DAY 11",
      heroTag: "↑ NORTHBOUND",
      description:
        "~275 mi / 5h via Alaska Hwy. Cross continental divide; Teslin Lake and Teslin River bridge; Jakes Corner. Whitehorse is the largest city on the Alaska Hwy - full services, hospital, dealerships.",
      weather: { arrival: "45-70F day / 38-50F night" },
      notes: [
        "First major resupply since Fort Nelson",
        "Yukon Visitor Information Centre on 2nd Avenue has road condition reports for everywhere north and west",
        "Cell service strong in Whitehorse - use it",
        "Refill propane if needed",
      ],
      waypoints: [
        {
          id: "wp-sign-post-forest",
          slug: "sign-post-forest",
          category: "oddity",
          title: "Sign Post Forest",
          subtitle: "Day 11 · Watson Lake oddity",
          description:
            "85,000+ signs nailed to posts by travelers since 1942. Bring a sign from home if you didn't already.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "8:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-whitehorse-rv",
          name: "Pioneer RV Park · Whitehorse",
          type: "RV park",
          detourMiles: 4,
          cost: "$42/night CAD",
          notes: "Full hookups, showers, laundry",
        },
        alternatives: [
          {
            id: "on-takhini",
            name: "Takhini Hot Springs Campground",
            type: "Private",
            detourMiles: 18,
            cost: "$28/night CAD",
            notes: "Hot springs onsite",
          },
          {
            id: "on-whitehorse-disp",
            name: "Wolf Creek dispersed",
            type: "Dispersed",
            detourMiles: 9,
            cost: "free",
            notes: "Forest service pull-out",
          },
        ],
      },
    },
    {
      id: "day-12",
      dayNumber: 12,
      date: "2026-06-09",
      label: "Whitehorse, YT · Rest day",
      coords: [-135.0568, 60.7211],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/whitehorse/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "WHITEHORSE · LAYOVER · DAY 12",
      heroTag: "◆ REST DAY",
      description:
        "Rest day. SS Klondike sternwheeler (national historic site); Yukon Beringia Interpretive Centre; MacBride Museum; walk along Yukon River. Light prep work for Kluane Lake / AK border stretch.",
      weather: { arrival: "45-70F day / 40-50F night" },
      notes: [
        "Breakfast: Burnt Toast Cafe (arrive early)",
        "Coffee: Baked Cafe",
        "Dinner: Woodcutters Blanket (Yukon Arctic char - regional must-try)",
        "Grocery: Independent or Real Canadian Superstore",
        "Top off fuel and fluids",
        "Verify Top of the World Highway opening status if planning that return route",
      ],
      waypoints: [
        {
          id: "wp-burnt-toast",
          slug: "burnt-toast-cafe",
          category: "food",
          title: "Burnt Toast Café",
          subtitle: "Day 12 · Best breakfast in Whitehorse",
          description:
            "Local-roasted coffee and a proper hot breakfast. Arrive early — line forms by 9am.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "8:00am" },
          ],
        },
        {
          id: "wp-baked",
          slug: "baked-cafe",
          category: "food",
          title: "Baked Café",
          subtitle: "Day 12 · Espresso & pastries",
          description:
            "Excellent espresso and pastries. Mid-morning second-coffee stop while running town errands.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "11:00am" },
          ],
        },
        {
          id: "wp-woodcutters",
          slug: "woodcutters-blanket",
          category: "food",
          title: "Woodcutter's Blanket",
          subtitle: "Day 12 · Wild-game dinner",
          description:
            "Yukon Arctic char and seasonal wild game in a former church. Most refined meal you'll have for weeks.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-whitehorse-rv-2",
          name: "Pioneer RV Park (night 2)",
          type: "RV park",
          detourMiles: 4,
          cost: "$42/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-13",
      dayNumber: 13,
      date: "2026-06-10",
      label: "Whitehorse — Haines Junction, YT",
      coords: [-137.5135, 60.7521],
      miles: 100,
      driveHours: 2.0,
      heroImage: "https://picsum.photos/seed/haines-junction/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "AK HWY · KLUANE NP · DAY 13",
      heroTag: "↑ NORTHBOUND",
      description:
        "~100 mi / 2h via Alaska Hwy. Short driving day to position for Kluane Lake. Kluane National Park visitor centre in Haines Junction; St. Elias Mountains views. Bakery stop: Village Bakery (legendary in Haines Junction).",
      weather: { arrival: "40-65F day / 35-45F night" },
      notes: [
        "Easy day by design - rest before remote stretch",
        "Village Bakery has excellent bread and pies",
        "Fuel up in Haines Junction - next reliable fuel is Beaver Creek (~180 mi)",
        "Verify Destruction Bay/Burwash Landing fuel hours at Kluane NP visitor centre",
      ],
      waypoints: [
        {
          id: "wp-kluane-overlook",
          slug: "kluane-overlook",
          category: "mountain",
          title: "Kluane NP Overlook",
          subtitle: "Day 13 · St. Elias Range",
          description:
            "First views of the St. Elias mountains and Kluane Icefield from the Tachal Dhal viewpoint south of Haines Junction.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "12:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-pine-lake",
          name: "Pine Lake Territorial Campground",
          type: "Territorial",
          detourMiles: 4,
          cost: "$20/night CAD",
          notes: "Lakefront, pit toilets, firewood",
        },
        alternatives: [
          {
            id: "on-haines-junction-rv",
            name: "Cozy Corner RV Park",
            type: "RV park",
            detourMiles: 1,
            cost: "$38/night CAD",
          },
        ],
      },
    },
    {
      id: "day-14",
      dayNumber: 14,
      date: "2026-06-11",
      label: "Haines Junction — Burwash Landing, YT",
      coords: [-139.0331, 61.3614],
      miles: 175,
      driveHours: 3.5,
      heroImage: "https://picsum.photos/seed/destruction-bay/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "AK HWY · KLUANE LAKE · DAY 14",
      heroTag: "⚠ VERIFY FUEL HOURS",
      description:
        "~70 mi / 1.5h via Alaska Hwy along Kluane Lake (largest lake in Yukon, stunning turquoise/grey glacial water with St. Elias Mountains backdrop). Short driving day to enjoy the lake.",
      weather: { arrival: "35-60F day / 30-40F night" },
      notes: [
        "Verify fuel hours at Destruction Bay or Burwash Landing - both can be limited/closed",
        "Carry full cans",
        "Photo opportunity: Kluane Lake evening light",
        "Grizzly habitat - strict food storage in vehicle",
        "Sheep Mountain viewing if alert",
      ],
      waypoints: [
        {
          id: "wp-destruction-bay",
          slug: "destruction-bay-fuel",
          category: "fuel",
          title: "Destruction Bay · Fuel Verify",
          subtitle: "Day 14 · Verify hours before depending",
          description:
            "Fuel station hours can be limited. Call ahead or arrive during business hours. Burwash Landing has a backup option a few miles further.",
          tip: "Top off in Haines Junction before leaving — don't run on fumes here.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "1:30pm" },
          ],
        },
        {
          id: "wp-kluane-lake",
          slug: "kluane-lake",
          category: "mountain",
          title: "Kluane Lake Shoreline",
          subtitle: "Day 14 · Largest lake in YT",
          description:
            "60-mile-long alpine lake mirroring the Ruby Range. Pull-outs along the highway for stretches.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "12:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-congdon-creek",
          name: "Congdon Creek Territorial Campground",
          type: "Territorial",
          detourMiles: 8,
          cost: "$20/night CAD",
          notes: "Lakefront, electric bear fence around tent loop",
        },
        alternatives: [
          {
            id: "on-burwash-disp",
            name: "Burwash Landing pullout",
            type: "Dispersed",
            detourMiles: 0,
            cost: "free",
          },
        ],
      },
    },
    {
      id: "day-15",
      dayNumber: 15,
      date: "2026-06-12",
      label: "Beaver Creek, YT — Tok, AK",
      coords: [-142.9853, 63.3367],
      miles: 200,
      driveHours: 4.5,
      heroImage: "https://picsum.photos/seed/tok-alaska/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "AK HWY · BEAVER CREEK BORDER · DAY 15",
      heroTag: "← USA RE-ENTRY",
      description:
        "~200 mi / 4.5h via Alaska Hwy. Beaver Creek (last YT town) then Canada/US border at Port Alcan (open 24h). Frost heaves and rough pavement common between Beaver Creek and Tok - drive slowly. Tok is the AK Hwy hub.",
      weather: { arrival: "40-70F day / 35-50F night" },
      notes: [
        "BORDER CROSSING USA",
        "US passport, vehicle reg, declare food/firearms/alcohol/fuel",
        "Fresh fruit/vegetables restricted - eat or discard before border",
        "Reset clocks - Alaska time (1h behind Yukon)",
        "Visit Tok APLIC (Alaska Public Lands Info Center) for road conditions and bear awareness",
      ],
      waypoints: [
        {
          id: "wp-beaver-creek-border",
          slug: "beaver-creek-border",
          category: "neutral",
          title: "Beaver Creek / Tok Border Crossing",
          subtitle: "Day 15 · Canada → USA",
          description:
            "Open 24 hrs. Standard US CBP re-entry. Have passport and vehicle registration ready.",
          tip: "Frost-heaved road approaching the crossing — slow down, especially with an RTT load.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "11:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-tok-rv",
          name: "Tok RV Village",
          type: "RV park",
          detourMiles: 1,
          cost: "$42/night",
          notes: "Full hookups, showers; staging for Anchorage push",
        },
        alternatives: [
          {
            id: "on-tok-thompsons",
            name: "Thompson's Eagle's Claw Motorcycle Park",
            type: "Private",
            detourMiles: 2,
            cost: "$25/night",
            notes: "RTT-friendly, communal fire",
          },
        ],
      },
    },
    {
      id: "day-16",
      dayNumber: 16,
      date: "2026-06-13",
      label: "Tok — Anchorage, AK",
      coords: [-149.9003, 61.2181],
      miles: 325,
      driveHours: 6.5,
      heroImage: "https://picsum.photos/seed/matanuska-glacier/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "GLENN HWY · MATANUSKA · DAY 16",
      heroTag: "↓ SOUTHBOUND",
      description:
        "~325 mi / 6h via Tok Cutoff to Glenn Hwy. Major scenic stops: Mentasta Pass, Eureka Summit (3322 ft - high point), Matanuska Glacier viewpoints and pullouts (Glacier Park MP 102 paid access if going on ice). Long but spectacular driving day.",
      weather: { arrival: "45-70F day / 40-50F night" },
      notes: [
        "Glenn Hwy is one of the most scenic drives in Alaska - allow stops",
        "Matanuska Glacier visible from pullouts at MP 101 and 113 (free) or paid access via Glacier Park ($30/person)",
        "Cell service returns approaching Palmer",
      ],
      waypoints: [
        {
          id: "wp-matanuska",
          slug: "matanuska-glacier",
          category: "mountain",
          title: "Matanuska Glacier Pullouts",
          subtitle: "Day 16 · Glenn Hwy ~mile 100",
          description:
            "Accessible glacier face from the highway pullouts. Morning eastern light is best; evening throws golden hour on the Chugach peaks.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "2:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-anchorage-disp",
          name: "Eklutna Lake dispersed",
          type: "Dispersed",
          detourMiles: 22,
          cost: "free",
          notes: "Chugach SP pullouts; quiet outside the Anchorage bowl",
        },
        alternatives: [
          {
            id: "on-anchorage-cg",
            name: "Centennial Park Campground",
            type: "Municipal",
            detourMiles: 4,
            cost: "$30/night",
            notes: "In-town option; flush toilets, showers",
          },
          {
            id: "on-anchorage-hotel",
            name: "Anchorage downtown hotel",
            type: "Hotel",
            detourMiles: 2,
            cost: "$180/night",
            notes: "Reset option after long Tok push",
          },
        ],
      },
    },
    {
      id: "day-17",
      dayNumber: 17,
      date: "2026-06-14",
      label: "Anchorage, AK · Resupply & rest",
      coords: [-149.9003, 61.2181],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/anchorage-rest/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "ANCHORAGE · LAYOVER · DAY 17",
      heroTag: "◆ REST DAY",
      description:
        "Full reset day. Resupply, laundry, vehicle wash and inspection. Optional: Anchorage Museum, Tony Knowles Coastal Trail, Earthquake Park. Major outdoor stores (REI, AMH) for any gear gaps before Kenai/Dalton.",
      weather: { arrival: "50-70F day / 45-55F night" },
      notes: [
        "Dinner: Mooses Tooth Pub and Pizzeria (call ahead or arrive 5pm) OR 49th State Brewing (smoked salmon dip, reindeer sausage pizza)",
        "Coffee: Kaladi Brothers",
        "Top off fuel, stock cooler, replace any used supplies",
        "Confirm Kenai Fjords boat tour for Day 21 (Jun 18)",
      ],
      waypoints: [
        {
          id: "wp-kaladi",
          slug: "kaladi-brothers",
          category: "food",
          title: "Kaladi Brothers Coffee",
          subtitle: "Day 17 · Best espresso in Anchorage",
          description:
            "Local roaster with multiple locations. Start the resupply day here.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "8:30am" },
          ],
        },
        {
          id: "wp-mooses-tooth",
          slug: "mooses-tooth",
          category: "food",
          title: "Moose's Tooth Pub & Pizzeria",
          subtitle: "Day 17 · The Anchorage institution",
          description:
            "The pizza everyone in Anchorage references. Call ahead or arrive at 5pm sharp — the wait swells fast.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1.5 hr" },
            { label: "ETA", value: "5:00pm" },
          ],
        },
        {
          id: "wp-49th-state",
          slug: "49th-state-brewing",
          category: "food",
          title: "49th State Brewing",
          subtitle: "Day 17 · Smoked salmon dip + brews",
          description:
            "Smoked salmon dip and reindeer sausage pizza. Big patio, downtown.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1.5 hr" },
            { label: "ETA", value: "8:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-eklutna-2",
          name: "Eklutna Lake (night 2)",
          type: "Dispersed",
          detourMiles: 22,
          cost: "free",
        },
        alternatives: [],
      },
    },
    {
      id: "day-18",
      dayNumber: 18,
      date: "2026-06-15",
      label: "Anchorage — Kenai Peninsula",
      coords: [-150.7, 60.0],
      miles: 145,
      driveHours: 3.0,
      heroImage: "https://picsum.photos/seed/kenai-peninsula/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "AK-1 · TURNAGAIN ARM · DAY 18",
      heroTag: "↓ SOUTHBOUND",
      description:
        "~150 mi / 3.5h via Seward Hwy then Sterling Hwy west. Scenic drive along Turnagain Arm (bore tide if timing aligns; beluga whales possible at Beluga Point); cross Kenai Mountains; descend into Kenai Peninsula river country. Possible Dall sheep on cliffs at Windy Corner.",
      weather: { arrival: "50-65F day / 42-52F night" },
      notes: [
        "Turnagain Arm: check bore tide schedule for best viewing",
        "Stop at Potter Marsh for waterfowl",
        "King salmon run on Kenai/Kasilof in June - watch fishermen if interested",
        "Fuel in Soldotna - largest service town on the peninsula",
      ],
      waypoints: [
        {
          id: "wp-turnagain-arm",
          slug: "turnagain-arm",
          category: "mountain",
          title: "Turnagain Arm pullouts",
          subtitle: "Day 18 · Bore tide & beluga watch",
          description:
            "Mudflats and tidal bore between Anchorage and the Kenai. Beluga whales feed here on incoming tides.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "11:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-cooper-landing",
          name: "Cooper Creek Campground · Chugach NF",
          type: "USFS",
          detourMiles: 2,
          cost: "$22/night",
          notes: "Riverfront, vault toilets, RTT-friendly",
        },
        alternatives: [
          {
            id: "on-quartz-creek",
            name: "Quartz Creek Campground",
            type: "USFS",
            detourMiles: 4,
            cost: "$22/night",
          },
        ],
      },
    },
    {
      id: "day-19",
      dayNumber: 19,
      date: "2026-06-16",
      label: "Kenai Peninsula · Explore",
      coords: [-150.5, 60.4],
      miles: 60,
      driveHours: 1.5,
      heroImage: "https://picsum.photos/seed/kenai-fjords-bay/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "KENAI · EXPLORE · DAY 19",
      heroTag: "◆ EXPLORE",
      description:
        "Explore day. Options: Kenai Old Town and Russian Orthodox church; Ninilchik (historic Russian village, Cook Inlet bluffs); Clam Gulch beach; Captain Cook State Park trails. Light driving, recovery focus before Kenai Fjords boat tour.",
      weather: { arrival: "50-65F day / 42-52F night" },
      notes: [
        "Flexible day - adjust based on weather and energy",
        "Cosmic Kitchen (Homer detour 80 mi south if time allows) for breakfast burritos",
        "Watch for moose - very common on Kenai Peninsula roads at dawn/dusk",
      ],
      waypoints: [
        {
          id: "wp-russian-river",
          slug: "russian-river-falls",
          category: "mountain",
          title: "Russian River Falls",
          subtitle: "Day 19 · Salmon viewing",
          description:
            "5-mile round-trip walk to the falls and the salmon ladder. Bears working the run mid-summer.",
          tip: "Bear spray on the hip, not in the pack.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~3 hr" },
            { label: "ETA", value: "10:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-cooper-creek-2",
          name: "Cooper Creek (night 2)",
          type: "USFS",
          detourMiles: 2,
          cost: "$22/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-20",
      dayNumber: 20,
      date: "2026-06-17",
      label: "Kenai Peninsula — Seward, AK",
      coords: [-149.4427, 60.1042],
      miles: 75,
      driveHours: 2.0,
      heroImage: "https://picsum.photos/seed/seward-harbor/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "AK-9 · RESURRECTION BAY · DAY 20",
      heroTag: "↓ PRE-POSITION",
      description:
        "~127 mi / 2.5h via Sterling Hwy back east to Seward Hwy south. Pre-position for Jun 18 Kenai Fjords Northwestern Fjords boat tour. Arrive Seward afternoon to settle, prep camera/cold gear, check in with tour operator.",
      weather: { arrival: "45-60F day / 40-50F night" },
      notes: [
        "CRITICAL: Confirm boat tour booking (Kenai Fjords Tours or Major Marine Tours) - 8-9h Northwestern Fjords departure typically 11:30 AM Jun 18",
        "Dress in layers: 40s on glacier, wind, spray",
        "Charge cameras tonight",
        "Dinner: Rays Waterfront (halibut fish and chips) on the harbor",
        "Early bed - long day tomorrow",
      ],
      waypoints: [
        {
          id: "wp-exit-glacier",
          slug: "exit-glacier",
          category: "mountain",
          title: "Exit Glacier · Kenai Fjords NP",
          subtitle: "Day 20 · Glacier Overlook trail",
          description:
            "1-mile easy walk to the Glacier Overlook trail viewpoint. Year-marker signs along the road show the glacier's retreat — sobering.",
          stats: [
            { label: "DETOUR", value: "+8 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "1:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-seward-mil",
          name: "Seward Military Resort Campground",
          type: "Municipal",
          detourMiles: 2,
          cost: "$30/night",
          notes: "Walking distance to small boat harbor for Jun 18 boat tour",
        },
        alternatives: [
          {
            id: "on-seward-waterfront",
            name: "Waterfront Park Campground",
            type: "Municipal",
            detourMiles: 1,
            cost: "$25/night",
            notes: "Resurrection Bay views",
          },
        ],
      },
    },
    {
      id: "day-21",
      dayNumber: 21,
      date: "2026-06-18",
      label: "Seward · Kenai Fjords NP",
      coords: [-149.4427, 60.1042],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/kenai-fjords-tour/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "RESURRECTION BAY · BOAT TOUR · DAY 21",
      heroTag: "⚓ FIXED",
      waypoints: [
        {
          id: "wp-northwestern-fjords",
          slug: "northwestern-fjords-tour",
          category: "attraction",
          title: "Northwestern Fjords Boat Tour",
          subtitle: "Day 21 · Full-day · ⚓ FIXED",
          description:
            "8-9 hour boat tour through Resurrection Bay to the Northwestern Glacier in Aialik Bay. Calving tidewater glaciers, Steller sea lions, orca pods. Bring layers — it's cold on deck.",
          tip: "Book Kenai Fjords Tours or Major Marine Tours 2-3 months ahead.",
          stats: [
            { label: "DURATION", value: "8-9 hr" },
            { label: "DEPARTURE", value: "11:30am" },
            { label: "RETURN", value: "8:30pm" },
          ],
        },
        {
          id: "wp-rays-waterfront",
          slug: "rays-waterfront",
          category: "food",
          title: "Ray's Waterfront",
          subtitle: "Day 21 · Halibut after the boat",
          description:
            "Halibut fish and chips on the harbor. Order after the tour — earned.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "9:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-seward-mil-2",
          name: "Seward Military Resort (night 2)",
          type: "Municipal",
          detourMiles: 2,
          cost: "$30/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-22",
      dayNumber: 22,
      date: "2026-06-19",
      label: "Seward — Homer, AK",
      coords: [-151.5483, 59.6425],
      miles: 175,
      driveHours: 4.0,
      heroImage: "https://picsum.photos/seed/homer-spit/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "STERLING HWY · KACHEMAK BAY · DAY 22",
      heroTag: "↓ SOUTHWEST",
      waypoints: [
        {
          id: "wp-homer-spit-arrive",
          slug: "homer-spit-arrive",
          category: "attraction",
          title: "Homer Spit",
          subtitle: "Day 22 · End-of-the-road feeling",
          description:
            "4.5-mile gravel spit jutting into Kachemak Bay. Galleries, fish processors, charter docks, mountains across the water.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "3:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-homer-spit-cg",
          name: "Homer Spit Campground",
          type: "Municipal",
          detourMiles: 0,
          cost: "$30/night",
          notes: "On the spit; basic services; iconic location",
        },
        alternatives: [
          {
            id: "on-homer-baycrest",
            name: "Baycrest Overlook dispersed",
            type: "Dispersed",
            detourMiles: 4,
            cost: "free",
            notes: "Bluff views over Kachemak Bay",
          },
        ],
      },
    },
    {
      id: "day-23",
      dayNumber: 23,
      date: "2026-06-20",
      label: "Homer, AK · Weather buffer",
      coords: [-151.5483, 59.6425],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/homer-rest/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "HOMER · WEATHER BUFFER · DAY 23",
      heroTag: "◆ BUFFER DAY",
      waypoints: [
        {
          id: "wp-two-sisters",
          slug: "two-sisters-bakery",
          category: "food",
          title: "Two Sisters Bakery",
          subtitle: "Day 23 · Pastries & salmon chowder",
          description:
            "Exceptional pastries and salmon chowder. Old Town corner spot near the harbor.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "8:30am" },
          ],
        },
        {
          id: "wp-captain-patties",
          slug: "captain-patties",
          category: "food",
          title: "Captain Pattie's Fish House",
          subtitle: "Day 23 · Best halibut on the Spit",
          description:
            "Halibut straight from the boats next door. Order it grilled, not fried — the fish carries itself.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1.5 hr" },
            { label: "ETA", value: "6:30pm" },
          ],
        },
        {
          id: "wp-kachemak-bay-photo",
          slug: "kachemak-bay-photo",
          category: "mountain",
          title: "Kachemak Bay from Homer Spit",
          subtitle: "Day 23 · Evening golden hour",
          description:
            "Kenai Mountains across the bay; fishing boats on the spit. Evening golden hour looking southeast.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "9:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-homer-spit-2",
          name: "Homer Spit Campground (night 2)",
          type: "Municipal",
          detourMiles: 0,
          cost: "$30/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-24",
      dayNumber: 24,
      date: "2026-06-21",
      label: "Homer — Brooks Falls, Katmai NP",
      coords: [-155.7790, 58.5570],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/brooks-falls-bears/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "FLOATPLANE · BROOKS FALLS · DAY 24",
      heroTag: "⚓ FIXED",
      waypoints: [
        {
          id: "wp-brooks-falls",
          slug: "brooks-falls",
          category: "attraction",
          title: "Brooks Falls Floatplane Day Trip",
          subtitle: "Day 24 · Brown bears at the falls · ⚓ FIXED",
          description:
            "Floatplane from Homer (~1.5 hr each way) to Brooks Camp. Brown bears fishing for sockeye at the falls. Platform permit timed entry.",
          tip: "Floatplane (Homer Air or Katmai Air, ~$350-450/person) book 2-3 months ahead. Brooks Falls platform permit via Recreation.gov 4-6 months ahead.",
          stats: [
            { label: "DURATION", value: "FULL DAY" },
            { label: "DEPARTURE", value: "Homer Airport 8am" },
            { label: "RETURN", value: "~7pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-homer-spit-3",
          name: "Homer Spit Campground (night 3)",
          type: "Municipal",
          detourMiles: 0,
          cost: "$30/night",
          notes: "Return to vehicle staging in Homer after floatplane",
        },
        alternatives: [],
      },
    },
    {
      id: "day-25",
      dayNumber: 25,
      date: "2026-06-22",
      label: "Homer — Anchorage · Reset",
      coords: [-149.9003, 61.2181],
      miles: 225,
      driveHours: 4.5,
      heroImage: "https://picsum.photos/seed/anchorage-reset/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "STERLING HWY · ANCHORAGE · DAY 25",
      heroTag: "⚓ FIXED · RESET",
      waypoints: [
        {
          id: "wp-anchorage-reset",
          slug: "anchorage-full-reset",
          category: "urban",
          title: "Anchorage Reset",
          subtitle: "Day 25 · ⚓ FIXED · Laundry, resupply, vehicle check",
          description:
            "Full reset day: laundry, grocery resupply at Carrs/Fred Meyer, vehicle inspection (oil, tires, fluids), shower at a rec center.",
          tip: "REI Anchorage for any gear gaps before the Dalton push.",
          stats: [
            { label: "TASK", value: "FULL RESET" },
            { label: "PRIORITY", value: "HIGH" },
            { label: "ETA", value: "3:00pm arrive" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-anchorage-hotel-reset",
          name: "Anchorage downtown hotel",
          type: "Hotel",
          detourMiles: 1,
          cost: "$180/night",
          notes: "Real bed, real shower, laundry; reset before Dalton",
        },
        alternatives: [
          {
            id: "on-eklutna-3",
            name: "Eklutna Lake dispersed",
            type: "Dispersed",
            detourMiles: 22,
            cost: "free",
          },
        ],
      },
    },
    {
      id: "day-26",
      dayNumber: 26,
      date: "2026-06-23",
      label: "Anchorage · Continued reset",
      coords: [-149.9003, 61.2181],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/anchorage-prep/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "ANCHORAGE · PRE-DALTON PREP · DAY 26",
      heroTag: "◆ PREP DAY",
      waypoints: [
        {
          id: "wp-dalton-prep",
          slug: "dalton-prep",
          category: "fuel",
          title: "Dalton Highway Prep",
          subtitle: "Day 26 · Final prep before the haul road",
          description:
            "Inspect tires (sidewall scan), top off coolant and washer fluid, fill jerry cans, stock 4 days of food, check spare tire pressure. Cell coverage ends north of Coldfoot — print maps.",
          tip: "Two full-size spare tires recommended. Inner tubes for both.",
          stats: [
            { label: "TASK", value: "PRE-DALTON" },
            { label: "PRIORITY", value: "HIGH" },
            { label: "ETA", value: "Daytime" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-anchorage-hotel-2",
          name: "Anchorage hotel (night 2)",
          type: "Hotel",
          detourMiles: 1,
          cost: "$180/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-27",
      dayNumber: 27,
      date: "2026-06-24",
      label: "Anchorage — Fairbanks, AK",
      coords: [-147.7164, 64.8378],
      miles: 360,
      driveHours: 6.5,
      heroImage: "https://picsum.photos/seed/parks-highway-denali/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "PARKS HWY · DENALI VIEWS · DAY 27",
      heroTag: "↑ NORTHBOUND",
      waypoints: [
        {
          id: "wp-denali-viewpoint",
          slug: "denali-viewpoint-south",
          category: "mountain",
          title: "Denali South Viewpoint · Mile 135",
          subtitle: "Day 27 · Parks Hwy weather-dependent",
          description:
            "On a clear day Denali fills the sky. 30% of summer visitors actually see it — keep eyes on the cloud line.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "12:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-fairbanks-rv",
          name: "Riverview RV Park · Fairbanks",
          type: "RV park",
          detourMiles: 5,
          cost: "$45/night",
          notes: "Full hookups; staging for Dalton departure",
        },
        alternatives: [
          {
            id: "on-fairbanks-disp",
            name: "Chena Lakes Recreation Area",
            type: "State recreation",
            detourMiles: 14,
            cost: "$15/night",
          },
        ],
      },
    },
    {
      id: "day-28",
      dayNumber: 28,
      date: "2026-06-25",
      label: "Fairbanks · Pre-Dalton prep",
      coords: [-147.7164, 64.8378],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/fairbanks-pump-house/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "FAIRBANKS · PRE-DALTON · DAY 28",
      heroTag: "◆ STAGING DAY",
      waypoints: [
        {
          id: "wp-college-coffeehouse",
          slug: "college-coffeehouse",
          category: "food",
          title: "College Coffeehouse",
          subtitle: "Day 28 · Best espresso in Fairbanks",
          description:
            "Wood-paneled local roaster near UAF. Last good coffee for ~1,000 miles.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "9:00am" },
          ],
        },
        {
          id: "wp-pump-house",
          slug: "pump-house",
          category: "food",
          title: "The Pump House Restaurant",
          subtitle: "Day 28 · Pre-Dalton dinner",
          description:
            "Historic steakhouse on the Chena River. Salmon and halibut. The right send-off before the haul road.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
        {
          id: "wp-dalton-final",
          slug: "dalton-final-prep",
          category: "fuel",
          title: "Dalton Final Prep",
          subtitle: "Day 28 · Fuel cans + groceries",
          description:
            "Top off jerry cans (Fred Meyer, Soldier's Mart, or any service station), stock 4 days of groceries, fill water jugs.",
          tip: "Carry 5 extra gallons for the Coldfoot → Deadhorse leg. Non-negotiable.",
          stats: [
            { label: "TASK", value: "FUEL+FOOD" },
            { label: "PRIORITY", value: "HIGH" },
            { label: "ETA", value: "Afternoon" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-fairbanks-rv-2",
          name: "Riverview RV Park (night 2)",
          type: "RV park",
          detourMiles: 5,
          cost: "$45/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-29",
      dayNumber: 29,
      date: "2026-06-26",
      label: "Fairbanks — Coldfoot, AK",
      coords: [-150.1751, 67.2533],
      miles: 260,
      driveHours: 6.5,
      heroImage: "https://picsum.photos/seed/arctic-circle-sign/800/500",
      heroGradient: HERO_ARCTIC,
      heroCaption: "DALTON HWY · ARCTIC CIRCLE · DAY 29",
      heroTag: "⚠ FILL AT COLDFOOT",
      waypoints: [
        {
          id: "wp-yukon-river-bridge",
          slug: "yukon-river-bridge",
          category: "attraction",
          title: "Yukon River Bridge",
          subtitle: "Day 29 · Mile 56 Dalton",
          description:
            "Wooden-decked bridge across the Yukon River. Hot dog stand at the south end (June-Aug only).",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "11:30am" },
          ],
        },
        {
          id: "wp-arctic-circle",
          slug: "arctic-circle-sign",
          category: "attraction",
          title: "Arctic Circle Sign · Mile 115",
          subtitle: "Day 29 · 66°33' N",
          description:
            "The wooden sign and information panels. Sign your name in the binder — tradition.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "1:30pm" },
          ],
        },
        {
          id: "wp-coldfoot-fuel",
          slug: "coldfoot-fuel",
          category: "fuel",
          title: "Coldfoot · Mandatory Fuel",
          subtitle: "Day 29 · ⚠ Only fuel before Deadhorse",
          description:
            "Coldfoot Camp truck stop. ONLY fuel between Fairbanks and Deadhorse (414 mi total). Fill main tank + every can. Verify pump operation.",
          tip: "If a pump is broken, don't push north. Wait for service or turn back.",
          stats: [
            { label: "TASK", value: "FILL EVERYTHING" },
            { label: "PRIORITY", value: "CRITICAL" },
            { label: "ETA", value: "5:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-marion-creek",
          name: "Marion Creek Campground · BLM",
          type: "BLM",
          detourMiles: 5,
          cost: "$8/night",
          notes: "5 mi N of Coldfoot; pit toilets, water; quietest sites in the area",
        },
        alternatives: [
          {
            id: "on-coldfoot-camp",
            name: "Coldfoot Camp lodging",
            type: "Lodge",
            detourMiles: 0,
            cost: "$200/night",
            notes: "Industrial workforce dorms; expensive but indoor reset",
          },
        ],
      },
    },
    {
      id: "day-30",
      dayNumber: 30,
      date: "2026-06-27",
      label: "Coldfoot — Deadhorse, AK",
      coords: [-148.4597, 70.2002],
      miles: 240,
      driveHours: 7.0,
      heroImage: "https://picsum.photos/seed/atigun-pass-brooks/800/500",
      heroGradient: HERO_ARCTIC,
      heroCaption: "DALTON HWY · ATIGUN PASS · DAY 30",
      heroTag: "⚠ NO SERVICES 240 MI",
      waypoints: [
        {
          id: "wp-atigun-pass",
          slug: "atigun-pass",
          category: "mountain",
          title: "Atigun Pass · Brooks Range Crossing",
          subtitle: "Day 30 · 4,800 ft alpine pass",
          description:
            "The Brooks Range surrounds the road in every direction. Late-evening 9-11pm low Arctic sun is unreal in July.",
          tip: "Pass conditions can change in minutes — wind, snow, fog. Don't stop on the road shoulder; use the pullouts.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "12:30pm" },
          ],
        },
        {
          id: "wp-gates-arctic",
          slug: "gates-of-the-arctic",
          category: "mountain",
          title: "Gates of the Arctic Approach",
          subtitle: "Day 30 · Wiseman backdrop",
          description:
            "Arctic wilderness from the Dalton Hwy corridor. Midnight sun July 11pm-1am throws warm low-angle light on the peaks.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "10:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-deadhorse-camp",
          name: "Deadhorse Camp",
          type: "Lodge",
          detourMiles: 0,
          cost: "$220/night",
          notes: "Industrial worker accommodations; meals included; arctic basecamp",
        },
        alternatives: [
          {
            id: "on-prudhoe-hotel",
            name: "Prudhoe Bay Hotel",
            type: "Hotel",
            detourMiles: 1,
            cost: "$240/night",
            notes: "The other option; book ahead",
          },
        ],
      },
    },
    {
      id: "day-31",
      dayNumber: 31,
      date: "2026-06-28",
      label: "Deadhorse, AK",
      coords: [-148.4597, 70.2002],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/arctic-ocean-deadhorse/800/500",
      heroGradient: HERO_ARCTIC,
      heroCaption: "DEADHORSE · ARCTIC OCEAN · DAY 31",
      heroTag: "⚓ NORTHERNMOST POINT",
      waypoints: [
        {
          id: "wp-arctic-ocean-tour",
          slug: "arctic-ocean-tour",
          category: "attraction",
          title: "Arctic Ocean Shuttle Tour",
          subtitle: "Day 31 · Only legal access",
          description:
            "Arctic Caribou Inn shuttle through the oilfield to the Arctic Ocean. Public access to the water is otherwise off-limits — security clearance required.",
          tip: "Book 24+ hours ahead. Background check required by oil companies. Bring passport.",
          stats: [
            { label: "DURATION", value: "~3 hr" },
            { label: "COST", value: "~$70/person" },
            { label: "BRING", value: "PASSPORT" },
          ],
        },
        {
          id: "wp-midnight-sun-photo",
          slug: "midnight-sun-deadhorse",
          category: "mountain",
          title: "Midnight Sun Photography",
          subtitle: "Day 31 · 11pm-1am",
          description:
            "Late June: the sun never sets. Best low-angle light for photography is 11pm-1am in the oilfield's far edges.",
          stats: [
            { label: "BEST WINDOW", value: "11PM-1AM" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "11:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-deadhorse-camp-2",
          name: "Deadhorse Camp (night 2)",
          type: "Lodge",
          detourMiles: 0,
          cost: "$220/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-32",
      dayNumber: 32,
      date: "2026-06-29",
      label: "Deadhorse — Coldfoot, AK",
      coords: [-150.1751, 67.2533],
      miles: 240,
      driveHours: 7.0,
      heroImage: "https://picsum.photos/seed/dalton-southbound/800/500",
      heroGradient: HERO_ARCTIC,
      heroCaption: "DALTON HWY · SOUTHBOUND · DAY 32",
      heroTag: "⚠ FILL AT DEADHORSE",
      waypoints: [
        {
          id: "wp-deadhorse-fuel",
          slug: "deadhorse-departure-fuel",
          category: "fuel",
          title: "Deadhorse Departure Fuel",
          subtitle: "Day 32 · ⚠ Top off everything",
          description:
            "Fill main tank, all jerry cans, water jugs. Coldfoot is 240 mi south; Brooks Range conditions can pin you down.",
          stats: [
            { label: "TASK", value: "FILL ALL" },
            { label: "PRIORITY", value: "CRITICAL" },
            { label: "ETA", value: "8:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-marion-creek-2",
          name: "Marion Creek Campground (night 2)",
          type: "BLM",
          detourMiles: 5,
          cost: "$8/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-33",
      dayNumber: 33,
      date: "2026-06-30",
      label: "Coldfoot — Fairbanks, AK",
      coords: [-147.7164, 64.8378],
      miles: 260,
      driveHours: 6.5,
      heroImage: "https://picsum.photos/seed/dalton-recovery/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "DALTON HWY · POST-DALTON · DAY 33",
      heroTag: "↓ SOUTHBOUND",
      waypoints: [
        {
          id: "wp-lavelles",
          slug: "lavelles-bistro",
          category: "food",
          title: "Lavelle's Bistro · Fairbanks",
          subtitle: "Day 33 · Post-Dalton celebration",
          description:
            "Best refined dining in Fairbanks. White tablecloth, wine list. Earn it by surviving the haul road.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-fairbanks-rv-3",
          name: "Riverview RV Park (night 3)",
          type: "RV park",
          detourMiles: 5,
          cost: "$45/night",
          notes: "Real shower; wash the haul road off the truck",
        },
        alternatives: [
          {
            id: "on-fairbanks-hotel",
            name: "Fairbanks downtown hotel",
            type: "Hotel",
            detourMiles: 1,
            cost: "$160/night",
          },
        ],
      },
    },
    {
      id: "day-34",
      dayNumber: 34,
      date: "2026-07-01",
      label: "Fairbanks — Glennallen, AK",
      coords: [-145.5536, 62.1097],
      miles: 330,
      driveHours: 6.0,
      heroImage: "https://picsum.photos/seed/richardson-highway/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "RICHARDSON HWY · ALASKA RANGE · DAY 34",
      heroTag: "↓ SOUTHBOUND",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-glennallen-disp",
          name: "Tolsona Wilderness Campground area",
          type: "Dispersed",
          detourMiles: 8,
          cost: "free",
          notes: "Forest service pull-outs; mosquito-heavy in July",
        },
        alternatives: [
          {
            id: "on-glennallen-rv",
            name: "Northern Nights Campground",
            type: "RV park",
            detourMiles: 1,
            cost: "$30/night",
          },
        ],
      },
    },
    {
      id: "day-35",
      dayNumber: 35,
      date: "2026-07-02",
      label: "Glennallen — Glacier View, AK",
      coords: [-147.6, 61.7],
      miles: 95,
      driveHours: 2.0,
      heroImage: "https://picsum.photos/seed/glacier-view-staging/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "GLENN HWY · MILE 112 · DAY 35",
      heroTag: "◆ STAGING",
      waypoints: [
        {
          id: "wp-glacier-view-arrive",
          slug: "glacier-view-arrive",
          category: "attraction",
          title: "Glacier View Camp Setup",
          subtitle: "Day 35 · Pre-event evening",
          description:
            "Arrive evening to set up camp ahead of Jul 3 Car Launch event. Confirm GPS coords with event organizer in advance.",
          tip: "Verify event registration before arriving — it's a private gathering on the bluff above Matanuska Glacier.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "OVERNIGHT" },
            { label: "ETA", value: "5:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-glacier-view-camp",
          name: "Glacier View event camp",
          type: "Event",
          detourMiles: 0,
          cost: "Event fee",
          notes: "On-site camping at Car Launch venue; GPS via organizer",
        },
        alternatives: [
          {
            id: "on-matanuska-glacier-pa",
            name: "Matanuska Glacier State Recreation Site",
            type: "State recreation",
            detourMiles: 8,
            cost: "$15/night",
          },
        ],
      },
    },
    {
      id: "day-36",
      dayNumber: 36,
      date: "2026-07-03",
      label: "Glacier View, AK · Car Launch",
      coords: [-147.6, 61.7],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/glacier-view-car-launch/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "GLACIER VIEW · CAR LAUNCH · DAY 36",
      heroTag: "⚓ FIXED",
      waypoints: [
        {
          id: "wp-car-launch",
          slug: "glacier-view-car-launch",
          category: "attraction",
          title: "Glacier View Car Launch · ⚓ FIXED",
          subtitle: "Day 36 · 4th of July weekend tradition",
          description:
            "Annual Independence Day weekend tradition: launching junker cars off a 300-ft cliff above the Matanuska River. Spectators on the bluff.",
          tip: "Bring earplugs and a wide-angle lens. The launches are spaced — there's a lot of waiting.",
          stats: [
            { label: "DURATION", value: "FULL DAY" },
            { label: "TYPE", value: "EVENT" },
            { label: "STATUS", value: "FIXED" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-glacier-view-2",
          name: "Glacier View event camp (night 2)",
          type: "Event",
          detourMiles: 0,
          cost: "Event fee",
        },
        alternatives: [],
      },
    },
    {
      id: "day-37",
      dayNumber: 37,
      date: "2026-07-04",
      label: "Glacier View — Talkeetna, AK",
      coords: [-150.1066, 62.3209],
      miles: 175,
      driveHours: 4.0,
      heroImage: "https://picsum.photos/seed/talkeetna-arrive/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "GLENN+PARKS HWY · TALKEETNA · DAY 37",
      heroTag: "↑ NORTHWEST",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-talkeetna-disp",
          name: "Talkeetna Lakes Park dispersed",
          type: "Dispersed",
          detourMiles: 4,
          cost: "free",
        },
        alternatives: [
          {
            id: "on-talkeetna-rv",
            name: "Talkeetna RV Park",
            type: "RV park",
            detourMiles: 1,
            cost: "$38/night",
          },
        ],
      },
    },
    {
      id: "day-38",
      dayNumber: 38,
      date: "2026-07-05",
      label: "Talkeetna · Denali views",
      coords: [-150.1066, 62.3209],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/talkeetna-denali/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "TALKEETNA · DENALI · DAY 38",
      heroTag: "◆ EXPLORE",
      waypoints: [
        {
          id: "wp-talkeetna-overlook",
          slug: "talkeetna-river-overlook",
          category: "mountain",
          title: "Talkeetna River Overlook · Denali View",
          subtitle: "Day 38 · End of Main St",
          description:
            "Confluence of three rivers and a head-on view of Denali on a clear day. Townie spot but the view is real.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "9:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-talkeetna-disp-2",
          name: "Talkeetna Lakes (night 2)",
          type: "Dispersed",
          detourMiles: 4,
          cost: "free",
        },
        alternatives: [],
      },
    },
    {
      id: "day-39",
      dayNumber: 39,
      date: "2026-07-06",
      label: "Talkeetna — Fairbanks, AK",
      coords: [-147.7164, 64.8378],
      miles: 270,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/parks-hwy-northbound/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "PARKS HWY N · DENALI NP · DAY 39",
      heroTag: "↑ NORTHBOUND",
      waypoints: [
        {
          id: "wp-denali-park",
          slug: "denali-np-entrance",
          category: "mountain",
          title: "Denali NP Entrance",
          subtitle: "Day 39 · Quick visit",
          description:
            "Denali NP entrance and visitor center. Park road is closed past Mile 43 indefinitely (Pretty Rocks landslide), so a short stop only.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "11:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-fairbanks-rv-4",
          name: "Riverview RV Park (return)",
          type: "RV park",
          detourMiles: 5,
          cost: "$45/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-40",
      dayNumber: 40,
      date: "2026-07-07",
      label: "Fairbanks — Tok, AK",
      coords: [-142.9853, 63.3367],
      miles: 205,
      driveHours: 4.0,
      heroImage: "https://picsum.photos/seed/alaska-hwy-tok/800/500",
      heroGradient: HERO_KENAI,
      heroCaption: "AK HWY · TOK · DAY 40",
      heroTag: "↓ EASTBOUND",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-tok-rv-2",
          name: "Tok RV Village (return)",
          type: "RV park",
          detourMiles: 1,
          cost: "$42/night",
          notes: "Stop at Tok APLIC for Taylor Hwy / Top of the World road conditions",
        },
        alternatives: [],
      },
    },
    {
      id: "day-41",
      dayNumber: 41,
      date: "2026-07-08",
      label: "Tok — Chicken, AK",
      coords: [-141.9389, 64.0708],
      miles: 80,
      driveHours: 2.5,
      heroImage: "https://picsum.photos/seed/taylor-highway/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "TAYLOR HWY · CHICKEN · DAY 41",
      heroTag: "⚠ GRAVEL · VERIFY ROAD",
      waypoints: [
        {
          id: "wp-tok-aplic",
          slug: "tok-aplic-conditions",
          category: "fuel",
          title: "Tok APLIC · Road Conditions Check",
          subtitle: "Day 41 · Verify Taylor + Top of the World",
          description:
            "Alaska Public Lands Information Center in Tok. Last reliable source for Taylor Hwy and Top of the World road conditions. Verify before committing.",
          stats: [
            { label: "TASK", value: "ROAD CHECK" },
            { label: "PRIORITY", value: "HIGH" },
            { label: "ETA", value: "8:30am" },
          ],
        },
        {
          id: "wp-chicken",
          slug: "chicken-alaska",
          category: "oddity",
          title: "Chicken, AK · Population Variable",
          subtitle: "Day 41 · End-of-the-road town",
          description:
            "Population of about 17. Three businesses: Chicken Creek Café, Chicken Mercantile Emporium, Town of Chicken Saloon. Verify fuel before committing to Top of the World.",
          tip: "Chicken Creek Café for the cinnamon rolls — earned a reputation among Dalton/Top-of-the-World drivers.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "12:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-chicken-cg",
          name: "Chicken Gold Camp",
          type: "Private",
          detourMiles: 0,
          cost: "$25/night",
          notes: "Gravel pads, generator-run power, RTT-friendly; gold panning if interested",
        },
        alternatives: [
          {
            id: "on-walker-fork",
            name: "Walker Fork BLM",
            type: "BLM",
            detourMiles: 6,
            cost: "$8/night",
          },
        ],
      },
    },
    {
      id: "day-42",
      dayNumber: 42,
      date: "2026-07-09",
      label: "Chicken — Dawson City, YT",
      coords: [-139.4344, 64.0601],
      miles: 110,
      driveHours: 4.0,
      heroImage: "https://picsum.photos/seed/top-of-the-world-hwy/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "TOP OF THE WORLD HWY · DAY 42",
      heroTag: "★ PHOTO PRIORITY",
      waypoints: [
        {
          id: "wp-top-of-the-world",
          slug: "top-of-the-world-hwy",
          category: "mountain",
          title: "Top of the World Highway",
          subtitle: "Day 42 · 200-mile horizon views",
          description:
            "Exposed alpine tundra ridge with 200-mile horizon views. Almost no trees. Golden hour is extraordinary; any time is good.",
          tip: "No fuel for 80 mi gravel. Top off in Chicken before departing.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr photo stops" },
            { label: "ETA", value: "10:00am" },
          ],
        },
        {
          id: "wp-poker-creek",
          slug: "poker-creek-border",
          category: "neutral",
          title: "Poker Creek / Little Gold Border",
          subtitle: "Day 42 · USA → Canada (seasonal)",
          description:
            "Highest border crossing in North America. Open seasonally May-Sept, typically 8am-8pm only. Verify hours before departing Chicken.",
          tip: "If you arrive after 8pm, you sleep in your truck on the US side — no exceptions.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "12:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-yukon-river-cg",
          name: "Yukon River Campground · Dawson City",
          type: "Territorial",
          detourMiles: 0,
          cost: "$20/night CAD",
          notes: "Across the river via free ferry from town; pit toilets",
        },
        alternatives: [
          {
            id: "on-bonanza-gold",
            name: "Bonanza Gold Motel & RV Park",
            type: "RV park",
            detourMiles: 1,
            cost: "$40/night CAD",
          },
        ],
      },
    },
    {
      id: "day-43",
      dayNumber: 43,
      date: "2026-07-10",
      label: "Dawson City, YT · Rest day",
      coords: [-139.4344, 64.0601],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/dawson-city-front-st/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "DAWSON CITY · FRONT STREET · DAY 43",
      heroTag: "◆ REST DAY",
      waypoints: [
        {
          id: "wp-alchemy",
          slug: "alchemy-cafe",
          category: "food",
          title: "Alchemy Café",
          subtitle: "Day 43 · Coffee & baked goods",
          description:
            "Excellent coffee and baked goods. Morning ritual on Front Street.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "8:30am" },
          ],
        },
        {
          id: "wp-klondike-kates",
          slug: "klondike-kates",
          category: "food",
          title: "Klondike Kate's Restaurant",
          subtitle: "Day 43 · The Dawson institution",
          description:
            "Salmon, burgers, Gold Rush atmosphere. Tourist-tilted but the food earns it.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1.5 hr" },
            { label: "ETA", value: "6:30pm" },
          ],
        },
        {
          id: "wp-drunken-goat",
          slug: "drunken-goat",
          category: "food",
          title: "Drunken Goat Pub",
          subtitle: "Day 43 · Local Yukon beers",
          description:
            "Local Yukon beers in a wood-floored pub. Late evening stop.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "9:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-yukon-river-cg-2",
          name: "Yukon River Campground (night 2)",
          type: "Territorial",
          detourMiles: 0,
          cost: "$20/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-44",
      dayNumber: 44,
      date: "2026-07-11",
      label: "Dawson City — Whitehorse, YT",
      coords: [-135.0568, 60.7211],
      miles: 335,
      driveHours: 6.5,
      heroImage: "https://picsum.photos/seed/klondike-highway/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "KLONDIKE HWY · WHITEHORSE · DAY 44",
      heroTag: "↓ SOUTHBOUND",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-whitehorse-rv-3",
          name: "Pioneer RV Park (return)",
          type: "RV park",
          detourMiles: 4,
          cost: "$42/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-45",
      dayNumber: 45,
      date: "2026-07-12",
      label: "Whitehorse, YT · Rest & resupply",
      coords: [-135.0568, 60.7211],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/whitehorse-rest/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "WHITEHORSE · LAYOVER · DAY 45",
      heroTag: "◆ REST DAY",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-whitehorse-rv-4",
          name: "Pioneer RV Park (night 2)",
          type: "RV park",
          detourMiles: 4,
          cost: "$42/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-46",
      dayNumber: 46,
      date: "2026-07-13",
      label: "Whitehorse — Watson Lake, YT",
      coords: [-128.7989, 60.0631],
      miles: 275,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/yukon-southbound/800/500",
      heroGradient: HERO_YUKON,
      heroCaption: "AK HWY · WATSON LAKE · DAY 46",
      heroTag: "↓ SOUTHBOUND",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-watson-lake-cg-2",
          name: "Watson Lake Downtown RV Park (return)",
          type: "RV park",
          detourMiles: 1,
          cost: "$32/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-47",
      dayNumber: 47,
      date: "2026-07-14",
      label: "Watson Lake — Dease Lake, BC",
      coords: [-130.0331, 58.4308],
      miles: 240,
      driveHours: 5.5,
      heroImage: "https://picsum.photos/seed/cassiar-highway/800/500",
      heroGradient: HERO_CASSIAR,
      heroCaption: "CASSIAR HWY BEGINS · DAY 47",
      heroTag: "↓ CASSIAR",
      waypoints: [
        {
          id: "wp-cassiar-begins",
          slug: "cassiar-hwy-begins",
          category: "mountain",
          title: "Cassiar Highway · Mile 0",
          subtitle: "Day 47 · BC-37 begins",
          description:
            "The quieter, narrower, more scenic alternative to the Alaska Hwy. Long service gaps; wildlife on the road.",
          tip: "Drive cautiously — narrow shoulders, frost heaves, and wildlife. Slower pace than the Alaska Hwy.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "11:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-dease-lake-rv",
          name: "Dease Lake RV Park",
          type: "RV park",
          detourMiles: 1,
          cost: "$30/night CAD",
          notes: "Last full-service stop for ~200 mi south",
        },
        alternatives: [
          {
            id: "on-dease-disp",
            name: "Dease Lake forest pull-out",
            type: "Dispersed",
            detourMiles: 4,
            cost: "free",
          },
        ],
      },
    },
    {
      id: "day-48",
      dayNumber: 48,
      date: "2026-07-15",
      label: "Dease Lake — Bell 2 Lodge, BC",
      coords: [-129.8167, 56.7333],
      miles: 175,
      driveHours: 4.0,
      heroImage: "https://picsum.photos/seed/cassiar-bell-2/800/500",
      heroGradient: HERO_CASSIAR,
      heroCaption: "CASSIAR HWY · BELL 2 · DAY 48",
      heroTag: "⚠ FILL AT DEASE LAKE",
      waypoints: [
        {
          id: "wp-dease-fuel",
          slug: "dease-lake-fuel",
          category: "fuel",
          title: "Dease Lake Final Fuel",
          subtitle: "Day 48 · ⚠ Long service gaps ahead",
          description:
            "Fill main tank and jerry cans at Dease Lake. Bell 2 has fuel; Iskut sometimes does. Don't bypass any stop.",
          stats: [
            { label: "TASK", value: "FILL ALL" },
            { label: "PRIORITY", value: "HIGH" },
            { label: "ETA", value: "8:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-bell-2-lodge",
          name: "Bell 2 Lodge",
          type: "Lodge",
          detourMiles: 0,
          cost: "$165/night CAD",
          notes: "Heli-ski lodge in summer; full service; bistro on-site",
        },
        alternatives: [
          {
            id: "on-bell-2-rv",
            name: "Bell 2 RV pads",
            type: "RV park",
            detourMiles: 0,
            cost: "$45/night CAD",
          },
        ],
      },
    },
    {
      id: "day-49",
      dayNumber: 49,
      date: "2026-07-16",
      label: "Bell 2 — Meziadin Junction, BC",
      coords: [-129.2920, 56.0950],
      miles: 90,
      driveHours: 2.5,
      heroImage: "https://picsum.photos/seed/meziadin-junction/800/500",
      heroGradient: HERO_CASSIAR,
      heroCaption: "CASSIAR HWY · MEZIADIN · DAY 49",
      heroTag: "↓ SOUTHBOUND",
      waypoints: [
        {
          id: "wp-iskut-fuel",
          slug: "iskut-fuel-stop",
          category: "fuel",
          title: "Iskut Fuel Stop",
          subtitle: "Day 49 · Top off if open",
          description:
            "Iskut general store with fuel. Verify open before depending on it.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "10:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-meziadin-pa",
          name: "Meziadin Lake Provincial Park",
          type: "Provincial",
          detourMiles: 1,
          cost: "$23/night CAD",
          notes: "Lakefront, pit toilets, beach launch",
        },
        alternatives: [],
      },
    },
    {
      id: "day-50",
      dayNumber: 50,
      date: "2026-07-17",
      label: "Meziadin Junction — Smithers, BC",
      coords: [-127.1697, 54.7811],
      miles: 235,
      driveHours: 4.5,
      heroImage: "https://picsum.photos/seed/smithers-bc/800/500",
      heroGradient: HERO_CASSIAR,
      heroCaption: "HWY 16 E · SMITHERS · DAY 50",
      heroTag: "↓ EASTBOUND",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-tyhee-lake",
          name: "Tyhee Lake Provincial Park",
          type: "Provincial",
          detourMiles: 6,
          cost: "$28/night CAD",
          notes: "Lakefront, flush toilets, RTT-friendly",
        },
        alternatives: [
          {
            id: "on-smithers-rv",
            name: "Riverside RV Resort · Smithers",
            type: "RV park",
            detourMiles: 1,
            cost: "$45/night CAD",
          },
        ],
      },
    },
    {
      id: "day-51",
      dayNumber: 51,
      date: "2026-07-18",
      label: "Smithers, BC · Rest day",
      coords: [-127.1697, 54.7811],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/smithers-rest/800/500",
      heroGradient: HERO_CASSIAR,
      heroCaption: "SMITHERS · LAYOVER · DAY 51",
      heroTag: "◆ REST DAY",
      waypoints: [
        {
          id: "wp-northern-espresso",
          slug: "northern-espresso",
          category: "food",
          title: "Northern Espresso",
          subtitle: "Day 51 · Best coffee in Smithers",
          description:
            "Local roaster in a small downtown space. Best coffee in town.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "9:00am" },
          ],
        },
        {
          id: "wp-trackside",
          slug: "trackside-bistro",
          category: "food",
          title: "Trackside Bistro",
          subtitle: "Day 51 · Farm-to-table dinner",
          description:
            "Locally sourced; excellent pasta and wild game. Far above expectations for a rural BC town.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-tyhee-2",
          name: "Tyhee Lake (night 2)",
          type: "Provincial",
          detourMiles: 6,
          cost: "$28/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-52",
      dayNumber: 52,
      date: "2026-07-19",
      label: "Smithers — Williams Lake, BC",
      coords: [-122.1417, 52.1417],
      miles: 380,
      driveHours: 7.0,
      heroImage: "https://picsum.photos/seed/williams-lake-bc/800/500",
      heroGradient: HERO_CASSIAR,
      heroCaption: "HWY 16 + 97 · WILLIAMS LAKE · DAY 52",
      heroTag: "↓ SOUTHEAST",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-williams-lake-rv",
          name: "Stampeder RV Park · Williams Lake",
          type: "RV park",
          detourMiles: 2,
          cost: "$40/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-53",
      dayNumber: 53,
      date: "2026-07-20",
      label: "Williams Lake — Vancouver, BC",
      coords: [-123.1207, 49.2827],
      miles: 350,
      driveHours: 6.5,
      heroImage: "https://picsum.photos/seed/vancouver-skyline/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "HWY 99 · SEA-TO-SKY · DAY 53",
      heroTag: "↓ COASTAL",
      waypoints: [
        {
          id: "wp-sea-to-sky",
          slug: "sea-to-sky",
          category: "mountain",
          title: "Sea-to-Sky Highway · Whistler approach",
          subtitle: "Day 53 · Howe Sound + Coast Mountains",
          description:
            "Cliffs above Howe Sound and the Coast Mountains rising abruptly from the fjord. Pull-outs at Britannia Beach and Shannon Falls.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "5:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-vancouver-hotel",
          name: "Vancouver downtown hotel",
          type: "Hotel",
          detourMiles: 1,
          cost: "$200/night CAD",
          notes: "Urban reset; secure parking; walkable downtown",
        },
        alternatives: [
          {
            id: "on-vancouver-rv",
            name: "Capilano RV Park",
            type: "RV park",
            detourMiles: 4,
            cost: "$70/night CAD",
            notes: "North Van; bus to downtown",
          },
        ],
      },
    },
    {
      id: "day-54",
      dayNumber: 54,
      date: "2026-07-21",
      label: "Vancouver, BC · Urban reset",
      coords: [-123.1207, 49.2827],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/vancouver-urban/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "VANCOUVER · LAYOVER · DAY 54",
      heroTag: "◆ URBAN RESET",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-vancouver-hotel-2",
          name: "Vancouver hotel (night 2)",
          type: "Hotel",
          detourMiles: 1,
          cost: "$200/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-55",
      dayNumber: 55,
      date: "2026-07-22",
      label: "Vancouver — Victoria, BC",
      coords: [-123.3656, 48.4284],
      miles: 70,
      driveHours: 3.5,
      heroImage: "https://picsum.photos/seed/bc-ferries/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "BC FERRIES · TSAWWASSEN · DAY 55",
      heroTag: "⛴ FERRY DAY",
      waypoints: [
        {
          id: "wp-bc-ferries",
          slug: "bc-ferries-tsawwassen",
          category: "neutral",
          title: "BC Ferries · Tsawwassen → Swartz Bay",
          subtitle: "Day 55 · Vehicle ferry",
          description:
            "1.5-hour crossing through the Gulf Islands. Reservable but walk-on vehicle space available off-peak.",
          tip: "Reserve a sailing — no-reservation lines can mean waiting for the next boat.",
          stats: [
            { label: "DURATION", value: "~1.5 hr" },
            { label: "DEPARTURE", value: "Multiple daily" },
            { label: "COST", value: "~$80/vehicle CAD" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-victoria-hotel",
          name: "Victoria Inner Harbour hotel",
          type: "Hotel",
          detourMiles: 1,
          cost: "$190/night CAD",
        },
        alternatives: [
          {
            id: "on-fort-victoria-rv",
            name: "Fort Victoria RV Park",
            type: "RV park",
            detourMiles: 8,
            cost: "$55/night CAD",
          },
        ],
      },
    },
    {
      id: "day-56",
      dayNumber: 56,
      date: "2026-07-23",
      label: "Victoria, BC · Explore",
      coords: [-123.3656, 48.4284],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/victoria-harbour/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "VICTORIA · LAYOVER · DAY 56",
      heroTag: "◆ EXPLORE",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-victoria-hotel-2",
          name: "Victoria hotel (night 2)",
          type: "Hotel",
          detourMiles: 1,
          cost: "$190/night CAD",
        },
        alternatives: [],
      },
    },
    {
      id: "day-57",
      dayNumber: 57,
      date: "2026-07-24",
      label: "Victoria — Port Angeles, WA",
      coords: [-123.4307, 48.1181],
      miles: 25,
      driveHours: 1.5,
      heroImage: "https://picsum.photos/seed/coho-ferry/800/500",
      heroGradient: HERO_COAST,
      heroCaption: "MV COHO · STRAIT OF JUAN DE FUCA · DAY 57",
      heroTag: "⛴ ← USA RE-ENTRY",
      waypoints: [
        {
          id: "wp-coho-ferry",
          slug: "coho-ferry",
          category: "neutral",
          title: "MV Coho Ferry · Victoria → Port Angeles",
          subtitle: "Day 57 · Vehicle ferry · Canada → USA",
          description:
            "1.5-hour crossing of the Strait of Juan de Fuca. Vehicle ferry only — book vehicle space 4-6 weeks ahead. US CBP at Port Angeles dock.",
          tip: "Arrive 90 min before sailing for vehicle loading and CBP processing.",
          stats: [
            { label: "DURATION", value: "~1.5 hr" },
            { label: "BOOK", value: "4-6 WK AHEAD" },
            { label: "COST", value: "~$70/vehicle" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-port-angeles-disp",
          name: "Olympic NF dispersed near Port Angeles",
          type: "Dispersed",
          detourMiles: 14,
          cost: "free",
          notes: "Forest service road pull-outs; no services",
        },
        alternatives: [
          {
            id: "on-port-angeles-rv",
            name: "Elwha Dam RV Park",
            type: "RV park",
            detourMiles: 8,
            cost: "$45/night",
          },
        ],
      },
    },
    {
      id: "day-58",
      dayNumber: 58,
      date: "2026-07-25",
      label: "Port Angeles, WA · Hurricane Ridge",
      coords: [-123.4307, 48.1181],
      miles: 35,
      driveHours: 1.5,
      heroImage: "https://picsum.photos/seed/hurricane-ridge/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "OLYMPIC NP · HURRICANE RIDGE · DAY 58",
      heroTag: "★ DAY DRIVE",
      waypoints: [
        {
          id: "wp-hurricane-ridge",
          slug: "hurricane-ridge",
          category: "mountain",
          title: "Hurricane Ridge",
          subtitle: "Day 58 · Olympic NP day drive",
          description:
            "5,200-ft alpine ridge with views over the Olympics and the Strait of Juan de Fuca. Wildflowers in late July; black bears on the meadows.",
          stats: [
            { label: "DETOUR", value: "+18 mi each way" },
            { label: "STOP TIME", value: "~3 hr" },
            { label: "ETA", value: "10:00am" },
          ],
        },
        {
          id: "wp-first-street-haven",
          slug: "first-street-haven",
          category: "food",
          title: "First Street Haven",
          subtitle: "Day 58 · Salmon chowder lunch",
          description:
            "Diner-style. Salmon chowder. Gateway-to-Olympic-NP feel.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1 hr" },
            { label: "ETA", value: "1:30pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-olympic-disp-2",
          name: "Olympic NF dispersed (night 2)",
          type: "Dispersed",
          detourMiles: 14,
          cost: "free",
        },
        alternatives: [],
      },
    },
    {
      id: "day-59",
      dayNumber: 59,
      date: "2026-07-26",
      label: "Port Angeles, WA · Buffer day",
      coords: [-123.4307, 48.1181],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/port-angeles-buffer/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "PORT ANGELES · BUFFER · DAY 59",
      heroTag: "◆ BUFFER",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-olympic-disp-3",
          name: "Olympic NF dispersed (night 3)",
          type: "Dispersed",
          detourMiles: 14,
          cost: "free",
        },
        alternatives: [],
      },
    },
    {
      id: "day-60",
      dayNumber: 60,
      date: "2026-07-27",
      label: "Port Angeles — Olympic Peninsula loop",
      coords: [-124.3854, 47.9504],
      miles: 110,
      driveHours: 3.0,
      heroImage: "https://picsum.photos/seed/hoh-rainforest/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "OLYMPIC PEN · HOH RAINFOREST · DAY 60",
      heroTag: "↓ COASTAL LOOP",
      waypoints: [
        {
          id: "wp-hoh",
          slug: "hoh-rainforest",
          category: "mountain",
          title: "Hoh Rainforest",
          subtitle: "Day 60 · Hall of Mosses",
          description:
            "Temperate rainforest with old-growth Sitka spruce and big-leaf maples draped in club moss. Easy 0.8-mi loop.",
          stats: [
            { label: "DETOUR", value: "+30 mi each way" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "11:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-kalaloch",
          name: "Kalaloch Campground · Olympic NP",
          type: "NPS",
          detourMiles: 4,
          cost: "$28/night",
          notes: "Bluff over the Pacific; some RTT-friendly sites",
        },
        alternatives: [
          {
            id: "on-mora",
            name: "Mora Campground",
            type: "NPS",
            detourMiles: 8,
            cost: "$25/night",
          },
        ],
      },
    },
    {
      id: "day-61",
      dayNumber: 61,
      date: "2026-07-28",
      label: "Olympic Peninsula — Portland, OR",
      coords: [-122.6784, 45.5152],
      miles: 220,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/portland-skyline/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "I-5 S · PORTLAND · DAY 61",
      heroTag: "↓ SOUTHBOUND",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-portland-hotel",
          name: "Portland eastside hotel",
          type: "Hotel",
          detourMiles: 1,
          cost: "$170/night",
          notes: "Walkable to SE food carts and Stumptown",
        },
        alternatives: [
          {
            id: "on-portland-rv",
            name: "Jantzen Beach RV Park",
            type: "RV park",
            detourMiles: 4,
            cost: "$60/night",
          },
        ],
      },
    },
    {
      id: "day-62",
      dayNumber: 62,
      date: "2026-07-29",
      label: "Portland, OR · Rest day",
      coords: [-122.6784, 45.5152],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/portland-pok-pok/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "PORTLAND · LAYOVER · DAY 62",
      heroTag: "◆ REST DAY",
      waypoints: [
        {
          id: "wp-stumptown",
          slug: "stumptown-coffee",
          category: "food",
          title: "Stumptown Coffee · SE Division",
          subtitle: "Day 62 · The original",
          description:
            "Original SE Division location. Have a cortado.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "8:30am" },
          ],
        },
        {
          id: "wp-nongs",
          slug: "nongs-khao-man-gai",
          category: "food",
          title: "Nong's Khao Man Gai",
          subtitle: "Day 62 · Portland street food icon",
          description:
            "Poached chicken and rice with the green ginger sauce. Started as a single food cart; the original recipe still wins.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~45 min" },
            { label: "ETA", value: "12:30pm" },
          ],
        },
        {
          id: "wp-pok-pok",
          slug: "pok-pok",
          category: "food",
          title: "Pok Pok",
          subtitle: "Day 62 · Fish sauce wings",
          description:
            "Fish sauce chicken wings are non-negotiable. Whisky-Coke-on-tap pairs.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "7:00pm" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-portland-hotel-2",
          name: "Portland hotel (night 2)",
          type: "Hotel",
          detourMiles: 1,
          cost: "$170/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-63",
      dayNumber: 63,
      date: "2026-07-30",
      label: "Portland, OR · 2nd rest day",
      coords: [-122.6784, 45.5152],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/portland-powells/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "PORTLAND · POWELL'S · DAY 63",
      heroTag: "◆ REST DAY",
      waypoints: [
        {
          id: "wp-powells",
          slug: "powells-books",
          category: "oddity",
          title: "Powell's City of Books",
          subtitle: "Day 63 · World's largest used+new bookstore",
          description:
            "Full city block. Color-coded rooms across multiple floors. Rare Book Room on the third floor.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~2 hr" },
            { label: "ETA", value: "10:00am" },
          ],
        },
        {
          id: "wp-blue-star",
          slug: "blue-star-donuts",
          category: "food",
          title: "Blue Star Donuts",
          subtitle: "Day 63 · Elevated donuts",
          description:
            "Brioche-dough donuts. Far above the hype. Get the blueberry-bourbon-basil if available.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "9:30am" },
          ],
        },
        {
          id: "wp-tasty-n-daughters",
          slug: "tasty-n-daughters",
          category: "food",
          title: "Tasty n Daughters · Brunch",
          subtitle: "Day 63 · World-class brunch",
          description:
            "Mediterranean-leaning brunch from the Toro Bravo team. Sit at the bar for a faster table.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~1.5 hr" },
            { label: "ETA", value: "11:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-portland-hotel-3",
          name: "Portland hotel (night 3)",
          type: "Hotel",
          detourMiles: 1,
          cost: "$170/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-64",
      dayNumber: 64,
      date: "2026-07-31",
      label: "Portland — Hood River, OR",
      coords: [-121.5215, 45.7054],
      miles: 65,
      driveHours: 1.5,
      heroImage: "https://picsum.photos/seed/columbia-river-gorge/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "I-84 E · COLUMBIA RIVER GORGE · DAY 64",
      heroTag: "↑ EASTBOUND",
      waypoints: [
        {
          id: "wp-multnomah",
          slug: "multnomah-falls",
          category: "mountain",
          title: "Multnomah Falls",
          subtitle: "Day 64 · 620-ft cascade",
          description:
            "The classic Columbia Gorge waterfall. Stone bridge across the falls; permits often required for parking in summer.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~30 min" },
            { label: "ETA", value: "10:30am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-hood-river-disp",
          name: "Mt. Hood NF dispersed near Hood River",
          type: "Dispersed",
          detourMiles: 12,
          cost: "free",
        },
        alternatives: [
          {
            id: "on-tucker-park",
            name: "Tucker Park · Hood River County",
            type: "County park",
            detourMiles: 6,
            cost: "$30/night",
          },
        ],
      },
    },
    {
      id: "day-65",
      dayNumber: 65,
      date: "2026-08-01",
      label: "Hood River — Port Angeles, WA",
      coords: [-123.4307, 48.1181],
      miles: 235,
      driveHours: 5.0,
      heroImage: "https://picsum.photos/seed/port-angeles-fixed/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "PORT ANGELES · FIXED EVENT · DAY 65",
      heroTag: "⚓ FIXED",
      waypoints: [
        {
          id: "wp-port-angeles-event",
          slug: "port-angeles-aug-1",
          category: "attraction",
          title: "Port Angeles Event · ⚓ FIXED",
          subtitle: "Day 65 · Aug 1 · TBC",
          description:
            "Fixed event date. Specifics TBC by departure. Confirm permits and details closer to the date.",
          tip: "Verify event details and permit status with organizer 2 weeks before departure.",
          stats: [
            { label: "DURATION", value: "TBC" },
            { label: "STATUS", value: "FIXED · TBC" },
            { label: "ACTION", value: "CONFIRM" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-olympic-disp-4",
          name: "Olympic NF dispersed (return)",
          type: "Dispersed",
          detourMiles: 14,
          cost: "free",
        },
        alternatives: [],
      },
    },
    {
      id: "day-66",
      dayNumber: 66,
      date: "2026-08-02",
      label: "Port Angeles, WA · Buffer",
      coords: [-123.4307, 48.1181],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/port-angeles-buffer-2/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "PORT ANGELES · BUFFER · DAY 66",
      heroTag: "◆ BUFFER",
      waypoints: [],
      overnight: {
        selected: {
          id: "on-olympic-disp-5",
          name: "Olympic NF dispersed (night 5)",
          type: "Dispersed",
          detourMiles: 14,
          cost: "free",
        },
        alternatives: [],
      },
    },
  ],
};

/**
 * Orphan day overrides for the Seattle → Enchantments side-trip that
 * lived in early drafts (days 67-82) but isn't in the v3.4 reference
 * doc. Preserved here so the content can be revived if §03/§04 ever
 * extend past Aug 2. Not currently merged into LA_TO_DEADHORSE.
 *
 * Empty stub days (68 / 71-73 / 77-78 / 80-81) were dropped entirely.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RETURN_LEG_DAYS: Day[] = [
    {
      id: "day-67",
      dayNumber: 67,
      date: "2026-08-03",
      label: "Port Angeles — Seattle, WA",
      coords: [-122.3321, 47.6062],
      miles: 130,
      driveHours: 3.5,
      heroImage: "https://picsum.photos/seed/seattle-skyline/800/500",
      heroGradient: HERO_PNW,
      heroCaption: "WA-104 + I-5 · SEATTLE · DAY 67",
      heroTag: "↓ EASTBOUND",
      waypoints: [
        {
          id: "wp-bainbridge-ferry",
          slug: "bainbridge-ferry",
          category: "neutral",
          title: "Bainbridge Island Ferry",
          subtitle: "Day 67 · Vehicle ferry to Seattle",
          description:
            "35-min crossing into downtown Seattle. Cleaner arrival than driving through Tacoma traffic.",
          stats: [
            { label: "DURATION", value: "35 min" },
            { label: "DEPARTURE", value: "Multiple daily" },
            { label: "COST", value: "~$25/vehicle" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-seattle-hotel",
          name: "Seattle downtown hotel",
          type: "Hotel",
          detourMiles: 1,
          cost: "$210/night",
        },
        alternatives: [
          {
            id: "on-seattle-rv",
            name: "Trailer Inns RV Park · Bellevue",
            type: "RV park",
            detourMiles: 12,
            cost: "$80/night",
          },
        ],
      },
    },
    {
      id: "day-69",
      dayNumber: 69,
      date: "2026-08-05",
      label: "Seattle — Leavenworth, WA",
      coords: [-120.6615, 47.5965],
      miles: 130,
      driveHours: 2.5,
      heroImage: "https://picsum.photos/seed/leavenworth-bavarian/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "US-2 E · STEVENS PASS · DAY 69",
      heroTag: "↑ EASTBOUND",
      waypoints: [
        {
          id: "wp-stevens-pass",
          slug: "stevens-pass",
          category: "mountain",
          title: "Stevens Pass · 4,061 ft",
          subtitle: "Day 69 · Cascade crest",
          description:
            "Cascade crest crossing. Old-growth forest on both sides; pull-outs for the alpine views.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "~20 min" },
            { label: "ETA", value: "11:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-leavenworth-rv",
          name: "Icicle River RV Resort · Leavenworth",
          type: "RV park",
          detourMiles: 2,
          cost: "$65/night",
          notes: "Riverfront, full hookups; staging for Enchantments",
        },
        alternatives: [
          {
            id: "on-leavenworth-disp",
            name: "Wenatchee NF dispersed",
            type: "Dispersed",
            detourMiles: 8,
            cost: "free",
          },
        ],
      },
    },
    {
      id: "day-70",
      dayNumber: 70,
      date: "2026-08-06",
      label: "Leavenworth, WA · Pre-Enchantments",
      coords: [-120.6615, 47.5965],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/enchantments-prep/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "LEAVENWORTH · ENCHANTMENTS PREP · DAY 70",
      heroTag: "◆ STAGING",
      waypoints: [
        {
          id: "wp-permit-confirm",
          slug: "enchantments-permit-confirm",
          category: "fuel",
          title: "Enchantments Permit Confirm",
          subtitle: "Day 70 · Wilderness office",
          description:
            "Confirm the overnight permit at the Leavenworth Ranger Station. Pick up bear canister rental if needed. Final route briefing.",
          tip: "If the permit is for Snow Lakes zone vs Core, the entry trailhead changes — verify which.",
          stats: [
            { label: "TASK", value: "PERMIT" },
            { label: "PRIORITY", value: "HIGH" },
            { label: "ETA", value: "9:00am" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-leavenworth-rv-2",
          name: "Icicle River RV (night 2)",
          type: "RV park",
          detourMiles: 2,
          cost: "$65/night",
        },
        alternatives: [],
      },
    },
    {
      id: "day-74",
      dayNumber: 74,
      date: "2026-08-10",
      label: "Enchantments trailhead",
      coords: [-120.9333, 47.5333],
      miles: 25,
      driveHours: 0.5,
      heroImage: "https://picsum.photos/seed/enchantments-trailhead/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "ALPINE LAKES WILDERNESS · DAY 74",
      heroTag: "↑ TRAILHEAD",
      waypoints: [
        {
          id: "wp-trailhead-camp",
          slug: "trailhead-camp",
          category: "camping",
          title: "Trailhead Camp",
          subtitle: "Day 74 · Pre-hike night",
          description:
            "Last night at the trailhead before the Enchantments hike. Pack the truck, drop the RTT, check gear one more time.",
          stats: [
            { label: "DETOUR", value: "+0 mi" },
            { label: "STOP TIME", value: "OVERNIGHT" },
            { label: "ETA", value: "Afternoon" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-trailhead-disp",
          name: "Snow Lakes Trailhead overnight parking",
          type: "Trailhead",
          detourMiles: 0,
          cost: "free",
          notes: "RTT or sleep in truck; long-term overnight parking permitted",
        },
        alternatives: [],
      },
    },
    {
      id: "day-75",
      dayNumber: 75,
      date: "2026-08-11",
      label: "Enchantments Wilderness · Hike day 1",
      coords: [-120.7833, 47.5167],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/enchantments-core/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "CORE ENCHANTMENTS · HIKE 1 · DAY 75",
      heroTag: "⚓ FIXED EVENT",
      waypoints: [
        {
          id: "wp-enchantments-hike-1",
          slug: "enchantments-hike-1",
          category: "mountain",
          title: "Snow Lakes → Core Enchantments",
          subtitle: "Day 75 · Hike day 1",
          description:
            "9-10 mi day with 5,000 ft of ascent through Snow Lakes Zone into the Core. Camp at one of the alpine lakes (Inspiration, Perfection, Sprite).",
          tip: "Bear canister required. Mosquitoes thick at the lower lakes; alpine zone is clear.",
          stats: [
            { label: "DISTANCE", value: "9-10 mi" },
            { label: "ASCENT", value: "5,000 ft" },
            { label: "DURATION", value: "8-10 hr" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-enchantments-camp",
          name: "Core Enchantments backcountry",
          type: "Backcountry",
          detourMiles: 0,
          cost: "Permit fee",
          notes: "Alpine lake sites; Leave No Trace; bear canister",
        },
        alternatives: [],
      },
    },
    {
      id: "day-76",
      dayNumber: 76,
      date: "2026-08-12",
      label: "Enchantments Wilderness · Hike day 2",
      coords: [-120.7833, 47.5167],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/enchantments-day-2/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "CORE ENCHANTMENTS · HIKE 2 · DAY 76",
      heroTag: "⚓ FIXED EVENT",
      waypoints: [
        {
          id: "wp-enchantments-hike-2",
          slug: "enchantments-hike-2",
          category: "mountain",
          title: "Core Enchantments · Day 2 explore",
          subtitle: "Day 76 · Lake hop",
          description:
            "Day-hike between the alpine lakes — Crystal, Inspiration, Perfection, Sprite, McClellan Peak base. Mountain goats common.",
          stats: [
            { label: "DISTANCE", value: "5-7 mi" },
            { label: "ASCENT", value: "1,500 ft" },
            { label: "DURATION", value: "All day" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-enchantments-camp-2",
          name: "Core Enchantments (night 2)",
          type: "Backcountry",
          detourMiles: 0,
          cost: "Permit fee",
        },
        alternatives: [],
      },
    },
    {
      id: "day-79",
      dayNumber: 79,
      date: "2026-08-15",
      label: "Enchantments — Leavenworth · Exit hike",
      coords: [-120.6615, 47.5965],
      miles: 25,
      driveHours: 0.5,
      heroImage: "https://picsum.photos/seed/enchantments-exit/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "EXIT · COLCHUCK → STUART LAKE TH · DAY 79",
      heroTag: "↓ EXIT",
      waypoints: [
        {
          id: "wp-aasgard-exit",
          slug: "aasgard-pass-exit",
          category: "mountain",
          title: "Aasgard Pass Descent",
          subtitle: "Day 79 · Core → Stuart Lake TH",
          description:
            "8 mi hike with 4,500 ft descent via Aasgard Pass and Colchuck Lake. Knee-rough — trekking poles strongly recommended.",
          stats: [
            { label: "DISTANCE", value: "8 mi" },
            { label: "DESCENT", value: "4,500 ft" },
            { label: "DURATION", value: "6-8 hr" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-leavenworth-rv-6",
          name: "Icicle River RV (return)",
          type: "RV park",
          detourMiles: 2,
          cost: "$65/night",
          notes: "Real shower, real bed-substitute; truck reset",
        },
        alternatives: [],
      },
    },
    {
      id: "day-82",
      dayNumber: 82,
      date: "2026-08-18",
      label: "Enchantments Wilderness",
      coords: [-120.7833, 47.5167],
      miles: 0,
      driveHours: 0,
      heroImage: "https://picsum.photos/seed/enchantments-aug-18/800/500",
      heroGradient: HERO_CASCADES,
      heroCaption: "ENCHANTMENTS · AUG 18 · DAY 82",
      heroTag: "⚓ FIXED · END",
      waypoints: [
        {
          id: "wp-enchantments-aug-18",
          slug: "enchantments-aug-18",
          category: "attraction",
          title: "Enchantments Wilderness · ⚓ FIXED",
          subtitle: "Day 82 · Final fixed event",
          description:
            "Final fixed-date anchor of the trip. 18-21 mi hike option, 5,000+ ft ascent. Competitive overnight permit required (Recreation.gov lottery, typically March).",
          tip: "End-of-trip celebration. Last night under stars before the long drive home.",
          stats: [
            { label: "DISTANCE", value: "18-21 mi" },
            { label: "ASCENT", value: "5,000+ ft" },
            { label: "STATUS", value: "FIXED" },
          ],
        },
      ],
      overnight: {
        selected: {
          id: "on-enchantments-final",
          name: "Enchantments backcountry · final night",
          type: "Backcountry",
          detourMiles: 0,
          cost: "Permit fee",
          notes: "End-of-trip — celebrate the 82 days",
        },
        alternatives: [],
      },
    }
];

/** Resolve drift between markdown days and override days. Markdown is
 *  authoritative for which days exist; overrides keyed by dayNumber
 *  contribute coords / hero / waypoints / overnight. */
function mergeDays(parsed: ParsedAlaskaDoc, overrides: Day[]): Day[] {
  const overridesByNumber = new Map(overrides.map((d) => [d.dayNumber, d]));
  const merged: Day[] = [];
  for (const md of parsed.days) {
    const ov = overridesByNumber.get(md.day);
    const baseDay: Day = ov ?? {
      id: `day-${md.day}`,
      dayNumber: md.day,
      date: md.date,
      label: md.segment,
      waypoints: [],
    };

    // Start from the override's waypoints (or empty), then attach booking
    // status to the day's anchor waypoint when this is a fixed-event day.
    const waypoints: Waypoint[] = baseDay.waypoints.map((w) => ({ ...w }));
    const fixedEvent = findFixedEventByDate(parsed, md.date);
    if (fixedEvent && waypoints.length > 0) {
      const statuses = resolvePermitStatuses(parsed, fixedEvent);
      if (statuses.length > 0) {
        // Convention: first waypoint of a fixed-event day = the anchor.
        // Documented in master-prompt-v1.1.md §G.
        waypoints[0] = {
          ...waypoints[0],
          bookingStatus: statuses.map((s) => ({
            permitName: s.name,
            status: s.status,
          })),
        };
      }
    }

    merged.push({
      ...baseDay,
      // Markdown is canonical for date + label; override props win for
      // everything visual (coords, hero, etc.) but if md and override
      // disagree on date/label, md wins per Option A's rule.
      date: md.date,
      label: ov?.label ?? md.segment,
      waypoints,
    });
  }
  // Log any override day numbers the markdown didn't claim (drift signal).
  for (const ov of overrides) {
    if (!parsed.days.find((d) => d.day === ov.dayNumber)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[alaska] override for day ${ov.dayNumber} has no matching §04 row`,
      );
    }
  }
  return merged;
}

let cachedTrip: { version: string; trip: Trip } | null = null;

/** Build the LA→Deadhorse trip by merging §04 (canonical days) with
 *  the per-day overrides above, attaching §08 booking status via §03's
 *  permit_ref linkage, and running enrichment. Cached against the
 *  parsed doc's version string. */
export async function getAlaskaTrip(): Promise<Trip> {
  const parsed = await loadAlaskaDoc();
  if (cachedTrip && cachedTrip.version === parsed.version) {
    return cachedTrip.trip;
  }
  const days = mergeDays(parsed, LA_TO_DEADHORSE_RAW.days);
  // The merge can drop days (e.g. 82 → 66 when v3.4 trimmed the Enchantments
  // side-trip). Pull endDate from the last merged day so trip-level metadata
  // stays consistent with days.length.
  const endDate = days[days.length - 1]?.date ?? LA_TO_DEADHORSE_RAW.endDate;
  const enriched = enrichTrip({ ...LA_TO_DEADHORSE_RAW, days, endDate });
  // Eager-resolve each day's overnight against USFS/RIDB/Foursquare/OSM so
  // the synthesized camping slide-up shows real description/photo/contact
  // info instead of trip-plan-only metadata. Cached with the trip; cost
  // is paid once per server start.
  const withOvernights = await resolveOvernights(enriched);
  // Same pattern for the SuggestedSection: pre-fetch the top photo-bearing
  // place per slide category per day. Pushes ~264 discovery calls to first
  // trip-load (cached after).
  const withSuggestions = await resolveSuggestions(withOvernights);
  // Pull a per-day weather snapshot for every day with coords. Days within
  // OpenMeteo's 16-day window get a real forecast; days beyond get last-year
  // same-date climatology so the briefing card always has live numbers
  // alongside the static `weather.arrival` planning copy.
  const trip = await resolveWeather(withSuggestions);
  cachedTrip = { version: parsed.version, trip };
  return trip;
}

/** Synchronous, sidecar-only fallback. Used by code paths that can't
 *  await (legacy fixture seeding). Loses §04 canonicity and booking
 *  status but keeps the app rendering if the markdown is missing. */
export const LA_TO_DEADHORSE: Trip = enrichTrip(LA_TO_DEADHORSE_RAW);
