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
import type { EngineFacts, GenerationInput, PoolPOI } from "./facts";
import { computeFuelGaps, type ComputedFuelGap } from "./fuel-gaps";
import { PlaceResolver, type ResolvedName } from "./resolve";
import { overnightTileRef } from "./bake";
import {
  pickBackfillStops,
  anchorIsBare,
  anchorStopNote,
  corridorStopNote,
  ANCHOR_NEAR_MI,
  type BackfillAnchor,
} from "./anchor-backfill";
import type {
  AuditFlag,
  DayPlan,
  FuelGap,
  ItineraryOutput,
  KeyStop,
  ResolvedPlace,
} from "./schema";

const METERS_PER_MILE = 1609.34;
// A stated distance within this of the measurement isn't worth flagging.
const DISTANCE_SNAP_TOLERANCE_MI = 15;
// A resolved place must sit within this of the day's route to be grounded —
// the hard corridor guard (locationBias alone is too soft). This is
// PERPENDICULAR distance to the actual driven polyline, so 60mi is a generous
// berth (a park up a spur, a town just off the line all pass).
const GUARD_MI = 60;
// On dwell / out-and-back days there is NO forward polyline, so the guard
// degrades to straight-line distance from the base town. Use a wider radius
// there so legitimate rest-day excursions clear it (Ancient Forest is ~63mi
// straight-line from Prince George — just over the 60mi line; a Tombstone run
// ~47mi). Mis-resolutions to the wrong region are ~1000mi+ off and still fail.
const DWELL_GUARD_MI = 120;

/** Start-of-day key-stop backfill (`anchor-backfill.ts`).
 *
 *  ON by default, with `KEYSTOP_ANCHOR_BACKFILL=false` as the kill switch —
 *  the inverse of this repo's usual default-OFF flag posture, deliberately.
 *  The usual posture guards LIVE production paths; generation is not one:
 *  the whole wizard is already gated behind `ENABLE_PLANNER_WIZARD`, which
 *  prod never sets. Shipping this OFF would mean shipping a fix that does
 *  nothing. The switch exists so a bad pick can be disabled without a revert. */
const BACKFILL_ENABLED = process.env.KEYSTOP_ANCHOR_BACKFILL !== "false";

const UNVERIFIED_OVERNIGHT_DESC =
  "Unverified overnight removed by the audit — find and confirm your own.";
const DROPPED_OVERNIGHT_FLAG: AuditFlag = {
  kind: "dropped-overnight",
  severity: "critical",
  message:
    "The planner's suggested overnight couldn't be verified and was removed — this day has NO confirmed overnight; plan your own before you go.",
};

/** The outcome of grounding one place NAME. Exported so the bake can derive the
 *  overnight's canonical tile id from it (`overnightTileRef`). */
export type GroundOutcome =
  | { kind: "pool-hit"; poi: PoolPOI }
  | { kind: "resolved"; place: ResolvedName }
  | { kind: "drop"; reason: string; reasonText: string; flag: AuditFlag };

/** Ground one place NAME (the model never emits ids — nothing to fabricate).
 *  POOL-FIRST: match the name to a pooled POI by name (keeping its corpus
 *  id/rating/coords, no Google spend); else resolve the name live and GUARD
 *  it on-corridor; else drop. */
