/**
 * Bridge: engine facts + generated Section-C → a slideup-renderable Trip
 * (spec §8.2 [PERSIST]/[RENDER]).
 *
 * The reasoned fill (rationale, weather, logistics, overnight, obligations)
 * maps onto the Day fields the Day Detail column ALREADY renders
 * (`suggested-section.tsx` surfaces `day.description`, `day.weather`,
 * `day.notes`) — so a generated itinerary shows up in the existing slideup
 * with no new render surface, exactly as spec §3 intends. The engine facts
 * supply the skeleton (label, coords, miles, corridor spine, POI tiles).
 *
 * NOTE: this maps the generated DayPlan[] onto Day[] by index. The audit
 * (Stage 2) grounds distances/POIs before this runs in production; here it
 * is a straight projection so the first end-to-end pass is inspectable.
 */

import type { Trip, Day } from "@/lib/trips/types";
import type { EngineFacts, GenerationInput } from "./facts";
import type { DayPlan, ItineraryOutput, Obligation } from "./schema";

const SEVERITY_MARK: Record<Obligation["severity"], string> = {
  info: "ℹ",
  recommended: "•",
  critical: "⚠",
};

function obligationLine(o: Obligation): string {
  const when = o.eventDate
    ? ` (by ${o.eventDate}${o.leadTimeDays ? `, −${o.leadTimeDays}d lead` : ""})`
    : o.leadTimeDays
      ? ` (${o.leadTimeDays}d lead)`
      : "";
  return `${SEVERITY_MARK[o.severity]} ${o.action.toUpperCase()}${when}: ${o.reason}`;
}

const FLAG_MARK = { info: "ℹ", warning: "⚠", critical: "‼" } as const;

/** Build the per-day notes list the Day Detail column renders. The REASONED
 *  notes lead (overnight, logistics, obligations) — the gold standard never
 *  shows sausage-making. The audit DROPS silently for the reader: a dropped
 *  POI/overnight or a corrected distance is kept in the structured audit
 *  report for the operator, never surfaced as reader-facing apology text.
 *  Only genuinely reader-relevant advisories (a seasonal window, a leg that
 *  needs re-splitting) are shown, and they follow the reasoned notes. */
const SILENT_FLAG_KINDS = new Set([
  "dropped-poi",
  "dropped-overnight",
  "distance-snapped",
]);

function dayNotes(dp: DayPlan): string[] {
  const notes: string[] = [];

  const overnightRef = dp.overnight.name
    ? dp.overnight.name
    : dp.overnight.desc ?? "overnight (TBD)";
  notes.push(
    `Overnight — ${dp.overnight.type}: ${overnightRef}. ${dp.overnight.rationale}`,
  );
  if (dp.logistics) notes.push(`Logistics — ${dp.logistics}`);
  for (const o of dp.obligations) notes.push(obligationLine(o));

  // Reader-relevant audit flags only, after the reasoned notes.
  for (const f of dp.audit?.flags ?? []) {
    if (SILENT_FLAG_KINDS.has(f.kind)) continue;
    notes.push(`${FLAG_MARK[f.severity]} ${f.message}`);
  }
  return notes;
}

/**
 * Assemble a Trip from the engine facts (skeleton) and the generated
 * itinerary (reasoned fill). The result is a normal Trip — persist it into
 * `reference_trips` / `trips` and it renders in the slideup verbatim.
 */
export function itineraryToTrip(
  tripId: string,
  input: GenerationInput,
  facts: EngineFacts,
  output: ItineraryOutput,
  /** Baked corridors (spine + bucketed tiles) per day from bakeGeneratedDays.
   *  When present, each day renders as a full corridor day; when absent, the
   *  whole pool travels unbucketed (degraded 2-node fallback). */
  bakedDays?: import("./bake").BakedDay[],
): Trip {
  const first = facts.anchorsResolved[0];
  const last = facts.anchorsResolved[facts.anchorsResolved.length - 1];
  const bakedByN = new Map((bakedDays ?? []).map((b) => [b.n, b]));

  const days: Day[] = output.days.map((dp, i) => {
    const baked = bakedByN.get(dp.n);
    // Chain coords across days: day i ends where day i+1 starts. Fall back
    // to the anchor endpoints for the first/last day.
    const startCoord =
      i === 0 ? first.coords : (output.days[i - 1] && undefined);
    const endCoord =
      i === output.days.length - 1 ? last.coords : undefined;

    return {
      id: `day-${dp.n}`,
      dayNumber: dp.n,
      date: dp.date,
      label: `${dp.startPlace} — ${dp.endPlace}`,
      startCoord: startCoord ?? undefined,
      coords: endCoord ?? undefined,
      miles: Math.round(dp.distanceMi),
      driveHours: Math.round(dp.driveHours * 10) / 10,
      description: dp.rationale,
      weather: dp.weather ? { arrival: dp.weather } : undefined,
      notes: dayNotes(dp),
      // Structured overnight = the LLM's curated camp pick + why, so the
      // briefing's Camping section renders it as a recommendation (not just a
      // notes line). Only when a real place was named (else it stays desc-only).
      overnight: dp.overnight.name
        ? {
            selected: {
              id: `overnight-${dp.n}`,
              name: dp.overnight.name,
              type: dp.overnight.type,
              detourMiles: 0,
              cost: "",
              notes: dp.overnight.rationale,
            },
            alternatives: [],
          }
        : undefined,
      waypoints: [],
      // Baked corridor: the day's derived spine + per-day bucketed tiles
      // (spec §3). Falls back to the whole unbucketed pool only when the bake
      // is absent (degraded 2-node view).
      corridorCities: baked?.corridorCities,
      segmentSuggestions: baked
        ? baked.segmentSuggestions
        : facts.poolPOIs.map((p) => ({
            id: p.id,
            coords: p.coords,
            title: p.name,
            photoAlt: p.name,
            pills: [],
            stats: [],
            mention: { primary: "", secondary: "" },
            description: "",
            pullquote: { text: "", name: "", meta: "" },
            placeInfo: { address: "" },
            cta: "",
            rating: p.rating ?? undefined,
            priceTier: (p.priceTier as 1 | 2 | 3 | 4 | undefined) ?? undefined,
          })),
    };
  });

  return {
    id: tripId,
    title: `${first.place} → ${last.place}`,
    startDate: input.params.startDate,
    endDate: input.params.endDate ?? output.days[output.days.length - 1]?.date ?? input.params.startDate,
    startLocation: first.place,
    endLocation: last.place,
    startCoords: first.coords,
    kicker: "YoTrippin · generated expedition",
    generated: true,
    // Persist the inputs WITH the output — this is what makes the trip
    // editable (living-plan: edit anchors → re-run). Loose Record on Trip
    // to avoid a circular import; the real shape is GenerationInput.
    generationInput: input,
    foodThread: output.foodThread,
    weatherHiF: 70,
    weatherLoF: 45,
    days,
  };
}
