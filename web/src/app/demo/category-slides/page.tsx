"use client";

import { useState, type ReactNode } from "react";
import {
  CampingAccess,
  CampingConnectivity,
  CampingFeatures,
  CampingSiteTypes,
  CategoryPlanningSlide,
  ExpandTrigger,
  LiveDot,
  StarIcon,
  StatSubText,
  StatValue,
  type CategoryKey,
  type PlanningSlideData,
} from "@/components/demo/category-planning-slide";

type VariantKey = "oddity" | "food" | "scenic" | "overnight" | "camping";

interface Variant {
  label: string;
  category: CategoryKey;
  data: PlanningSlideData;
  bodyExtras?: ReactNode;
}

const VARIANTS: Record<VariantKey, Variant> = {
  oddity: {
    label: "Oddity",
    category: "oddity",
    data: {
      photoUrl:
        "https://images.unsplash.com/photo-1518555615217-f9f269f53fd6?auto=format&fit=crop&w=1600&q=80",
      photoAlt: "Stone garden underground",
      title: "Forestiere Underground Gardens",
      pills: [
        { label: "Temporarily Closed", status: true },
        { label: "Historical landmark" },
        { label: "Nature & Parks" },
        { label: "Gardens" },
      ],
      stats: [
        {
          label: "Drive Time",
          value: (
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <StatValue>+18min</StatValue>
              <StatSubText>→ 4.5 hrs total</StatSubText>
            </span>
          ),
        },
        {
          label: "1,247 say",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StarIcon />
              <StatValue>4.8</StatValue>
            </span>
          ),
        },
        {
          label: "Hours Today",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatValue>10A–4P</StatValue>
              <LiveDot />
            </span>
          ),
        },
        { label: "Entry", value: <StatValue>$23/adult</StatValue> },
      ],
      mention: { primary: "In Atlas Obscura’s California Guide", secondary: "+3 more" },
      description:
        "A Sicilian immigrant spent forty years digging a 10-acre subterranean orchard by hand to escape the Central Valley heat. Skylights, citrus tunnels, and limestone arches feel ancient and improbable.",
      pullquote: {
        text: "“Worth every minute of the detour. Forty years of one man’s obsession — you can feel it in the cool air the moment you climb down.”",
        name: "Rebecca M.",
        meta: "GOOGLE · 5★ · 3 weeks ago",
      },
      placeInfo: {
        address: "5021 W Shaw Ave, Fresno, CA 93722, USA",
        phone: { display: "(559) 271-0734", href: "tel:+15592710734" },
        website: {
          display: "undergroundgardens.com",
          href: "http://www.undergroundgardens.com/",
        },
      },
      cta: "Add tour to Sun 5/31",
    },
  },
  food: {
    label: "Food",
    category: "food",
    data: {
      photoUrl:
        "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1600&q=80",
      photoAlt: "Modern restaurant interior",
      title: "Ella Dining Room & Bar",
      pills: [
        { label: "New American restaurant" },
        { label: "Bar" },
        { label: "Restaurant" },
      ],
      stats: [
        {
          label: "Drive Time",
          value: (
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <StatValue>+9min</StatValue>
              <StatSubText>→ 4.5 hrs total</StatSubText>
            </span>
          ),
        },
        {
          label: "1,247 say",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StarIcon />
              <StatValue>4.8</StatValue>
            </span>
          ),
        },
        {
          label: "Hours Today",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatValue>11:30A–9P</StatValue>
              <LiveDot />
            </span>
          ),
        },
        { label: "Pricing", value: <StatValue>$$$$</StatValue> },
      ],
      mention: { primary: "In Atlas Obscura’s California Guide", secondary: "+3 more" },
      description:
        "Ella Dining Room & Bar offers a vibrant and exciting ambiance, with attentive service and standout dishes like the braised beef short rib that melts in your mouth. Reviewers praise the knowledgeable staff, particularly Roxanne, who provided exceptional service.",
      pullquote: {
        text: "“We came here at night for a quick bite. The atmosphere was amazing, ambiance bright and welcoming.”",
        name: "Mai M.",
        meta: "GOOGLE · 5★ · 3 weeks ago",
      },
      placeInfo: {
        address: "1131 K St, Sacramento, CA 95814, USA",
        phone: { display: "(916) 443-3772", href: "tel:+19164433772" },
        website: { display: "elladiningroomandbar.com", href: "https://elladiningroomandbar.com" },
      },
      cta: "Add to trip Sun 5/31",
    },
  },
  scenic: {
    label: "Scenic",
    category: "scenic",
    data: {
      photoUrl:
        "https://images.unsplash.com/photo-1501594907352-04cda38ebc29?auto=format&fit=crop&w=1600&q=80",
      photoAlt: "Golden Gate Bridge at twilight",
      title: "Golden Gate Bridge",
      pills: [
        { label: "BridgeSights & Landmarks" },
        { label: "Historical landmark" },
        { label: "Historic Sites" },
      ],
      stats: [
        {
          label: "Drive Time",
          value: (
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <StatValue>+18min</StatValue>
              <StatSubText>→ 4.5 hrs total</StatSubText>
            </span>
          ),
        },
        {
          label: "1,124,247 say",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StarIcon />
              <StatValue>4.8</StatValue>
            </span>
          ),
        },
        {
          label: "Hours Today",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatValue>24hrs</StatValue>
              <LiveDot />
            </span>
          ),
        },
        { label: "Automobile", value: <StatValue>$15 Toll</StatValue> },
      ],
      mention: { primary: "Mentioned by Fodor’s Travel", secondary: "+263 more" },
      description:
        "The Golden Gate Bridge, an iconic 4,200-foot art deco suspension marvel, stands as a testament to engineering and beauty. Opened in 1937, it connects San Francisco to Marin County and has since transformed the area into a haven for nature lovers.",
      pullquote: {
        text: "“Visiting the Golden Gate Bridge is truly a must-see experience when you’re in San Francisco. The views are absolutely breathtaking.”",
        name: "Moscato M.",
        meta: "GOOGLE · 5★ · Feb 10, 2026",
      },
      placeInfo: {
        address: "Golden Gate Brg, San Francisco, CA, USA",
        phone: { display: "(415) 921-5858", href: "tel:+14159215858" },
        website: { display: "goldengate.org", href: "https://www.goldengate.org/" },
      },
      cta: "Add to Sun 5/31",
    },
  },
  overnight: {
    label: "Overnight",
    category: "overnight",
    data: {
      photoUrl:
        "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1600&q=80",
      photoAlt: "Boutique lodge at sunset",
      title: "Cavallo Point Lodge",
      pills: [{ label: "Lodge" }, { label: "Boutique stay" }, { label: "Historic" }],
      stats: [
        {
          label: "Drive Time",
          value: (
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <StatValue>+22min</StatValue>
              <StatSubText>→ 5 hrs total</StatSubText>
            </span>
          ),
        },
        {
          label: "892 reviews",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StarIcon />
              <StatValue>4.7</StatValue>
            </span>
          ),
        },
        {
          label: "Check-in",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatValue>After 4P</StatValue>
              <LiveDot />
            </span>
          ),
        },
        { label: "Per Night", value: <StatValue>$425+</StatValue> },
      ],
      mention: { primary: "Featured in Condé Nast Traveler", secondary: "+47 more" },
      description:
        "A restored officer's quarters at Fort Baker, tucked under the Golden Gate Bridge with bay views from every porch. Cottages and lodge rooms with woodburning fireplaces, plus a Michelin-noted restaurant and Healing Arts Center on the grounds.",
      pullquote: {
        text: "“We watched the fog roll in over the bridge from our porch with a glass of wine. The kind of overnight that makes you stretch the trip an extra day.”",
        name: "Devon K.",
        meta: "TRIPADVISOR · 5★ · 2 weeks ago",
      },
      placeInfo: {
        address: "601 Murray Cir, Sausalito, CA 94965, USA",
        phone: { display: "(415) 339-4700", href: "tel:+14153394700" },
        website: { display: "cavallopoint.com", href: "https://cavallopoint.com" },
      },
      cta: "Add stay to Sun 5/31",
    },
  },
  camping: {
    label: "Camping",
    category: "camping",
    data: {
      photoUrl:
        "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=1600&q=80",
      photoAlt: "Mountain landscape near Kolob Canyons",
      title: "Kolob Gate Gardens",
      pills: [{ label: "Tent sites" }, { label: "RV sites" }, { label: "Tent cabins" }],
      stats: [
        {
          label: "Drive Time",
          value: (
            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <StatValue>+29 min</StatValue>
              <StatSubText>from St. George</StatSubText>
            </span>
          ),
        },
        {
          label: "4 Reviews",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StarIcon />
              <StatValue>4.5</StatValue>
            </span>
          ),
        },
        {
          label: "Hours Today",
          value: (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <StatValue>Always</StatValue>
              <LiveDot />
            </span>
          ),
        },
        { label: "Per Night", value: <StatValue>$20–$150</StatValue> },
      ],
      mention: { primary: "Compiled from BLM, NFS, The Dyrt", secondary: "+2 more" },
      description:
        "A 17-site private campground with tent, RV, and glamping options along a creek. Outdoor kitchen with hot water, picnic tables, fire pits, and hammocks. Famous flower gardens and scenic views just outside Zion National Park.",
      pullquote: {
        text: "“The creek was wonderful to be next to and was so peaceful at night!”",
        name: "Evan O.",
        meta: "THE DYRT · 5★ · Jun 2024",
      },
      placeInfo: {
        address: "Virgin, UT 84779",
        phone: { display: "(435) 215-3125", href: "tel:+14352153125" },
        website: { display: "kolobgategardens.com", href: "https://kolobgategardens.com" },
      },
      cta: "Add site for Wed 4/29",
    },
    bodyExtras: (
      <>
        <CampingConnectivity />
        <CampingAccess />
        <CampingSiteTypes />
        <CampingFeatures />
      </>
    ),
  },
};

const VARIANT_KEYS: VariantKey[] = ["oddity", "food", "scenic", "overnight", "camping"];

export default function Page() {
  const [active, setActive] = useState<VariantKey>("scenic");
  const [expanded, setExpanded] = useState(false);
  const variant = VARIANTS[active];

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 p-6">
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 6,
          borderRadius: 9999,
          backgroundColor: "rgba(244, 235, 225, 0.04)",
          border: "1px solid rgba(244, 235, 225, 0.12)",
        }}
      >
        {VARIANT_KEYS.map((key) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActive(key);
                setExpanded(false);
              }}
              style={{
                paddingBlock: 8,
                paddingInline: 16,
                borderRadius: 9999,
                border: "none",
                background: isActive ? "rgba(244, 235, 225, 0.12)" : "transparent",
                color: isActive ? "#F4EBE1" : "#A8988D",
                fontFamily: "var(--font-space-grotesk), system-ui, sans-serif",
                fontWeight: 500,
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {VARIANTS[key].label}
            </button>
          );
        })}
      </div>
      <CategoryPlanningSlide
        key={active}
        category={variant.category}
        data={variant.data}
        expanded={expanded}
        bodyExtras={variant.bodyExtras}
      />
      <ExpandTrigger expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </div>
  );
}
