import type { Category } from "@/components/primitives/detail-card";

/**
 * Seed "must-see" suggestions shown on the Results step. In a real app
 * these come from the planner (the Loader step). Hard-coded for now so
 * the Results screen can be built and demoed without the planner.
 */
export type PlanSuggestion = {
  id: string;
  /** URL-safe id reused as the Trip waypoint slug when finalized. */
  slug: string;
  category: Category;
  title: string;
  description: string;
  tip?: string;
};

export const RESULTS_SUGGESTIONS: PlanSuggestion[] = [
  {
    id: "sugg-pilot-travel",
    slug: "pilot-travel-center",
    category: "fuel",
    title: "Pilot Travel Center",
    description:
      "Last reliable diesel before the Icefields Parkway adventure begins.",
    tip: "Open 24/7, next fuel 180+ miles north.",
  },
  {
    id: "sugg-tumalo-state-park",
    slug: "tumalo-state-park",
    category: "camping",
    title: "Tumalo State Park Area",
    description:
      "Dispersed camping along Tumalo Creek with Cascade mountain views.",
    tip: "Showers available for $15.",
  },
  {
    id: "sugg-columbia-icefield",
    slug: "columbia-icefield",
    category: "mountain",
    title: "Columbia Icefield",
    description:
      "Walk onto a 10,000-year-old glacier — tour departs hourly from the Skywalk center.",
    tip: "Dress warm. Ice temps 10°F even in July.",
  },
];

export function getSuggestion(id: string): PlanSuggestion | undefined {
  return RESULTS_SUGGESTIONS.find((s) => s.id === id);
}
