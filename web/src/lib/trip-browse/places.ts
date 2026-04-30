import type { Category } from "@/components/primitives/detail-card";

export type SlideCategoryKey =
  | "oddity"
  | "food"
  | "scenic"
  | "camping"
  | "overnight";

export const TRIP_CATEGORY_TO_SLIDE: Partial<Record<Category, SlideCategoryKey>> = {
  mountain: "scenic",
  food: "food",
  oddity: "oddity",
  camping: "camping",
};

export type BrowsePlace = {
  id: string;
  coords: [number, number];
  photoUrl: string;
  photoAlt: string;
  title: string;
  pills: { label: string; status?: boolean }[];
  stats: { label: string; value: string }[];
  mention: { primary: string; secondary: string };
  description: string;
  pullquote: { text: string; name: string; meta: string };
  placeInfo: {
    address: string;
    phone?: { display: string; href: string };
    website?: { display: string; href: string };
  };
  cta: string;
};

const BASE_PILLS = {
  scenic: [
    { label: "Scenic" },
    { label: "Photo Spot" },
    { label: "Trail" },
  ],
  food: [
    { label: "Casual" },
    { label: "Local Favorite" },
    { label: "Open Late" },
  ],
  oddity: [
    { label: "Roadside" },
    { label: "Free" },
    { label: "Quirky" },
  ],
  camping: [
    { label: "Tent sites" },
    { label: "RV sites" },
    { label: "Reservable" },
  ],
};

const BASE_STATS = (label: string, distance: string) => [
  { label: "DRIVE TIME", value: `+${distance} min` },
  { label: "REVIEWS", value: "4.6" },
  { label: "HOURS TODAY", value: "Always" },
  { label: label.toUpperCase(), value: "Free" },
];

export const BROWSE_PLACES: Record<
  number,
  Partial<Record<SlideCategoryKey, BrowsePlace[]>>
