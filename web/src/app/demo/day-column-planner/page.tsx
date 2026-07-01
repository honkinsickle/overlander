import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import type { Day } from "@/lib/trips/types";

/**
 * THROWAWAY scratch route for the standalone <DayColumnPlanner> rail — Paper
 * "TripActiveAligned" (A7M-0; commits 7f97737, 53b0654, 914ded0, 7d7717e).
 * Dummy LA→Portland trip so the rail (nav headers, Itinerary, 01–05 day
 * timeline) renders in isolation. Safe to drop — not wired to any data.
 */

const DAYS: Day[] = [
  {
    id: "d1",
    dayNumber: 1,
    date: "2026-05-30",
    label: "Los Angeles, CA — Santa Barbara, CA",
    miles: 95,
    driveHours: 2,
    waypoints: [],
  },
  {
    id: "d2",
    dayNumber: 2,
    date: "2026-05-31",
    label: "Santa Barbara, CA — Big Sur, CA",
    miles: 180,
    driveHours: 4,
    waypoints: [],
  },
  {
    id: "d3",
    dayNumber: 3,
    date: "2026-06-01",
    label: "Big Sur, CA — San Francisco, CA",
    miles: 150,
    driveHours: 3.5,
    waypoints: [],
  },
  {
    id: "d4",
    dayNumber: 4,
    date: "2026-06-02",
    label: "San Francisco, CA — Eureka, CA",
    miles: 270,
    driveHours: 5,
    waypoints: [],
  },
  {
    id: "d5",
    dayNumber: 5,
    date: "2026-06-03",
    label: "Eureka, CA — Portland, OR",
    miles: 330,
    driveHours: 6,
    waypoints: [],
  },
];

export default function DayColumnPlannerDemo() {
  return (
    <main className="h-screen flex" style={{ backgroundColor: "var(--bg-map)" }}>
      <DayColumnPlanner tripId="demo-la-portland" days={DAYS} />
    </main>
  );
}
