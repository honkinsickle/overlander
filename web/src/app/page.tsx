import { PlanningLayout } from "@/components/plan/planning-layout";
import { EntryScene } from "@/components/plan/entry-scene";

/**
 * Home — trip-planner entry. Matches Paper `CR4-0` (the "Entry Behind"
 * seen in v3-2/v3-3). Clicking "Create a Trip" navigates to `/plan`,
 * which seeds a draft and redirects into the Going modal step.
 */
export default function Home() {
  return (
    <PlanningLayout>
      <EntryScene />
    </PlanningLayout>
  );
}
