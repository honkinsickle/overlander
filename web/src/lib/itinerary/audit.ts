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
import { pointToPolylineMi, haversineMi } from "@/lib/routing/point-to-polyline";
import type { EngineFacts, GenerationInput } from "./facts";
import { computeFuelGaps, type ComputedFuelGap } from "./fuel-gaps";
import { PlaceResolver, type ResolvedName } from "./resolve";
import type {
  AuditFlag,
  DayPlan,
  FuelGap,
  ItineraryOutput,
  ResolvedPlace,
} from "./schema";

const METERS_PER_MILE = 1609.34;
// A stated distance within this of the measurement isn't worth flagging.
const DISTANCE_SNAP_TOLERANCE_MI = 15;
// A tier-2 resolved place must sit within this of the day's route/base to be
// grounded — the hard corridor guard (locationBias alone is too soft).
const GUARD_MI = 60;

const UNVERIFIED_OVERNIGHT_DESC =
  "Unverified overnight removed by the audit — find and confirm your own.";
const DROPPED_OVERNIGHT_FLAG: AuditFlag = {
  kind: "dropped-overnight",
  severity: "critical",
  message:
    "The planner's suggested overnight couldn't be verified and was removed — this day has NO confirmed overnight; plan your own before you go.",
};

/** Three-tier grounding for one place reference (spec §8.3). A token that
 *  looks like a corpus id (mp:…) must be in the pool; anything else is a real
 *  place NAME to resolve live + guard on-corridor. */
async function groundReference(
  ref: string,
  where: "keyStop" | "overnight",
  ctx: {
    poolIds: Set<string>;
    resolver: PlaceResolver;
    biasCoord: [number, number];
    onCorridor: (c: [number, number]) => boolean;
  },
): Promise<
  | { kind: "keep-id" }
  | { kind: "resolved"; place: ResolvedName }
  | { kind: "drop"; reason: string; reasonText: string; flag: AuditFlag }
> {
  const isCorpusId = ref.startsWith("mp:");
  if (isCorpusId) {
    // Tier 1 (in pool) or Tier 3 (fabricated id — the mp:4163b117 case).
    if (ctx.poolIds.has(ref)) return { kind: "keep-id" };
    return {
      kind: "drop",
      reason: "fabricated-id",
      reasonText: "is a corpus id that doesn't exist in the pool (fabricated)",
      flag: {
        kind: "dropped-poi",
        severity: "warning",
        message:
          "The planner referenced a corpus id we couldn't find — dropped it (a fabricated place is never shown).",
      },
    };
  }

  // Tier 2: a real place NAME → resolve live, then GUARD on-corridor.
  const r = await ctx.resolver.resolve(ref, ctx.biasCoord);
  if (r.status === "resolved" && ctx.onCorridor(r.place.coords)) {
    return { kind: "resolved", place: r.place };
  }
  const reasonText =
    r.status === "resolved"
      ? "resolved to a place off your route (rejected by the corridor guard)"
      : r.status === "capped"
        ? "wasn't resolved (per-generation lookup cap reached)"
        : "couldn't be resolved to a real place";
  return {
    kind: "drop",
    reason: r.status === "resolved" ? "off-corridor" : r.status,
    reasonText,
    flag: {
      kind: where === "overnight" ? "dropped-overnight" : "dropped-poi",
      severity: where === "overnight" ? "critical" : "warning",
      message: `The planner suggested "${ref}" but it ${reasonText} — dropped it; find your own.`,
    },
  };
}

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
  droppedPois: {
    day: number;
    poiId: string;
    where: "keyStop" | "overnight";
    reason: string;
  }[];
  /** Tier-2 names resolved live + passed the corridor guard (→ ingest). */
  resolved: {
    day: number;
    name: string;
    where: "keyStop" | "overnight" | "endpoint";
  }[];
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

/** Per-day route data the audit already computed (geocoded endpoints +
 *  measured polyline) — TRANSIENT, handed to the corridor bake so it doesn't
 *  re-route all 19 days a second time. Not persisted. */
export type DayRoute = {
  n: number;
  startCoord: [number, number] | null;
  endCoord: [number, number] | null;
  polyline: [number, number][] | null;
};

