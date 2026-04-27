import type { Category } from "@/components/primitives/detail-card";

/**
 * Seed "must-see" suggestions. Each carries the interest chip ids it
 * satisfies; finalize derives Day 1 waypoints from the user's chip
 * selections.
 */
export type PlanSuggestion = {
  id: string;
  /** URL-safe id reused as the Trip waypoint slug when finalized. */
  slug: string;
  category: Category;
  title: string;
  description: string;
  tip?: string;
  /** Interest chip ids this suggestion satisfies. */
  chipIds: string[];
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
    chipIds: [],
  },
  {
    id: "sugg-tumalo-state-park",
    slug: "tumalo-state-park",
    category: "camping",
    title: "Tumalo State Park Area",
    description:
      "Dispersed camping along Tumalo Creek with Cascade mountain views.",
    tip: "Showers available for $15.",
    chipIds: ["state-parks", "national-parks", "nature-reserves"],
  },
  {
    id: "sugg-columbia-icefield",
    slug: "columbia-icefield",
    category: "mountain",
    title: "Columbia Icefield",
    description:
      "Walk onto a 10,000-year-old glacier — tour departs hourly from the Skywalk center.",
    tip: "Dress warm. Ice temps 10°F even in July.",
    chipIds: ["geographic-features", "national-parks", "scenic-points"],
  },
];

export function getSuggestion(id: string): PlanSuggestion | undefined {
  return RESULTS_SUGGESTIONS.find((s) => s.id === id);
}

export function suggestionsForChips(chipIds: string[]): PlanSuggestion[] {
  const selected = new Set(chipIds);
  return RESULTS_SUGGESTIONS.filter((s) =>
    s.chipIds.some((id) => selected.has(id)),
  );
}
