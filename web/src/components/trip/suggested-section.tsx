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
      browseLabel: "Browse Scenic",
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
      browseLabel: "Browse Scenic",
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

export function SuggestedSection({ dayNumber = 1 }: { dayNumber?: number }) {
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
          <SuggestionCard key={s.id} {...s} />
        ))}
        {groups.map((g) => (
          <GroupCard key={g.id} {...g} />
        ))}
      </div>
    </section>
  );
}
