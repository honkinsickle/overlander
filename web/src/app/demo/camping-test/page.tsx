"use client";

import { useState } from "react";
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
  type PlanningSlideData,
} from "@/components/demo/category-planning-slide";

const data: PlanningSlideData = {
  photoUrl:
    "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=1600&q=80",
  photoAlt: "Mountain landscape near Kolob Canyons",
  title: "Kolob Gate Gardens",
  pills: [
    { label: "Tent sites" },
    { label: "RV sites" },
    { label: "Tent cabins" },
  ],
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
};

export default function Page() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 p-6">
      <CategoryPlanningSlide
        category="camping"
        data={data}
        expanded={expanded}
        bodyExtras={
          <>
            <CampingConnectivity />
            <CampingAccess />
            <CampingSiteTypes />
            <CampingFeatures />
          </>
        }
      />
      <ExpandTrigger expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </div>
  );
}
