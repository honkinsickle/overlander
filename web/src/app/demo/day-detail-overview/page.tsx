import {
  DayDetailOverview,
  type OverviewGuide,
  type OverviewPlace,
} from "@/components/trip/day-detail-overview";

/**
 * Scratch route for the standalone <DayDetailOverview> panel — Paper
 * "Day Detail Overview" (EP3-0). Dummy data below; images reuse the board's
 * Paper CDN assets so the panel renders at full fidelity in isolation.
 */

const CDN = "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";

const GUIDES: OverviewGuide[] = [
  {
    title: "Foodies Guide to the Coast",
    description: "Delectable stops — find breakfast, lunch and dinner along the way.",
    byline: "yoTrippin staff",
    imageUrl: `${CDN}/01KV6GTWMQCVFS0ZJXB6TBED9B.png`,
  },
  {
    title: "Places not to miss on-route.",
    description: "Recommendations from like-minded yoTrippin staff.",
    byline: "yoTrippin staff",
    imageUrl: `${CDN}/5ZBSPM9YYA57R1ENM5ZKSJ4R88.jpg`,
  },
];

const PLACES: OverviewPlace[] = [
  {
    category: "food",
    title: "Tartine Bakery",
    description: "Morning pastries and country bread worth the line and the detour.",
    photoAlt: "Bakery display case",
    photoUrl: `${CDN}/3SSAFY1NAPNFE83MH7S3EVXCY4.jpg`,
    rating: 4.9,
    reviewCount: 12200,
    detour: { miles: 6, minutes: 12 },
  },
  {
    category: "urban",
    title: "Pike Place Market",
    description: "Historic public market — chowder, flowers, and the first Starbucks.",
    photoAlt: "Woman on dock",
    photoUrl: `${CDN}/51F3SVN9CW0XQ0J86VC8PP8KTP.jpg`,
    rating: 4.9,
    reviewCount: 12200,
    detour: { miles: 6, minutes: 12 },
  },
  {
    category: "scenic",
    title: "Bixby Creek Bridge",
    description:
      "Iconic span over the Pacific — pull off at the north vista for the classic late-afternoon shot.",
    photoAlt: "Mountain bridge",
    photoUrl: `${CDN}/14WWQ8JJ5B49PQRZS6W7067PJ5.avif`,
    rating: 4.9,
    reviewCount: 12200,
    detour: { miles: 6, minutes: 12 },
  },
];

export default function DayDetailOverviewDemo() {
  return (
    <main className="h-screen flex" style={{ backgroundColor: "var(--bg-map)" }}>
      <DayDetailOverview
        routeLabel="Los Angeles, CA → Portland, OR"
        heroImageUrl={`${CDN}/3QYT8N00ZJVQPDYZQS725QNH9M.avif`}
        heroAlt="Los Angeles to Portland"
        guidesSubtitle="Created by the yoTrippin Staff: Los Angeles,CA - Portland, OR"
        guides={GUIDES}
        placesSubtitle="Across your full route: Los Angeles,CA - Portland, OR"
        places={PLACES}
        dayNumber={2}
      />
    </main>
  );
}
