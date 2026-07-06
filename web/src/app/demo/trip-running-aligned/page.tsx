import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import {
  DayDetailCorridor,
  type CorridorCity,
  type CorridorPlace,
} from "@/components/trip/day-detail-corridor";
import type { Day } from "@/lib/trips/types";

/**
 * THROWAWAY scratch route — the "Trip Running — aligned" composition: the left
 * Itinerary rail (DayColumnPlanner, d01–d05) BESIDE the v4 corridor view
 * (DayDetailCorridor), under a static TopBar stand-in — assembled so the whole
 * layout can be judged together. Visual-only; nothing wired.
 *
 * NEITHER production component is edited. Data is reused verbatim from the
 * components' individual demos. Page-is-the-scroll (no height cap) so the rail's
 * own `h-full`/`overflow-y-auto` collapse to content and the whole view scrolls
 * as one, matching the production slideup feel.
 *
 * KNOWN DUMMY-DATA MISMATCH (intentional, per the brief): the rail shows the
 * LA→Portland 5-day fixture (d01–d05); the corridor shows the LA→Santa Barbara
 * Day-1 fixture; the TopBar says "6 Days". Not reconciled — this is a layout
 * composition demo, not a data-coherent trip.
 *
 * Drop before merge.
 */

// ── Rail fixture — LA→Portland (verbatim from the deleted /demo/day-column-planner) ──
const DAYS: Day[] = [
  { id: "d1", dayNumber: 1, date: "2026-05-30", label: "Los Angeles, CA — Santa Barbara, CA", miles: 95, driveHours: 2, waypoints: [] },
  { id: "d2", dayNumber: 2, date: "2026-05-31", label: "Santa Barbara, CA — Big Sur, CA", miles: 180, driveHours: 4, waypoints: [] },
  { id: "d3", dayNumber: 3, date: "2026-06-01", label: "Big Sur, CA — San Francisco, CA", miles: 150, driveHours: 3.5, waypoints: [] },
  { id: "d4", dayNumber: 4, date: "2026-06-02", label: "San Francisco, CA — Eureka, CA", miles: 270, driveHours: 5, waypoints: [] },
  { id: "d5", dayNumber: 5, date: "2026-06-03", label: "Eureka, CA — Portland, OR", miles: 330, driveHours: 6, waypoints: [] },
];

// ── Corridor fixture — verbatim from /demo/day-detail-corridor ──
const CDN = "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";
const IMG = {
  scenic1: `${CDN}/14WWQ8JJ5B49PQRZS6W7067PJ5.avif`,
  scenic2: `${CDN}/5ZBSPM9YYA57R1ENM5ZKSJ4R88.jpg`,
  food1: `${CDN}/3SSAFY1NAPNFE83MH7S3EVXCY4.jpg`,
  food2: `${CDN}/01KV6GTWMQCVFS0ZJXB6TBED9B.png`,
  urban: `${CDN}/51F3SVN9CW0XQ0J86VC8PP8KTP.jpg`,
  hero: `${CDN}/3QYT8N00ZJVQPDYZQS725QNH9M.avif`,
};

const PLACES: CorridorPlace[] = [
  { id: "la-griffith", title: "Griffith Observatory", category: "scenic", photoUrl: IMG.scenic1, photoAlt: "Observatory over the city", rating: 4.7, reviewCount: 64000 },
  { id: "la-gcm", title: "Grand Central Market", category: "food", photoUrl: IMG.food1, photoAlt: "Market food stalls", rating: 4.5, reviewCount: 23000 },
  { id: "la-broad", title: "The Broad", category: "attraction", photoUrl: IMG.urban, photoAlt: "Contemporary art museum", rating: 4.6, reviewCount: 18000 },
  { id: "ven-botanical", title: "Ventura Botanical Gardens", category: "scenic", photoUrl: IMG.scenic2, photoAlt: "Hillside gardens", rating: 4.6, reviewCount: 1200 },
  { id: "ven-mission", title: "Mission San Buenaventura", category: "attraction", photoUrl: IMG.urban, photoAlt: "Spanish mission", rating: 4.6, reviewCount: 2100 },
  { id: "ven-tacos", title: "Beach House Tacos", category: "food", photoUrl: IMG.food2, photoAlt: "Tacos on the pier", rating: 4.4, reviewCount: 3400 },
  { id: "sb-inspiration", title: "Inspiration Point Trail", category: "scenic", photoUrl: IMG.scenic1, photoAlt: "Coastal ridge trail", rating: 4.8, reviewCount: 2600 },
  { id: "sb-county", title: "Santa Barbara County Courthouse", category: "attraction", photoUrl: IMG.urban, photoAlt: "Historic courthouse tower", rating: 4.8, reviewCount: 9100 },
  { id: "sb-superrica", title: "La Super-Rica Taqueria", category: "food", photoUrl: IMG.food1, photoAlt: "Taqueria counter", rating: 4.5, reviewCount: 5200 },
];

