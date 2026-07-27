import { PlanningLayout } from "@/components/plan/planning-layout";
import { EntryScene } from "@/components/plan/entry-scene";
import { UpcomingEventsCard } from "@/components/home/upcoming-events-card";

/**
 * Home — trip-planner entry. Matches Paper `CR4-0` (the "Entry Behind"
 * seen in v3-2/v3-3). Clicking "Create a Trip" navigates to
 * `/plan/expedition` — the expedition (LLM) wizard, which requires
 * sign-in and 404s unless ENABLE_PLANNER_WIZARD=true
 * (`docs/decisions/2026-07-27-generation-requires-sign-in.md`).
 *
 * It previously pointed at `/plan`, the legacy 5-step wizard, which
 * seeds a draft and redirects into the Going modal step. That route
 * still exists and is still reachable — from the `/trips` empty state
 * and from draft trip cards — but it is no longer the home funnel and
 * is scheduled for removal.
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
