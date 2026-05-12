import { PlanningLayout } from "@/components/plan/planning-layout";
import { EntryScene } from "@/components/plan/entry-scene";
import { UpcomingEventsCard } from "@/components/home/upcoming-events-card";

/**
 * Home — trip-planner entry. Matches Paper `CR4-0` (the "Entry Behind"
 * seen in v3-2/v3-3). Clicking "Create a Trip" navigates to `/plan`,
 * which seeds a draft and redirects into the Going modal step.
 *
 * UpcomingEventsCard is server-only (reads the markdown via node:fs) so
 * it's mounted here rather than inside EntryScene — `wizard-backdrop` is
 * a client component and can't transitively pull node:fs through
 * EntryScene's import graph.
 */
export default function Home() {
  return (
    <PlanningLayout>
      <EntryScene mapSlot={<UpcomingEventsCard />} />
    </PlanningLayout>
  );
}
