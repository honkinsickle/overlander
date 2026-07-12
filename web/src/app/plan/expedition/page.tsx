import { notFound } from "next/navigation";
import { ExpeditionWizard } from "@/components/plan/expedition-wizard";
import { isExpeditionWizardEnabled } from "@/lib/plan/expedition";
import { listVehicles } from "@/lib/vehicles/repository";

/**
 * Expedition planner wizard — the UI front door for the YoTrippin generation
 * pipeline. GATED: 404s unless ENABLE_PLANNER_WIZARD=true, so it's dev-only
 * opt-in and never exposed on prod (matches the dormant pipeline). The server
 * action it calls also refuses to persist anywhere but the TEST project.
 */
export default async function ExpeditionPlannerPage() {
  if (!isExpeditionWizardEnabled()) notFound();
  const vehicles = await listVehicles();
  return (
    <main className="min-h-screen bg-base">
      <ExpeditionWizard vehicles={vehicles} />
    </main>
  );
}
