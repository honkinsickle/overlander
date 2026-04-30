"use client";

import { useState } from "react";
import {
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
    phone: { display: "(559) 271-0734", href: "tel:+15592710734" },
    website: { display: "https://www.goldengate.org/", href: "https://www.goldengate.org/" },
  },
  cta: "Add to Sun 5/31",
};

export default function Page() {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 p-6">
      <CategoryPlanningSlide category="scenic" data={data} expanded={expanded} />
      <ExpandTrigger expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
    </div>
  );
}
