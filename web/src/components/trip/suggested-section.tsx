import { ChevronDown } from "lucide-react";
import { GroupCard, type GroupItem } from "./group-card";
import { SuggestionCard } from "./suggestion-card";
import type { Category } from "@/components/primitives/detail-card";

type Suggestion = {
  id: string;
  category: Category;
  title: string;
  hours?: string;
  description: string;
  heroImage: string;
  browseLabel: string;
  featured?: boolean;
};

type Group = {
  id: string;
  variant: "overnight" | "fuel";
  groupTitle: string;
  groupSubtitle: string;
  heroImage: string;
  browseLabel: string;
  items: GroupItem[];
};

const SUGGESTIONS_BY_DAY: Record<number, Suggestion[]> = {
  1: [
    {
      id: "powells",
      category: "oddity",
      title: "Powell's City of Books",
      hours: "Open · 10A – 9P",
      description:
        "Iconic bookseller covering a full city block — used and new volumes, plus gifts for bibliophiles.",
      heroImage:
        "https://images.unsplash.com/photo-1507842217343-583bb7270b66?w=1000&q=80",
      browseLabel: "Browse Oddities",
      featured: true,
    },
    {
      id: "lake-agnes",
      category: "food",
      title: "Lake Agnes Tea House",
      hours: "Open · 10A – 9P",
      description:
        "2-mile uphill hike earns a scone and glacier-fed lake view from the 1905 log tea house.",
      heroImage:
        "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "columbia-icefield",
      category: "mountain",
      title: "Columbia Icefield",
      hours: "Open · 10A – 9P",
      description:
        "Walk onto a 10,000-year-old glacier — tour departs hourly from the Skywalk center.",
      heroImage:
        "https://images.unsplash.com/photo-1454942901704-3c44c11b2ad1?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "banff-townsite",
      category: "urban",
      title: "Banff Townsite",
      hours: "Open · 10A – 9P",
      description:
        "Last real supply stop before the Icefields Parkway — hot showers, pharmacy, and a proper coffee.",
      heroImage:
        "https://images.unsplash.com/photo-1609825488888-3a766db05542?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
    {
      id: "diamond-lake-overlook",
      category: "attraction",
      title: "Diamond Lake Overlook",
      hours: "Open · sunrise – sunset",
      description:
        "Mile-wide alpine lake framed by Mount Bailey to the west and Mount Thielsen to the east — one of Oregon's clearest reflections.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  2: [
    {
      id: "trees-of-mystery",
      category: "oddity",
      title: "Trees of Mystery",
      hours: "Open · 9A – 6P",
      description:
        "Roadside Americana with a 49-foot Paul Bunyan, a SkyTrail gondola, and a museum of Yurok artifacts.",
      heroImage:
        "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1000&q=80",
      browseLabel: "Browse Oddities",
      featured: true,
    },
    {
      id: "sisters-bakery",
      category: "food",
      title: "Sisters Bakery",
      hours: "Open · 5A – 4P",
      description:
        "Famous marionberry cinnamon rolls and dawn-baked sourdough — line out the door by 7am, worth it.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "smith-rock",
      category: "mountain",
      title: "Smith Rock State Park",
      hours: "Open · sunrise – sunset",
      description:
        "Birthplace of American sport climbing — Misery Ridge loop is 3.7 miles of ridge views and tuff spires.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "old-mill-bend",
      category: "urban",
      title: "Old Mill District",
      hours: "Shops · 10A – 8P",
      description:
        "Former lumber mill turned riverwalk — breweries, gear shops, and a clean fuel + grocery resupply.",
      heroImage:
        "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
    {
      id: "painted-hills",
      category: "attraction",
      title: "Painted Hills",
      hours: "Open · sunrise – sunset",
      description:
        "Striped ochre, gold, and crimson clay hills laid down 35 million years ago — best photographed in late-afternoon light.",
      heroImage:
        "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  3: [
    {
      id: "crater-rim-drive",
      category: "mountain",
      title: "Crater Lake Rim Drive",
      hours: "Open · late June – October",
      description:
        "33-mile loop around the deepest lake in the U.S. with 30+ overlooks, two lodges, and a steep trail down to the boat launch at Cleetwood Cove.",
      heroImage:
        "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
      featured: true,
    },
    {
      id: "klamath-marsh",
      category: "attraction",
      title: "Klamath Marsh Refuge",
      hours: "Open · sunrise – sunset",
      description:
        "Birding capital of the Pacific Flyway — bald eagles in winter, white pelicans in summer, sandhill cranes year-round.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "etna-brewing",
      category: "food",
      title: "Etna Brewing Company",
      hours: "Open · 11A – 9P",
      description:
        "Tiny mountain-town brewpub on the way south — wood-fired pizza, six house ales, and the only proper meal between Klamath and Mt. Shasta.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "mt-shasta-city",
      category: "urban",
      title: "Mount Shasta City",
      hours: "Shops · 9A – 7P",
      description:
        "Last full resupply before the Redwoods — gear shops, an excellent food co-op, and a city park with the Sacramento River headwaters.",
      heroImage:
        "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
    {
      id: "castle-crags",
      category: "mountain",
      title: "Castle Crags State Park",
      hours: "Open · sunrise – sunset",
      description:
        "Granite spires that look airlifted from the Sierras — Crags Trail climbs 2,200 ft in 2.7 miles to a saddle view of Mt. Shasta.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  4: [
    {
      id: "drive-thru-tree",
      category: "oddity",
      title: "Chandelier Drive-Thru Tree",
      hours: "Open · 8A – 8P",
      description:
        "315-ft, 2,400-year-old redwood with a 6×9-ft hole carved through it in 1937. Every overlander stops here once.",
      heroImage:
        "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1000&q=80",
      browseLabel: "Browse Oddities",
      featured: true,
    },
    {
      id: "avenue-giants",
      category: "mountain",
      title: "Avenue of the Giants",
      hours: "Open · 24h",
      description:
        "31-mile parallel route off US-101 through old-growth groves — pull off at Founders Grove and walk the half-mile loop under 360-ft trees.",
      heroImage:
        "https://images.unsplash.com/photo-1454942901704-3c44c11b2ad1?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "heceta-head",
      category: "attraction",
      title: "Heceta Head Lighthouse",
      hours: "Open · 11A – 5P",
      description:
        "1894 lighthouse on a sea cliff — easy quarter-mile trail from the parking lot, plus a B&B in the keeper's house if you can stay the night.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "tillamook",
      category: "food",
      title: "Tillamook Creamery",
      hours: "Open · 10A – 8P",
      description:
        "Self-guided factory tour, free cheese samples, and a scoop shop with two-dozen flavors. Coastal-route detour worth the 4 extra miles.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "newport-aquarium",
      category: "attraction",
      title: "Oregon Coast Aquarium",
      hours: "Open · 10A – 5P",
      description:
        "Otters, jellies, and a walk-through shark tunnel — kid-tested, weather-proof, and a clean restroom-and-coffee stop on the way north.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  5: [
    {
      id: "multnomah-falls",
      category: "attraction",
      title: "Multnomah Falls",
      hours: "Open · sunrise – sunset",
      description:
        "620-ft two-tiered falls right off I-84 — Benson Bridge spans the lower drop, and the trail up to the top is 1.2 miles of switchbacks.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
      featured: true,
    },
    {
      id: "voodoo-doughnut",
      category: "oddity",
      title: "Voodoo Doughnut",
      hours: "Open · 24h",
      description:
        "Cash-only doughnut shop with a bacon maple bar, a Captain My Captain cereal special, and a line that moves faster than it looks.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Oddities",
    },
    {
      id: "pittock-mansion",
      category: "attraction",
      title: "Pittock Mansion",
      hours: "Open · 10A – 4P",
      description:
        "Gilded-Age mansion above downtown Portland with a free city-and-Mt-Hood overlook. Skip the house tour, hike the 0.7-mi loop trail.",
      heroImage:
        "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "timberline-lodge",
      category: "urban",
      title: "Timberline Lodge",
      hours: "Open · year-round",
      description:
        "WPA-built ski lodge at 6,000 ft on Mt. Hood — Ram's Head bar serves a respectable bourbon, and the patio faces the Palmer glacier.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
    {
      id: "rhododendron-garden",
      category: "attraction",
      title: "Crystal Springs Garden",
      hours: "Open · 6A – 10P",
      description:
        "9-acre garden with 2,500 rhododendrons in peak bloom mid-April through May. Free Tuesdays after 12, $5 weekends.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  6: [
    {
      id: "mt-hood-skibowl",
      category: "mountain",
      title: "Mt. Hood Skibowl",
      hours: "Summer · 11A – 7P",
      description:
        "Alpine slide, zipline, and disc golf in summer; lift-served skiing in winter. The off-season is the cheap-thrills season.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
      featured: true,
    },
    {
      id: "lava-river-cave",
      category: "oddity",
      title: "Lava River Cave",
      hours: "Open · 9A – 4P (May–Sep)",
      description:
        "Mile-long lava tube outside Bend — bring a real flashlight (rentals are weak) and a jacket; 42°F year-round, no signal.",
      heroImage:
        "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1000&q=80",
      browseLabel: "Browse Oddities",
    },
    {
      id: "newberry-volcanic",
      category: "mountain",
      title: "Newberry Volcanic Monument",
      hours: "Open · sunrise – sunset",
      description:
        "Caldera with two crater lakes, an obsidian flow you can walk on, and a paved road to the 7,985-ft Paulina Peak summit.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "detroit-lake",
      category: "attraction",
      title: "Detroit Lake",
      hours: "Open · 24h",
      description:
        "Reservoir on the North Santiam — boat ramps, a state park campground, and a marina that rents kayaks by the half day.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "sisters-coffee",
      category: "food",
      title: "Sisters Coffee Company",
      hours: "Open · 6A – 5P",
      description:
        "Roastery + cafe in a converted bank building. Get the cortado and the kouign-amann; the wi-fi is fast and the patio is dog-friendly.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
  ],
  7: [
    {
      id: "hells-canyon",
      category: "mountain",
      title: "Hells Canyon Overlook",
      hours: "Open · sunrise – sunset",
      description:
        "Deepest river gorge in North America — 8,000 ft from rim to the Snake River. The overlook is a 30-mi gravel-road detour worth it.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
      featured: true,
    },
    {
      id: "old-idaho-pen",
      category: "oddity",
      title: "Old Idaho Penitentiary",
      hours: "Open · 12P – 5P",
      description:
        "Decommissioned 1872 prison with a self-guided tour through cell blocks, the gallows, and a quietly excellent weapons museum.",
      heroImage:
        "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1000&q=80",
      browseLabel: "Browse Oddities",
    },
    {
      id: "boise-greenbelt",
      category: "urban",
      title: "Boise Greenbelt",
      hours: "Open · 24h",
      description:
        "25-mile paved path along the Boise River through downtown — bike rentals at the BSU end, breweries at the Garden City end.",
      heroImage:
        "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
    {
      id: "boise-fry-co",
      category: "food",
      title: "Boise Fry Company",
      hours: "Open · 11A – 9P",
      description:
        "Fries are the entrée, burgers are the side. Six potato varieties, eight cuts, and a malt-vinegar dispenser at every table.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "strawberry-mountain",
      category: "mountain",
      title: "Strawberry Mountain Wilderness",
      hours: "Open · sunrise – sunset",
      description:
        "Lake basin under 9,000-ft peaks — Strawberry Lake trail is 2.4 miles round-trip and a no-fee, no-permit pull-off.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  8: [
    {
      id: "craters-of-moon",
      category: "attraction",
      title: "Craters of the Moon",
      hours: "Open · sunrise – sunset",
      description:
        "Lava field that NASA used to train Apollo astronauts. Drive the 7-mile loop, walk the Inferno Cone, and bring a flashlight for the caves.",
      heroImage:
        "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
      featured: true,
    },
    {
      id: "sun-valley-resort",
      category: "urban",
      title: "Sun Valley Resort",
      hours: "Open · year-round",
      description:
        "1936 destination resort with an outdoor ice rink (in summer too), live music on the lawn, and a heated pool with a Bald Mountain view.",
      heroImage:
        "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
    {
      id: "ketchum-grumpys",
      category: "food",
      title: "Grumpy's",
      hours: "Open · 11A – 10P",
      description:
        "Cash-only dive bar in Ketchum with a $4 pint, a bowl of free popcorn, and the best deck for watching ski-town traffic go by.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "sawtooth-wilderness",
      category: "mountain",
      title: "Sawtooth Wilderness",
      hours: "Open · sunrise – sunset",
      description:
        "More than 50 alpine lakes under granite peaks. Redfish Lake is the easy-access version; Stanley Lake has the picture you've seen.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "shoshone-falls",
      category: "attraction",
      title: "Shoshone Falls",
      hours: "Open · 7A – sunset",
      description:
        "212-ft falls on the Snake River — taller than Niagara, best viewing in May–June at peak runoff. $5 entry per car.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
  9: [
    {
      id: "lake-tahoe-loop",
      category: "mountain",
      title: "Lake Tahoe Scenic Loop",
      hours: "Open · 24h",
      description:
        "72-mile drive around the lake — Emerald Bay overlook on the south end, Sand Harbor swim on the north. Allow 4 hours with stops.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
      featured: true,
    },
    {
      id: "virginia-city",
      category: "oddity",
      title: "Virginia City",
      hours: "Shops · 10A – 6P",
      description:
        "Comstock Lode silver-mining town preserved in 1880s amber — wood plank sidewalks, working saloons, and the Mark Twain newsroom.",
      heroImage:
        "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1000&q=80",
      browseLabel: "Browse Oddities",
    },
    {
      id: "pyramid-lake",
      category: "attraction",
      title: "Pyramid Lake",
      hours: "Open · sunrise – sunset",
      description:
        "Saline desert lake on the Paiute reservation — tufa formations on the east shore, Lahontan cutthroat trout in the water. $9 day-use pass.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "donner-memorial",
      category: "attraction",
      title: "Donner Memorial State Park",
      hours: "Visitor Ctr · 10A – 4P",
      description:
        "Restrained, well-curated museum about the 1846 Donner Party at the spot where they wintered. Lake trail loops 2.5 miles.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "carson-capitol",
      category: "urban",
      title: "Nevada State Capitol",
      hours: "Open · 8A – 5P",
      description:
        "Silver-domed 1871 capitol in downtown Carson City. Free tour, plus a quiet riverwalk and the Nevada State Museum two blocks over.",
      heroImage:
        "https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1000&q=80",
      browseLabel: "Browse Urban",
    },
  ],
  10: [
    {
      id: "bodie-ghost-town",
      category: "oddity",
      title: "Bodie Ghost Town",
      hours: "Open · 9A – 6P",
      description:
        "Best-preserved gold-rush ghost town in the West — left in arrested decay since 1942. 13-mile dirt road in, $8 entry, no services on site.",
      heroImage:
        "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1000&q=80",
      browseLabel: "Browse Oddities",
      featured: true,
    },
    {
      id: "mono-lake",
      category: "attraction",
      title: "Mono Lake Tufa Reserve",
      hours: "Open · sunrise – sunset",
      description:
        "Million-year-old saline lake with limestone tufa towers exposed by water diversion. South Tufa loop is a flat 1-mile, $3 entry.",
      heroImage:
        "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "mammoth-mountain",
      category: "mountain",
      title: "Mammoth Mountain",
      hours: "Gondola · 9A – 4P",
      description:
        "Year-round gondola to 11,053 ft — bike park in summer, lift-served skiing in winter. Tamarack Lodge has the best non-resort food.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
    {
      id: "schats-bakkery",
      category: "food",
      title: "Erick Schat's Bakkery",
      hours: "Open · 6A – 6P",
      description:
        "Bishop institution since 1938 — get the original Sheepherder bread and the maple bear claw. Long lines move fast, parking is dicey.",
      heroImage:
        "https://images.unsplash.com/photo-1568254183919-78a4f43a2877?w=1000&q=80",
      browseLabel: "Browse Food",
    },
    {
      id: "alabama-hills",
      category: "mountain",
      title: "Alabama Hills",
      hours: "Open · 24h",
      description:
        "Surreal granite outcrops where 400+ Westerns were filmed. Mobius Arch trail is 0.6 mi loop with Mt. Whitney framed through the arch.",
      heroImage:
        "https://images.unsplash.com/photo-1518406432532-9cbef74e9b8f?w=1000&q=80",
      browseLabel: "Browse Sights & Landmarks",
    },
  ],
};

const GROUPS_BY_DAY: Record<number, Group[]> = {
  1: [
    {
      id: "tumalo-creek",
      variant: "overnight",
      groupTitle: "Tumalo Creek Area",
      groupSubtitle: "Bend, OR · 4 options within 25 mi",
      heroImage:
        "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=1000&q=80",
      browseLabel: "Browse Overnight",
      items: [
        {
          id: "tumalo-state",
          category: "camping",
          title: "Tumalo State Park",
          meta: "State park · +4 mi detour · reservable",
          tip: "$24/night · hot showers · Cascade views",
        },
        {
          id: "hurricane-cliffs",
          category: "camping",
          title: "Hurricane Cliffs BLM",
          meta: "Dispersed · +12 mi detour · no reservation",
          tip: "Free · 14-day stay limit",
        },
        {
          id: "ohanapecosh",
          category: "camping",
          title: "Ohanapecosh Campground NPS",
          meta: "National Park · +18 mi detour · reservable",
          tip: "$30/night · last 3 sites left this week",
        },
      ],
    },
    {
      id: "bend-fuel",
      variant: "fuel",
      groupTitle: "Bend Fuel Stops",
      groupSubtitle: "Bend, OR · 4 stations within 10 mi",
      heroImage:
        "https://images.unsplash.com/photo-1545459720-aac8509eb02c?w=1000&q=80",
      browseLabel: "Browse Fuel Stops",
      items: [
        {
          id: "pilot",
          category: "fuel",
          title: "Pilot Travel Center",
          meta: "Truck stop · +2 mi · open 24h",
          tip: "$4.29/gal diesel · DEF · showers",
        },
        {
          id: "chevron",
          category: "fuel",
          title: "Chevron",
          meta: "Station · +1 mi · open 24h",
          tip: "$4.79/gal · 87/89/91 · car wash",
        },
        {
          id: "maverik",
          category: "fuel",
          title: "Maverik",
          meta: "Station · +3 mi · open 5a–11p",
          tip: "$4.59/gal · BonFire grill · clean",
        },
      ],
    },
  ],
  2: [
    {
      id: "deschutes-overnight",
      variant: "overnight",
      groupTitle: "Deschutes Forest",
      groupSubtitle: "Sisters, OR · 5 options within 30 mi",
      heroImage:
        "https://images.unsplash.com/photo-1496545672447-f699b503d270?w=1000&q=80",
      browseLabel: "Browse Overnight",
      items: [
        {
          id: "indian-ford",
          category: "camping",
          title: "Indian Ford Campground",
          meta: "USFS · +6 mi detour · reservable",
          tip: "$18/night · creekside · vault toilets",
        },
        {
          id: "three-creek-lake",
          category: "camping",
          title: "Three Creek Lake",
          meta: "Dispersed · +14 mi detour · first-come",
          tip: "Free · alpine lake · no signal",
        },
        {
          id: "blue-bay",
          category: "camping",
          title: "Blue Bay USFS",
          meta: "Forest service · +9 mi detour · reservable",
          tip: "$22/night · boat ramp · pet-friendly",
        },
      ],
    },
    {
      id: "madras-fuel",
      variant: "fuel",
      groupTitle: "Madras Stations",
      groupSubtitle: "Madras, OR · 3 stations within 5 mi",
      heroImage:
        "https://images.unsplash.com/photo-1520975954732-35dd22299614?w=1000&q=80",
      browseLabel: "Browse Fuel Stops",
      items: [
        {
          id: "loves-madras",
          category: "fuel",
          title: "Love's Travel Stop",
          meta: "Truck stop · +1 mi · open 24h",
          tip: "$4.19/gal diesel · DEF · big rig parking",
        },
        {
          id: "shell-madras",
          category: "fuel",
          title: "Shell",
          meta: "Station · +2 mi · open 24h",
          tip: "$4.69/gal · car wash · ATM",
        },
        {
          id: "76-madras",
          category: "fuel",
          title: "76",
          meta: "Station · +0.5 mi · open 5a–11p",
          tip: "$4.49/gal · clean restrooms · espresso",
        },
      ],
    },
  ],
};

export function SuggestedSection({
  dayNumber = 1,
  onBrowse,
}: {
  dayNumber?: number;
  onBrowse?: (category: Category) => void;
}) {
  const suggestions = SUGGESTIONS_BY_DAY[dayNumber] ?? SUGGESTIONS_BY_DAY[1];
  const groups = GROUPS_BY_DAY[dayNumber] ?? GROUPS_BY_DAY[1];
  return (
    <section
      className="flex flex-col"
      style={{
        width: 420,
        marginInline: "auto",
        marginTop: 13,
        gap: 8,
        paddingBottom: 12,
        backgroundColor: "#C16B0B54",
        borderRadius: 4,
      }}
    >
      <div
        className="sticky z-[5] flex items-center justify-between"
        style={{
          top: 130,
          height: 70,
          paddingInline: 13,
          paddingTop: 8,
          paddingBottom: 0,
          backgroundColor: "#4E3314",
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center rounded-full shrink-0"
            style={{
              width: 32,
              height: 32,
              backgroundColor: "#BC6117",
              border: "1px solid #F88112",
            }}
          >
            <span style={{ fontSize: 16, lineHeight: "24px" }}>🚀</span>
          </div>
          <span
            className="uppercase"
            style={{
              fontSize: 16,
              lineHeight: "24px",
              fontFamily: "var(--ff-display)",
              letterSpacing: "0.19em",
              color: "#FFFFFF",
            }}
          >
            Suggested Stops Day {dayNumber}
          </span>
        </div>
        <button
          type="button"
          aria-label="Collapse Suggested"
          className="flex items-center justify-center rounded-sm"
          style={{
            width: 28,
            height: 28,
            border: "1px solid rgba(255, 200, 180, 0.3)",
          }}
        >
          <ChevronDown
            className="w-4 h-4"
            color="#FFC8B4"
            strokeWidth={1.75}
          />
        </button>
      </div>

      <div className="flex flex-col items-center" style={{ gap: 12 }}>
        {suggestions.map((s) => (
          <SuggestionCard key={s.id} {...s} onBrowse={onBrowse} />
        ))}
        {groups.map((g) => (
          <GroupCard key={g.id} {...g} />
        ))}
      </div>
    </section>
  );
}
