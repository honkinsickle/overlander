import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import {
  DayDetailOverview,
  type OverviewGuide,
  type OverviewPlace,
} from "@/components/trip/day-detail-overview";
import type { Day } from "@/lib/trips/types";

/**
 * THROWAWAY scratch route — prototype of the SINGLE stacked scrolling column:
 * DayDetailOverview (hero → Guides → Top Places) ABOVE the Itinerary (nav
 * headers → Itinerary header → 01–05 day cards), sharing ONE scroll at the
 * 478px day-detail column width. Preview to eyeball "Overview-above-Itinerary"
 * before any production restructure. NEITHER component is edited.
 *
 * Shared scroll trick (no component edits): the column is NOT height-capped, so
 * the components' baked-in `h-full` resolves to content height and their
 * `overflow-y-auto` becomes a no-op — the PAGE is the single scroll.
 *
 * Anchors for the deferred scroll-to-anchor nav:
 *   #overview / #guides / #places  — from DayDetailOverview (unchanged)
 *   #itinerary                     — added here on the Itinerary wrapper
 * Nav clicks NOT wired (// TODO: wire, separate pass). Fixtures reused verbatim
 * from /demo/day-column-planner + /demo/day-detail-overview.
 */

const CDN = "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";

// ── Rail fixture (from /demo/day-column-planner) ──────────────────────────
const DAYS: Day[] = [
  { id: "d1", dayNumber: 1, date: "2026-05-30", label: "Los Angeles, CA — Santa Barbara, CA", miles: 95, driveHours: 2, waypoints: [] },
  { id: "d2", dayNumber: 2, date: "2026-05-31", label: "Santa Barbara, CA — Big Sur, CA", miles: 180, driveHours: 4, waypoints: [] },
  { id: "d3", dayNumber: 3, date: "2026-06-01", label: "Big Sur, CA — San Francisco, CA", miles: 150, driveHours: 3.5, waypoints: [] },
  { id: "d4", dayNumber: 4, date: "2026-06-02", label: "San Francisco, CA — Eureka, CA", miles: 270, driveHours: 5, waypoints: [] },
  { id: "d5", dayNumber: 5, date: "2026-06-03", label: "Eureka, CA — Portland, OR", miles: 330, driveHours: 6, waypoints: [] },
];

// ── Panel fixture (from /demo/day-detail-overview) ────────────────────────
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

export default function DayDetailColumnDemo() {
  return (
    <main className="flex min-h-screen" style={{ backgroundColor: "var(--bg-map)" }}>
      {/* Single stacked column at the day-detail column width. No height cap →
          the page is the one shared scroll; the components' h-full/overflow
          collapse to content-height (no nested scrolls). */}
      <div
        style={{ width: "var(--rail-column-w)", backgroundColor: "var(--bg-base)" }}
      >
        {/* Overview panel — #overview / #guides / #places live inside it. */}
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

        {/* Itinerary — the rail's nav headers + Itinerary header + 01–05 day
            cards, kept intact. #itinerary marks the block. */}
        <section id="itinerary">
          <DayColumnPlanner tripId="demo-la-portland" days={DAYS} overlay />
        </section>
      </div>
    </main>
  );
}