const CITIES: CorridorCity[] = [
  { id: "los-angeles-ca", name: "Los Angeles, CA", kind: "start", milesFromStart: 0, coords: [-118.2437, 34.0522], placeIds: ["la-griffith", "la-gcm"] },
  { id: "ventura-ca", name: "Ventura, CA", kind: "corridor", milesFromStart: 65, coords: [-119.229, 34.2746], placeIds: ["ven-botanical", "ven-mission", "ven-tacos"] },
  { id: "santa-barbara-ca", name: "Santa Barbara, CA", kind: "end", milesFromStart: 95, coords: [-119.6982, 34.4208], placeIds: ["sb-inspiration", "sb-county", "sb-superrica"] },
];

/** Static stand-in for the production TopBar chrome (visual only). */
function TopBarStandIn() {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        height: 60,
        paddingInline: 18,
        borderBottom: "1px solid var(--border-subtle)",
        backgroundColor: "var(--bg-topbar)",
      }}
    >
      <div className="flex flex-col justify-center min-w-0">
        <span style={{ fontFamily: "var(--ff-sans)", fontWeight: 600, fontSize: 18, lineHeight: "22px", color: "var(--text-primary)" }}>
          Los Angeles, CA to Portland, OR
        </span>
        <span style={{ fontFamily: "var(--ff-sans)", fontSize: 12, lineHeight: "16px", letterSpacing: "0.02em", color: "var(--amber-light)" }}>
          6 Days · 1,140 mi · 5 Overnights
        </span>
      </div>
      <div className="flex items-center shrink-0" style={{ gap: 10 }}>
        {/* Search field (static, no wiring). */}
        <div
          className="flex items-center"
          style={{ gap: 7, height: 32, width: 208, paddingInline: 10, borderRadius: 8, backgroundColor: "var(--bg-card)", border: "1px solid var(--border-subtle)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2} strokeLinecap="round" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span className="truncate" style={{ fontFamily: "var(--ff-sans)", fontSize: 13, color: "var(--text-muted)" }}>
            Search places, food, stops…
          </span>
        </div>
        {/* Collapse chevron (static). */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}

export default function TripRunningAlignedDemo() {
  return (
    // Page-is-the-scroll: no height cap, so the rail's h-full/overflow collapse
    // to content and the whole assembled view scrolls as one.
    <main className="flex min-h-screen" style={{ backgroundColor: "var(--bg-map)" }}>
      {/* Assembled column = 183px rail + 478px corridor = 661px. */}
      <div className="flex flex-col" style={{ width: 661 }}>
        <TopBarStandIn />

        {/* Rail (183px, flush) | corridor (478px). */}
        <div className="flex">
          {/* TODO: wire — rail day-card selection drives the right column. */}
          <DayColumnPlanner tripId="demo-trip-running-aligned" days={DAYS} />

          <DayDetailCorridor
            dayLabel="Day 1 — Sat, May 30th"
            dayNumber={1}
            routeLabel="Los Angeles, CA — Santa Barbara, CA"
            heroImageUrl={IMG.hero}
            heroAlt="Los Angeles to Santa Barbara"
            cities={CITIES}
            places={PLACES}
            mileMarkers={[{ mile: 40, placeIds: ["la-broad"] }]}
          />
        </div>
      </div>
    </main>
  );
}