> = {
  1: {
    scenic: [
      {
        id: "columbia-icefield",
        coords: [-117.225, 52.215],
        photoUrl:
          "https://images.unsplash.com/photo-1454942901704-3c44c11b2ad1?w=1200&q=80",
        photoAlt: "Columbia Icefield glacier",
        title: "Columbia Icefield",
        pills: BASE_PILLS.scenic,
        stats: BASE_STATS("PER PERSON", "12"),
        mention: { primary: "Compiled from", secondary: "Atlas Obscura · NPS · Reddit · +81 more" },
        description:
          "Walk onto a 10,000-year-old glacier — guided tours depart hourly from the Skywalk center. Bring layers, the wind off the ice cuts even in July.",
        pullquote: {
          text: "Standing on the glacier was unreal. Felt like another planet.",
          name: "Janelle K.",
          meta: "Visited Aug 2025",
        },
        placeInfo: {
          address: "Icefields Parkway, Jasper, AB",
          phone: { display: "(780) 852-7030", href: "tel:+17808527030" },
          website: { display: "icefieldsparkway.com", href: "https://icefieldsparkway.com" },
        },
        cta: "Add to Sun 5/31",
      },
      {
        id: "lime-point",
        coords: [-122.476, 37.832],
        photoUrl:
          "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?w=1200&q=80",
        photoAlt: "Marin Headlands view of Golden Gate",
        title: "Lime Point Lighthouse",
        pills: BASE_PILLS.scenic,
        stats: BASE_STATS("PARKING", "8"),
        mention: { primary: "Compiled from", secondary: "AllTrails · Roadtrippers · +24 more" },
        description:
          "Quiet pull-out at the north end of the Golden Gate Bridge with the best low-angle photo of the span. Five-minute walk from the lot.",
        pullquote: {
          text: "Best Golden Gate photo I've ever taken — no crowds.",
          name: "Sam D.",
          meta: "Visited Jun 2025",
        },
        placeInfo: {
          address: "Conzelman Rd, Sausalito, CA 94965",
          website: { display: "nps.gov/goga", href: "https://www.nps.gov/goga/" },
        },
        cta: "Add to Sun 5/31",
      },
      {
        id: "hawk-hill",
        coords: [-122.499, 37.826],
        photoUrl:
          "https://images.unsplash.com/photo-1529655683826-aba9b3e77383?w=1200&q=80",
        photoAlt: "Marin Headlands ridge at sunset",
        title: "Hawk Hill",
        pills: BASE_PILLS.scenic,
        stats: BASE_STATS("PARKING", "14"),
        mention: { primary: "Compiled from", secondary: "Audubon · NPS · +52 more" },
        description:
          "923-ft summit with 360° views — Pacific to the west, Bay Bridge to the east, Mount Tam north. Migrating raptors pass through Sept–Oct.",
        pullquote: {
          text: "Drove up at golden hour. Worth every switchback.",
          name: "Priya R.",
          meta: "Visited Oct 2025",
        },
        placeInfo: {
          address: "Conzelman Rd, Sausalito, CA 94965",
          website: { display: "ggro.org", href: "https://www.ggro.org" },
        },
        cta: "Add to Sun 5/31",
      },
    ],
    food: [
      {
        id: "lake-agnes",
        coords: [-116.222, 51.413],
        photoUrl:
          "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80",
        photoAlt: "Mountain lake teahouse",
        title: "Lake Agnes Tea House",
        pills: BASE_PILLS.food,
        stats: BASE_STATS("AVG CHECK", "45"),
        mention: { primary: "Compiled from", secondary: "Yelp · Reddit · +63 more" },
        description:
          "2-mile uphill hike earns a scone and glacier-fed lake view from the 1905 log tea house. Cash only, brings supplies in by horseback.",
        pullquote: {
          text: "The hike up is the meal. The scone is the dessert.",
          name: "Marcus T.",
          meta: "Visited Jul 2025",
        },
        placeInfo: {
          address: "Lake Louise, AB",
          website: { display: "lakeagnesteahouse.com", href: "https://lakeagnesteahouse.com" },
        },
        cta: "Add to trip Sun 5/31",
      },
      {
        id: "tartine",
        coords: [-122.412, 37.762],
        photoUrl:
          "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1200&q=80",
        photoAlt: "Bakery interior",
        title: "Tartine Manufactory",
        pills: BASE_PILLS.food,
        stats: BASE_STATS("AVG CHECK", "10"),
        mention: { primary: "Compiled from", secondary: "Eater · NYT · +41 more" },
        description:
          "Country bread is the move — 4-day fermentation, dark crust, open crumb. Get the morning bun if they're not sold out.",
        pullquote: {
          text: "Their morning bun is what dreams are made of.",
          name: "Erin H.",
          meta: "Visited Mar 2025",
        },
        placeInfo: {
          address: "595 Alabama St, San Francisco, CA",
          phone: { display: "(415) 487-2600", href: "tel:+14154872600" },
          website: { display: "tartinebakery.com", href: "https://tartinebakery.com" },
        },
        cta: "Add to trip Sun 5/31",
      },
      {
        id: "swans-market",
        coords: [-122.273, 37.797],
        photoUrl:
          "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
        photoAlt: "Food hall",
        title: "Swan's Market Hall",
        pills: BASE_PILLS.food,
        stats: BASE_STATS("AVG CHECK", "5"),
        mention: { primary: "Compiled from", secondary: "Eater · KQED · +18 more" },
        description:
          "8 stalls under one roof — oyster bar, pasta, ramen, coffee. Order from anywhere, eat at the long communal tables.",
        pullquote: {
          text: "Like a less crowded Ferry Building. Great pit stop.",
          name: "DJ S.",
          meta: "Visited Apr 2025",
        },
        placeInfo: {
          address: "907 Washington St, Oakland, CA",
          website: { display: "swansmarket.com", href: "https://swansmarket.com" },
        },
        cta: "Add to trip Sun 5/31",
      },
    ],
    oddity: [
      {
        id: "powells",
        coords: [-122.681, 45.523],
        photoUrl:
          "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1200&q=80",
        photoAlt: "Powell's City of Books exterior",
        title: "Powell's City of Books",
        pills: BASE_PILLS.oddity,
        stats: BASE_STATS("ENTRY", "0"),
        mention: { primary: "Compiled from", secondary: "Atlas Obscura · Roadtrippers · +112 more" },
        description:
          "Iconic bookseller covering a full city block — used and new volumes side by side, color-coded room maps to keep you from getting lost.",
        pullquote: {
          text: "Spent 4 hours in the Rose Room and didn't notice.",
          name: "Lila B.",
          meta: "Visited Sep 2025",
        },
        placeInfo: {
          address: "1005 W Burnside St, Portland, OR",
          phone: { display: "(800) 878-7323", href: "tel:+18008787323" },
          website: { display: "powells.com", href: "https://www.powells.com" },
        },
        cta: "Add tour to Sun 5/31",
      },
      {
        id: "prehistoric-gardens",
        coords: [-124.498, 42.738],
        photoUrl:
          "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1200&q=80",
        photoAlt: "Roadside dinosaur sculpture",
        title: "Prehistoric Gardens",
        pills: BASE_PILLS.oddity,
        stats: BASE_STATS("ENTRY", "12"),
        mention: { primary: "Compiled from", secondary: "Atlas Obscura · +37 more" },
        description:
          "Life-size dinosaur sculptures hand-built in the 1950s, hidden in a rainforest. Walk a mossy path past 23 species, no crowds, peak Americana.",
        pullquote: {
          text: "Pure roadside magic. The kids couldn't get enough.",
          name: "Michael F.",
          meta: "Visited Jul 2025",
        },
        placeInfo: {
          address: "36848 US-101, Port Orford, OR",
          website: { display: "prehistoricgardens.com", href: "https://prehistoricgardens.com" },
        },
        cta: "Add tour to Sun 5/31",
      },
      {
        id: "cabazon-dinosaurs",
        coords: [-116.788, 33.917],
        photoUrl:
          "https://images.unsplash.com/photo-1518709268805-4e9042af2176?w=1200&q=80",
        photoAlt: "Roadside attraction",
        title: "Cabazon Dinosaurs",
        pills: BASE_PILLS.oddity,
        stats: BASE_STATS("ENTRY", "0"),
        mention: { primary: "Compiled from", secondary: "Atlas Obscura · LA Times · +29 more" },
        description:
          "Two enormous concrete dinosaurs visible from I-10. The Apatosaurus has a gift shop in its belly. Free to look, $13 to climb inside.",
        pullquote: {
          text: "Pulled off the freeway just to see them. No regrets.",
          name: "Tess W.",
          meta: "Visited May 2025",
        },
        placeInfo: {
          address: "50770 Seminole Dr, Cabazon, CA",
          website: { display: "cabazondinosaurs.com", href: "https://cabazondinosaurs.com" },
        },
        cta: "Add tour to Sun 5/31",
      },
    ],
    camping: [
      {
        id: "tumalo-state",
        coords: [-121.327, 44.119],
        photoUrl:
          "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1200&q=80",
        photoAlt: "Pine forest campground",
        title: "Tumalo State Park",
        pills: BASE_PILLS.camping,
        stats: BASE_STATS("PER NIGHT", "24"),
        mention: { primary: "Compiled from", secondary: "Reserve America · The Dyrt · +44 more" },
        description:
          "State park 4 mi off-route. Shaded sites along the Deschutes River, hot showers, camp store. Reserve early — fills May–Sep.",
        pullquote: {
          text: "Best showers on our 3-week loop. Tent site #18 is gold.",
          name: "Karina P.",
          meta: "Visited Aug 2025",
        },
        placeInfo: {
          address: "64120 OB Riley Rd, Bend, OR",
          phone: { display: "(800) 452-5687", href: "tel:+18004525687" },
          website: { display: "oregonstateparks.org", href: "https://oregonstateparks.org" },
        },
        cta: "Add site for Sun 5/31",
      },
      {
        id: "hurricane-cliffs",
        coords: [-113.290, 37.165],
        photoUrl:
          "https://images.unsplash.com/photo-1496545672447-f699b503d270?w=1200&q=80",
        photoAlt: "Open BLM dispersed camping",
        title: "Hurricane Cliffs BLM",
        pills: BASE_PILLS.camping,
        stats: BASE_STATS("PER NIGHT", "0"),
        mention: { primary: "Compiled from", secondary: "iOverlander · Campendium · +28 more" },
        description:
          "Free dispersed camping on BLM land. Cliff-edge sites with valley views, no facilities. 14-day stay limit, leave-no-trace.",
        pullquote: {
          text: "Cliffside under the stars. Bring water — there's none.",
          name: "Renato M.",
          meta: "Visited Sep 2025",
        },
        placeInfo: {
          address: "Hurricane, UT (BLM dispersed)",
          website: { display: "blm.gov/utah", href: "https://www.blm.gov/utah" },
        },
        cta: "Add site for Sun 5/31",
      },
      {
        id: "ohanapecosh",
        coords: [-121.567, 46.730],
        photoUrl:
          "https://images.unsplash.com/photo-1520975954732-35dd22299614?w=1200&q=80",
        photoAlt: "Old-growth forest campground",
        title: "Ohanapecosh Campground",
        pills: BASE_PILLS.camping,
        stats: BASE_STATS("PER NIGHT", "30"),
        mention: { primary: "Compiled from", secondary: "Recreation.gov · NPS · +66 more" },
        description:
          "NPS campground inside Mount Rainier. Old-growth Douglas firs, river-side sites, walkable to Silver Falls. Last 3 sites left this week.",
        pullquote: {
          text: "Falling asleep to the river is unreal. Site #142 is the one.",
          name: "Hank L.",
          meta: "Visited Jul 2025",
        },
        placeInfo: {
          address: "Mt Rainier National Park, WA",
          website: { display: "recreation.gov", href: "https://www.recreation.gov" },
        },
        cta: "Add site for Sun 5/31",
      },
    ],
  },
};