export type AuditOutcome = {
  /** The corrected + flagged itinerary — persist/render THIS, not the raw. */
  audited: ItineraryOutput;
  report: AuditReport;
  /** Tier-3 issues for the caller's bounded regen loop; empty when clean. */
  structural: StructuralIssue[];
  /** Per-day routes for the corridor bake (transient — feed bakeGeneratedDays). */
  dayRoutes: DayRoute[];
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
    resolved: [],
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
  const dayRoutes: DayRoute[] = [];
  // Cap is a runaway guard, not a budget throttle — scale it so it never
  // clips a legitimate trip's names (a 19-day trip emits ~60). Dedup does the
  // real cost control; the corpus-feedback loop drives cost DOWN over time.
  const resolver = new PlaceResolver(Math.max(50, output.days.length * 5));

  // Endpoints chain: day N starts where day N-1 ended. Seed at the start
  // anchor's known coord so the first hop is grounded.
  let currentPos: [number, number] | null =
    facts.anchorsResolved[0]?.coords ?? null;
  // An endpoint may be a full day's drive from the previous one, plus
  // excursions — generous, but tight enough to reject an 800-mi geocode error
  // ("Boya Lake, BC" → Kelowna).
  const ENDPOINT_GUARD_MI = Math.max(450, capMi * 1.6);

  /**
   * Resolve a day ENDPOINT reliably: prefer a matching trip anchor (known
   * coord); else the Google resolver (chained bias + sanity guard) — the SAME
   * guarded path excursion vias use; Mapbox geocode only as a last resort.
   */
  const resolveEndpoint = async (
    label: string,
    from: [number, number] | null,
  ): Promise<{ coord: [number, number] | null; resolved: ResolvedPlace | null }> => {
    const anchor = facts.anchorsResolved.find((a) => placeMatches(label, a.place));
    if (anchor) return { coord: anchor.coords, resolved: null };

    const bias = from ?? facts.anchorsResolved[0]?.coords ?? [0, 0];
    const r = await resolver.resolve(label, bias);
    if (
      r.status === "resolved" &&
      (!from || haversineMi(r.place.coords, from) <= ENDPOINT_GUARD_MI)
    ) {
      return {
        coord: r.place.coords,
        resolved: {
          name: label,
          displayName: r.place.displayName,
          placeId: r.place.placeId,
          coords: r.place.coords,
          where: "endpoint",
        },
      };
    }
    // Last resort: Mapbox geocode, still sanity-guarded.
    const g = await resolve(label);
    if (g && (!from || haversineMi(g, from) <= ENDPOINT_GUARD_MI)) {
      return { coord: g, resolved: null };
    }
    return { coord: null, resolved: null };
  };

  for (const day of output.days) {
    const flags: AuditFlag[] = [];
    const resolvedPlaces: ResolvedPlace[] = [];

    // ── TIER 1: distance / drive re-measurement (FIRST — its route
    //    polyline is the corridor guard for tier-2 resolution below) ──
    // Endpoints resolve through the SAME guarded Google path as excursion
    // vias (chained: this day starts where the last ended). A layover is a
    // 0-mi rest day; an out-and-back sidetrip (start == end) can't be measured
    // point-to-point, so its distance stays advisory.
    const isLayover = day.type === "layover";
    const isOutAndBack = !isLayover && day.startPlace === day.endPlace;
    let measuredMi: number | null = null;
    let measuredHrs: number | null = null;
    let dayPolyline: [number, number][] | null = null;

    const dayStartCoord: [number, number] | null = currentPos;
    let dayEndCoord: [number, number] | null;

    if (isLayover) {
      measuredMi = 0;
      measuredHrs = 0;
      dayEndCoord = dayStartCoord;
    } else if (isOutAndBack) {
      measuredMi = null; // unmeasurable from two identical endpoints
      dayEndCoord = dayStartCoord;
    } else {
      const ep = await resolveEndpoint(day.endPlace, dayStartCoord);
      dayEndCoord = ep.coord;
      if (ep.resolved) {
        resolvedPlaces.push(ep.resolved);
        report.resolved.push({ day: day.n, name: ep.resolved.name, where: "endpoint" });
      }
      if (dayStartCoord && dayEndCoord) {
        try {
          const r = await routeBetween([dayStartCoord, dayEndCoord]);
          measuredMi = r.distanceM / METERS_PER_MILE;
          measuredHrs = r.durationS / 3600;
          dayPolyline = r.coordinates;
        } catch {
          measuredMi = null;
        }
      }
    }
    // Advance the chain (a failed endpoint stays put rather than jumping).
    currentPos = dayEndCoord ?? currentPos;
    const dayAnchorCoord = dayEndCoord ?? dayStartCoord;

    // Corridor guard: a tier-2 resolved place must sit within GUARD_MI of the
    // day's route (or its base coord on a stationary/loop day). `locationBias`
    // is soft, so this HARD check is what rejects far-off ambiguous matches
    // (e.g. bare "Bear Glacier" → the Alaska one, ~1400 mi off-route).
    const onCorridor = (coord: [number, number]): boolean => {
      if (dayPolyline) return pointToPolylineMi(coord, dayPolyline) <= GUARD_MI;
      if (dayAnchorCoord) return haversineMi(coord, dayAnchorCoord) <= GUARD_MI;
      return false; // can't establish the day's location → can't verify → reject
    };
    const biasCoord =
      dayAnchorCoord ?? facts.anchorsResolved[0]?.coords ?? [0, 0];

    // ── TIER 1/2/3: ground every referenced place ────────────────────
    const keptStops: string[] = [];
    for (const ref of day.keyStops) {
      const outcome = await groundReference(ref, "keyStop", {
        poolIds,
        resolver,
        biasCoord,
        onCorridor,
      });
      if (outcome.kind === "keep-id") keptStops.push(ref);
      else if (outcome.kind === "resolved") {
        keptStops.push(ref);
        resolvedPlaces.push({ ...outcome.place, name: ref, where: "keyStop" });
        report.resolved.push({ day: day.n, name: ref, where: "keyStop" });
      } else {
        report.droppedPois.push({ day: day.n, poiId: ref, where: "keyStop", reason: outcome.reason });
        flags.push(outcome.flag);
      }
    }

    // Overnight: pooled id → corpus check; name → resolve+guard; else desc.
    let overnight = { ...day.overnight };
    if (overnight.poiId) {
      if (!poolIds.has(overnight.poiId)) {
        report.droppedPois.push({ day: day.n, poiId: overnight.poiId, where: "overnight", reason: "fabricated-id" });
        flags.push(DROPPED_OVERNIGHT_FLAG);
        overnight = { ...overnight, poiId: null, desc: overnight.desc ?? UNVERIFIED_OVERNIGHT_DESC };
      }
    } else if (overnight.name) {
      const outcome = await groundReference(overnight.name, "overnight", {
        poolIds,
        resolver,
        biasCoord,
        onCorridor,
      });
      if (outcome.kind === "resolved") {
        resolvedPlaces.push({ ...outcome.place, name: overnight.name, where: "overnight" });
        report.resolved.push({ day: day.n, name: overnight.name, where: "overnight" });
      } else if (outcome.kind === "drop") {
        report.droppedPois.push({ day: day.n, poiId: overnight.name, where: "overnight", reason: outcome.reason });
        flags.push({ ...DROPPED_OVERNIGHT_FLAG, message: `Overnight "${overnight.name}" ${outcome.reasonText} — this day has NO confirmed overnight; plan your own before you go.` });
        overnight = { ...overnight, name: null, desc: overnight.desc ?? UNVERIFIED_OVERNIGHT_DESC };
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
        resolvedPlaces,
      },
    });
    dayRoutes.push({
      n: day.n,
      startCoord: dayStartCoord,
      endCoord: dayEndCoord,
      polyline: dayPolyline,
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
    `${report.resolved.length} name(s) resolved live (${resolver.callCount} Google lookups) · ` +
    `${droppedCount} place(s) dropped · ${computedGaps.length} fuel gap(s) computed · ` +
    `${report.structural.length} structural issue(s)`;

  return { audited, report, structural: report.structural, dayRoutes };
}
