/**
 * Stage-2 audit (spec §8.3): verify the LLM's output against engine/corpus
 * ground truth BEFORE persist/render. The LLM proposes; the fact layer
 * disposes.
 *
 *   TIER 1 — silently correct: re-measure each day's actual leg
 *     (routeBetween on its geocoded start→end, INCLUDING side-trips) and snap
 *     distanceMi/driveHours to the measurement; re-compute fuel gaps.
 *   TIER 2 — flag/drop: any keyStop/overnight poiId not in the fed corpus
 *     pool is DROPPED and the day flagged (a fake stop can strand someone; a
 *     missing one is safe). Seasonal claims are advisory-tagged.
 *   TIER 3 — structural: a leg over the max-daily-drive cap or a FIXED anchor
 *     off its date is returned for bounded regeneration (the caller loops).
 *
 * The returned itinerary is the AUDITED one — corrected distances, fabricated
 * POIs removed, per-day confidence + flags attached. That is what gets stored
 * and shown, never the raw LLM output.
 */

import { geocode } from "@/lib/routing/geocode";
import { routeBetween } from "@/lib/routing/route-between";
import type { EngineFacts, GenerationInput } from "./facts";
import { computeFuelGaps, type ComputedFuelGap } from "./fuel-gaps";
import type {
  AuditFlag,
  DayPlan,
  FuelGap,
  ItineraryOutput,
} from "./schema";

const METERS_PER_MILE = 1609.34;
// A stated distance within this of the measurement isn't worth flagging.
const DISTANCE_SNAP_TOLERANCE_MI = 15;

export type StructuralIssue =
  | { kind: "leg-over-cap"; day: number; measuredMi: number; capMi: number }
  | {
      kind: "anchor-off-date";
      anchor: string;
      expectedDate: string;
      actualDate: string | null;
    };

export type AuditReport = {
  distanceSnaps: {
    day: number;
    statedMi: number;
    measuredMi: number | null;
    statedHrs: number;
    measuredHrs: number | null;
    snapped: boolean;
  }[];
  droppedPois: { day: number; poiId: string; where: "keyStop" | "overnight" }[];
  fuel: {
    computed: ComputedFuelGap[];
    claimed: FuelGap[];
    /** True when the LLM's flagged gaps overlap the computed critical gaps. */
    claimedGapsCorroborated: boolean;
  };
  structural: StructuralIssue[];
  totalStatedMi: number;
  totalMeasuredMi: number;
  summary: string;
};

export type AuditOutcome = {
  /** The corrected + flagged itinerary — persist/render THIS, not the raw. */
  audited: ItineraryOutput;
  report: AuditReport;
  /** Tier-3 issues for the caller's bounded regen loop; empty when clean. */
  structural: StructuralIssue[];
};

/** Case/space-insensitive substring match for anchor↔day-label reconciliation. */
function placeMatches(dayLabel: string, anchorPlace: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const town = norm(anchorPlace.split(",")[0]);
  return town.length > 0 && norm(dayLabel).includes(town);
}