async function groundReference(
  ref: string,
  where: "keyStop" | "overnight",
  ctx: {
    poolByName: Map<string, PoolPOI>;
    resolver: PlaceResolver;
    biasCoord: [number, number];
    onCorridor: (c: [number, number]) => boolean;
  },
): Promise<GroundOutcome> {
  // Pool-first: the model named a place we already have — keep its corpus data.
  const hit = matchPool(ref, ctx.poolByName);
  if (hit) return { kind: "pool-hit", poi: hit };

  // Not in the pool → resolve the NAME live, then GUARD on-corridor.
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

export type GroundedKeyStop =
  | { kind: "kept"; kept: KeyStop; resolved: ResolvedPlace | null }
  | { kind: "dropped"; poiId: string; reason: string; flag: AuditFlag };

/** Ground ONE key stop: resolve its NAME (pool-first → live → drop) and carry
 *  its `note` through untouched. On a pool-hit `kept.name` becomes the corpus
 *  id (downstream treats it as a pool POI); on a live-resolve it stays the name
 *  (+ a ResolvedPlace). The note NEVER resolves — it's descriptive context,
 *  threaded so the tile can show it. Exported so a test can lock the invariant
 *  that a {name,note} key stop grounds AND its note survives the ref-swap. */
export async function groundKeyStop(
  ks: KeyStop,
  ctx: {
    poolByName: Map<string, PoolPOI>;
    resolver: PlaceResolver;
    biasCoord: [number, number];
    onCorridor: (c: [number, number]) => boolean;
  },
): Promise<GroundedKeyStop> {
  const outcome = await groundReference(ks.name, "keyStop", ctx);
  if (outcome.kind === "pool-hit") {
    return { kind: "kept", kept: { name: outcome.poi.id, note: ks.note }, resolved: null };
  }
  if (outcome.kind === "resolved") {
    return {
      kind: "kept",
      kept: { name: ks.name, note: ks.note },
      resolved: { ...outcome.place, name: ks.name, where: "keyStop" },
    };
  }
  return { kind: "dropped", poiId: ks.name, reason: outcome.reason, flag: outcome.flag };
}

/** Normalize a place name for pool matching: lowercase, strip diacritics +
 *  punctuation, collapse whitespace. */
function normalizePlaceName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Match a model-named place to a pooled POI by EXACT normalized name only.
 *  Fuzzy/token-subset matching was tried and removed — it mis-bound
 *  "Cedar City" → "Cedar City Field Office" and "Green River" → "Green River
 *  Gap" (a town name grabbing a more-specific POI in the same locality).
 *  Exact-only has zero mis-bind surface; any non-exact name falls through to
 *  live Google resolution, which resolves those correctly (Cedar City → the
 *  town). An exact match keeps the pooled place's corpus id/rating/coords. */
function matchPool(
  ref: string,
  poolByName: Map<string, PoolPOI>,
): PoolPOI | null {
  return poolByName.get(normalizePlaceName(ref)) ?? null;
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
  /** Start-of-day openers added by the backfill because the model kept
   *  nothing near the day's start anchor (`anchor-backfill.ts`). Empty when
   *  the model covered every start itself OR when nothing cleared the bar —
   *  the two are deliberately indistinguishable here; `summary` reports the
   *  count so a run's behaviour is visible without persisting the report. */
  anchorBackfills: {
    day: number;
    poiId: string;
    name: string;
    /** Which gap it filled — a day opener, or a town passed through. */
    kind: "start" | "corridor";
    /** The anchor's display label (day start place, or corridor city). */
    anchor: string;
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
  // Pool indexed by normalized name — the model references places by name, so
  // we match names back to the pool (keeping corpus id/rating/coords).
  const poolByName = new Map<string, PoolPOI>(
    facts.poolPOIs.map((p) => [normalizePlaceName(p.name), p]),
  );
  // Same pool keyed by corpus id — a kept pool-hit's ref IS its id, so this is
  // how the backfill looks up what the model already placed.
  const poolById = new Map<string, PoolPOI>(facts.poolPOIs.map((p) => [p.id, p]));
  const capMi = input.params.maxDailyDriveMi;

  const report: AuditReport = {
    distanceSnaps: [],
    droppedPois: [],
    anchorBackfills: [],
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

  // Backfilled POIs are deduped across the WHOLE trip, not just within a day.
  // Measured need: two consecutive days can share a corridor city (day N ends
  // where day N+1 starts, or both pass the same town), and a per-day set let
  // the same place be featured on both `[measured 2026-08-25]`.
  const backfilledTripWide = new Set<string>();
  const auditedDays: DayPlan[] = [];
  const dayRoutes: DayRoute[] = [];
  // Cap is a runaway guard, not a budget throttle — scale it so it never
  // clips a legitimate trip's names (a 19-day trip emits ~60). Dedup does the
  // real cost control; the corpus-feedback loop drives cost DOWN over time.
  const resolver = new PlaceResolver(Math.max(80, output.days.length * 8));

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
          category: r.place.category,
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

    // Corridor guard: a resolved place must sit within GUARD_MI of the day's
    // route. `locationBias` is soft, so this HARD check is what rejects far-off
    // ambiguous matches (e.g. bare "Bear Glacier" → the Alaska one, ~1400 mi
    // off-route). On a dwell / out-and-back day there's no forward polyline, so
    // it degrades to straight-line from the base town — use the wider
    // DWELL_GUARD_MI there so legit rest-day excursions (Ancient Forest ~63mi)
    // aren't wrongly dropped, while wrong-region junk (~1000mi+) still fails.
    const onCorridor = (coord: [number, number]): boolean => {
      if (dayPolyline) return pointToPolylineMi(coord, dayPolyline) <= GUARD_MI;
      if (dayAnchorCoord)
        return haversineMi(coord, dayAnchorCoord) <= DWELL_GUARD_MI;
      return false; // can't establish the day's location → can't verify → reject
    };
    const biasCoord =
      dayAnchorCoord ?? facts.anchorsResolved[0]?.coords ?? [0, 0];

    // ── Ground every named place: pool-first → live-resolve → drop ──────
    // Grounding operates on the NAME (ks.name); the note never resolves — it's
    // descriptive context, carried through so the tile can show it. After the
    // audit `name` holds the resolved ref (corpus id on pool-hit, name on
    // resolve), mirroring the pre-object string[].
    const keptStops: KeyStop[] = [];
    for (const ks of day.keyStops) {
      const g = await groundKeyStop(ks, { poolByName, resolver, biasCoord, onCorridor });
      if (g.kind === "kept") {
        keptStops.push(g.kept);
        if (g.resolved) {
          resolvedPlaces.push(g.resolved);
          report.resolved.push({ day: day.n, name: ks.name, where: "keyStop" });
        }
      } else {
        report.droppedPois.push({ day: day.n, poiId: g.poiId, where: "keyStop", reason: g.reason });
        flags.push(g.flag);
      }
    }

    // ── Start-of-day backfill (follow-up to #274) ──────────────────────
    // #274's prompt SPREAD instruction improved mid-corridor and day-end
    // coverage but left the START of a day frequently empty. If the model kept
    // nothing near this day's start anchor, pick one opener from the pool it
    // was already given. Deterministic, no re-ask, no network — and it returns
    // null rather than padding when nothing clears the bar. See
    // `anchor-backfill.ts` for why rating is not part of that bar.
    if (BACKFILL_ENABLED && dayStartCoord) {
      // A kept stop's coords come from one of two places depending on how it
      // ground: a pool-hit's ref IS the corpus id, a live-resolve's ref is the
      // name and its coords live on the ResolvedPlace. Check both, or a day
      // whose opener was live-resolved would look empty and get a duplicate.
      const keptCoords: [number, number][] = [
        ...keptStops
          .map((k) => poolById.get(k.name)?.coords)
          .filter((c): c is [number, number] => !!c),
        ...resolvedPlaces
          .filter((r) => r.where === "keyStop")
          .map((r) => r.coords),
      ];

      // Which corridor cities does THIS day pass through?
      //
      // `facts.corridorCities` is the WHOLE-ROUTE spine — the audit has no
      // per-day spine, because that is derived later in `bakeGeneratedDays`.
      // Rather than duplicate that derivation, reuse the day's own corridor
      // guard: a city the guard accepts is on this day's line. Then drop the
      // ones that ARE the day's endpoints — the start is handled as its own
      // anchor below, and the end node hosts the overnight, so a curated stop
      // there is closer to duplication than coverage (the same end-anchor
      // reasoning #275 recorded).
      const endpointCoords: [number, number][] = [dayStartCoord];
      if (dayEndCoord) endpointCoords.push(dayEndCoord);
      //
      // ⚠ Uses the day's POLYLINE directly, NOT `onCorridor`. On a dwell /
      // out-and-back day `onCorridor` degrades to a wide straight-line radius
      // from the base town (`DWELL_GUARD_MI`), which is right for verifying an
      // excursion but far too loose to mean "a town this day drives through" —
      // a live run attributed Carson City to a Mammoth→Mammoth dwell day that
      // way `[measured 2026-08-25]`. A day with no forward polyline passes
      // through nothing, so it contributes no mid-corridor anchors at all.
      const midCorridorCities = (dayPolyline ?? []).length === 0
        ? []
        : facts.corridorCities
        .filter((c) => pointToPolylineMi(c.coords, dayPolyline!) <= GUARD_MI)
        .filter((c) => !endpointCoords.some((e) => haversineMi(c.coords, e) <= ANCHOR_NEAR_MI))
        .sort((a, b) => a.milesFromStart - b.milesFromStart);

      // Traveller order: the start first, then each town as it is reached, so
      // that when the per-day cap bites it drops the LATEST gaps.
      const anchors: BackfillAnchor[] = [
        { coords: dayStartCoord, label: day.startPlace, kind: "start" as const },
        ...midCorridorCities.map((c) => ({
          coords: c.coords,
          label: c.name,
          kind: "corridor" as const,
        })),
      ].filter((a) => anchorIsBare(keptCoords, a.coords));

      const picks = pickBackfillStops({
        anchors,
        pool: facts.poolPOIs,
        keptRefs: new Set([...keptStops.map((k) => k.name), ...backfilledTripWide]),
        onCorridor,
      });

      for (const pick of picks) {
        backfilledTripWide.add(pick.poi.id);
        const note =
          pick.kind === "start"
            ? anchorStopNote(pick.anchorLabel)
            : corridorStopNote(pick.anchorLabel);
        // The start opener leads; corridor fills append. Bake re-orders the
        // spine by along-route mile regardless, so this only affects how the
        // audited object reads.
        if (pick.kind === "start") keptStops.unshift({ name: pick.poi.id, note });
        else keptStops.push({ name: pick.poi.id, note });
        report.anchorBackfills.push({
          day: day.n,
          poiId: pick.poi.id,
          name: pick.poi.name,
          kind: pick.kind,
          anchor: pick.anchorLabel,
        });
      }
    }

    // Overnight: always a NAME → pool-first, else resolve+guard, else desc.
    let overnight = { ...day.overnight };
    // Canonical id of the tile that IS the overnight, so the bake can link it by
    // identity (see `overnightTileRef`). Null on desc-only / drop.
    let overnightRef: string | null = null;
    if (overnight.name) {
      const outcome = await groundReference(overnight.name, "overnight", {
        poolByName,
        resolver,
        biasCoord,
        onCorridor,
      });
      overnightRef = overnightTileRef(outcome);
      if (outcome.kind === "pool-hit") {
        // Pooled overnight — keep the name (the note shows it); its corpus tile
        // arrives via the federated fold. Nothing to strip.
      } else if (outcome.kind === "resolved") {
        resolvedPlaces.push({ ...outcome.place, name: overnight.name, where: "overnight" });
        report.resolved.push({ day: day.n, name: overnight.name, where: "overnight" });
      } else {
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
    } else if (!isLayover && statedMi > capMi + DISTANCE_SNAP_TOLERANCE_MI) {
      // Advisory day — the audit couldn't re-measure it (endpoint didn't
      // resolve, or an out-and-back), so it fell out of the measured
      // structural check above. Enforce the cap on the LLM's STATED distance
      // anyway, so a large unmeasured leg can't silently escape the
      // structural tier (→ triggers regen / surfaces honestly).
      report.structural.push({
        kind: "leg-over-cap",
        day: day.n,
        measuredMi: Math.round(statedMi),
        capMi,
      });
      flags.push({
        kind: "structural",
        severity: "critical",
        message: `This leg (~${Math.round(statedMi)} mi, unverified) exceeds your ${capMi} mi/day cap — needs a re-split.`,
      });
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
        overnightRef,
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
    `${report.anchorBackfills.length} start-of-day backfill(s) · ` +
    `${droppedCount} place(s) dropped · ${computedGaps.length} fuel gap(s) computed · ` +
    `${report.structural.length} structural issue(s)`;

  return { audited, report, structural: report.structural, dayRoutes };
}