export async function auditItinerary(
  input: GenerationInput,
  facts: EngineFacts,
  output: ItineraryOutput,
): Promise<AuditOutcome> {
  const poolIds = new Set(facts.poolPOIs.map((p) => p.id));
  const capMi = input.params.maxDailyDriveMi;

  const report: AuditReport = {
    distanceSnaps: [],
    droppedPois: [],
    fuel: { computed: [], claimed: output.fuelGaps, claimedGapsCorroborated: false },
    structural: [],
    totalStatedMi: 0,
    totalMeasuredMi: 0,
    summary: "",
  };

  // Geocode cache: many day endpoints repeat (day N end == day N+1 start).
  const geoCache = new Map<string, Promise<[number, number] | null>>();
  const resolve = (label: string): Promise<[number, number] | null> => {
    let p = geoCache.get(label);
    if (!p) {
      p = geocode(label)
        .then((c) => c as [number, number])
        .catch(() => null);
      geoCache.set(label, p);
    }
    return p;
  };

  const auditedDays: DayPlan[] = [];

  for (const day of output.days) {
    const flags: AuditFlag[] = [];

    // ── TIER 2: POI existence ────────────────────────────────────────
    const keptStops = day.keyStops.filter((id) => poolIds.has(id));
    for (const id of day.keyStops) {
      if (!poolIds.has(id)) {
        report.droppedPois.push({ day: day.n, poiId: id, where: "keyStop" });
        flags.push({
          kind: "dropped-poi",
          severity: "warning",
          message:
            "The planner suggested a stop here we couldn't verify against the corpus — dropped it; you may want to find your own.",
        });
      }
    }

    let overnight = day.overnight;
    if (overnight.poiId && !poolIds.has(overnight.poiId)) {
      report.droppedPois.push({
        day: day.n,
        poiId: overnight.poiId,
        where: "overnight",
      });
      flags.push({
        kind: "dropped-overnight",
        severity: "critical",
        message:
          "The planner's suggested overnight couldn't be verified against the corpus and was removed — this day has NO confirmed overnight; plan your own before you go.",
      });
      overnight = {
        ...overnight,
        poiId: null,
        desc:
          overnight.desc ??
          "Unverified overnight removed by the audit — find and confirm your own.",
      };
    }

    // ── TIER 1: distance / drive re-measurement ──────────────────────
    // A layover is a genuine 0-mi rest day. An out-and-back sidetrip
    // (start == end, e.g. the loop to Stewart/Hyder) can't be measured as a
    // point-to-point leg — snapping it to 0 would erase the excursion — so
    // keep the LLM's stated distance and mark it advisory.
    const isLayover = day.type === "layover";
    const isOutAndBack = !isLayover && day.startPlace === day.endPlace;
    let measuredMi: number | null = null;
    let measuredHrs: number | null = null;

    if (isLayover) {
      measuredMi = 0;
      measuredHrs = 0;
    } else if (isOutAndBack) {
      measuredMi = null; // unmeasurable from two identical endpoints
    } else {
      const [a, b] = await Promise.all([
        resolve(day.startPlace),
        resolve(day.endPlace),
      ]);
      if (a && b) {
        try {
          const r = await routeBetween([a, b]);
          measuredMi = r.distanceM / METERS_PER_MILE;
          measuredHrs = r.durationS / 3600;
        } catch {
          measuredMi = null;
        }
      }
    }

    const statedMi = day.distanceMi;
    const statedHrs = day.driveHours;
    let distanceMi = statedMi;
    let driveHours = statedHrs;
    let distanceConfidence: "measured" | "advisory" = "advisory";
    let snapped = false;

    if (measuredMi !== null && measuredHrs !== null) {
      distanceConfidence = "measured";
      if (Math.abs(measuredMi - statedMi) > DISTANCE_SNAP_TOLERANCE_MI) {
        snapped = true;
        flags.push({
          kind: "distance-snapped",
          severity: "info",
          message: `Distance corrected: planner said ${Math.round(statedMi)} mi, engine measured ${Math.round(measuredMi)} mi.`,
        });
      }
      distanceMi = Math.round(measuredMi);
      driveHours = Math.round(measuredHrs * 10) / 10;

      // ── TIER 3: structural — leg over the daily cap ────────────────
      if (measuredMi > capMi + DISTANCE_SNAP_TOLERANCE_MI) {
        report.structural.push({
          kind: "leg-over-cap",
          day: day.n,
          measuredMi: Math.round(measuredMi),
          capMi,
        });
        flags.push({
          kind: "structural",
          severity: "critical",
          message: `This leg (${Math.round(measuredMi)} mi) exceeds your ${capMi} mi/day cap — needs a re-split.`,
        });
      }
    }

    report.distanceSnaps.push({
      day: day.n,
      statedMi: Math.round(statedMi),
      measuredMi: measuredMi === null ? null : Math.round(measuredMi),
      statedHrs: Math.round(statedHrs * 10) / 10,
      measuredHrs: measuredHrs === null ? null : Math.round(measuredHrs * 10) / 10,
      snapped,
    });
    report.totalStatedMi += statedMi;
    report.totalMeasuredMi += measuredMi ?? statedMi;

    auditedDays.push({
      ...day,
      keyStops: keptStops,
      overnight,
      distanceMi,
      driveHours,
      audit: {
        distanceConfidence,
        statedDistanceMi: Math.round(statedMi),
        statedDriveHours: Math.round(statedHrs * 10) / 10,
        flags,
      },
    });
  }

  // ── TIER 3: structural — FIXED anchors off their pinned date ────────
  for (const anchor of facts.anchorsResolved) {
    if (anchor.datePin !== "fixed" || !anchor.date) continue;
    // A FIXED anchor is honored if ANY day at that place lands on its date —
    // arrival, a dwell/layover day, or departure all count. (A dwell of 1 in
    // Dawson means the traveler arrives 7/9 and is there through the 7/10
    // dwell; both days match the place.)
    const matchingDays = auditedDays.filter(
      (d) =>
        placeMatches(d.startPlace, anchor.place) ||
        placeMatches(d.endPlace, anchor.place),
    );
    const honored = matchingDays.some((d) => d.date === anchor.date);
    if (!honored) {
      report.structural.push({
        kind: "anchor-off-date",
        anchor: anchor.place,
        expectedDate: anchor.date,
        actualDate: matchingDays[0]?.date ?? null,
      });
    }
  }

  // ── TIER 1: fuel gaps recomputed against real fuel POIs ─────────────
  const computedGaps = computeFuelGaps(facts, input.rig.fuelRangeMi);
  report.fuel.computed = computedGaps;
  // Corroboration: does at least one LLM-claimed gap overlap a computed
  // critical gap's mile window (by naming a place inside it, loosely)?
  const criticalGaps = computedGaps.filter((g) => g.exceedsRange);
  report.fuel.claimedGapsCorroborated =
    criticalGaps.length > 0 &&
    output.fuelGaps.some((claimed) =>
      criticalGaps.some(
        (c) => Math.abs(claimed.gapMi - c.gapMi) <= c.gapMi * 0.5,
      ),
    );

  const audited: ItineraryOutput = {
    ...output,
    days: auditedDays,
    // Replace the LLM's fuel gaps with the computed ground truth.
    fuelGaps: computedGaps.map((g) => ({
      segment: g.segment,
      gapMi: g.gapMi,
      action: g.action,
    })),
  };

  const droppedCount = report.droppedPois.length;
  const snapCount = report.distanceSnaps.filter((s) => s.snapped).length;
  report.summary =
    `audited ${output.days.length} days · ${snapCount} distance(s) snapped · ` +
    `${droppedCount} fabricated POI(s) dropped · ${computedGaps.length} fuel gap(s) computed · ` +
    `${report.structural.length} structural issue(s)`;

  return { audited, report, structural: report.structural };
}
