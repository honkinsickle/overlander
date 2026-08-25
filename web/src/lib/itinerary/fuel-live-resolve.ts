/**
 * Fuel-category guarantee: a corpus-INDEPENDENT live-resolve for the `fuel`
 * chip on the Interest-Category-Chips wizard section
 * (`docs/specs/interest-category-chips.md` §5.2 B.1).
 *
 * WHY THIS EXISTS. The general backfill selector
 * (`anchor-backfill.ts:pickAnchorStop`) iterates `facts.poolPOIs` only — a
 * corpus fold — and never reaches Google/`PlaceResolver` (comment at
 * `anchor-backfill.ts:11-13` is explicit). Fuel in the guarantee gate is
 * therefore INERT with that mechanism, because the corpus has thin fuel
 * coverage in the far-north/off-corridor regions where the `fuel-POI` layer
 * (per `docs/specs/expedition-planner.md` §8.5) is meant to eventually fill.
 * This module is the intended workaround Adam picked over waiting for that
 * layer: always call Google live for a fuel stop at each anchor where fuel is
 * missing, no corpus fallback.
 *
 * DELIBERATELY NOT `pickAnchorStop`-shaped. It calls a separate `PlaceResolver`
 * method (`resolveNearby`), takes a different input set, and returns a
 * resolver-shaped payload the caller weaves into `keptStops` + `resolvedPlaces`
 * exactly the way live-resolved LLM keyStops flow (`audit.ts:groundKeyStop`
 * with `where: "keyStop"`).
 *
 * NO FALLBACK: if the resolver returns not-found / capped / no-key / off-
 * corridor, the guarantee at THIS anchor simply isn't satisfied. Same
 * "missing stays missing, no bad guess" principle as `pickAnchorStop`'s
 * `return null` and as the overnight-fuzzy-tier's no-match-is-safe rule
 * (`bake.ts` overnight-marking chain, #285).
 */
import { haversineMi } from "@/lib/routing/point-to-polyline";
import { ANCHOR_NEAR_MI, type BackfillAnchor } from "./anchor-backfill";
import type { PlaceResolver, ResolvedName } from "./resolve";

export type FuelPick = {
  resolved: ResolvedName;
  note: string;
};

export type PickFuelAtAnchorInput = {
  /** The anchor to look near — day-start or a mid-corridor city. */
  anchor: BackfillAnchor;
  /** Coords of stops kept on this day that already carry a fuel category —
   *  from `keptStops` pool-hits AND `resolvedPlaces` with a fuel-family
   *  category. If ANY sits within `ANCHOR_NEAR_MI` of the anchor, the
   *  guarantee is already satisfied and this function no-ops (no Google
   *  spend). */
  keptFuelCoords: readonly [number, number][];
  /** The `includedTypes` value for Google's `places:searchNearby` — usually
   *  `"gas_station"`; would be `"electric_vehicle_charging_station"` for an
   *  EV rig. The caller decides per rig (or per trip). */
  fuelType: string;
  /** Shared with the LLM's own keyStop resolves — same per-generation cap
   *  (`RESOLVE_CAP` in `resolve.ts`). */
  resolver: PlaceResolver;
  /** Corridor guard for the day: `PlaceResolver`'s `locationRestriction` is
   *  a hard-circle restrict, so this is a belt-and-suspenders check against
   *  a resolved place that clears the circle but isn't on the driven line. */
  onCorridor: (c: [number, number]) => boolean;
};

/**
 * Ask Google Places for a fuel stop near ONE anchor. Returns `null` when the
 * guarantee is already met, when the resolver returns nothing/no-key/capped,
 * or when the corridor guard rejects the result. Otherwise returns the
 * resolved place + a note the audit uses for the persisted card.
 */
export async function pickFuelAtAnchor(
  input: PickFuelAtAnchorInput,
): Promise<FuelPick | null> {
  if (hasFuelNearAnchor(input.keptFuelCoords, input.anchor.coords)) return null;

  const r = await input.resolver.resolveNearby(input.fuelType, input.anchor.coords);
  if (r.status !== "resolved") return null;
  if (!input.onCorridor(r.place.coords)) return null;

  return { resolved: r.place, note: fuelStopNote(input.anchor.label) };
}

/** Anchor "already covered by a fuel stop" if any kept fuel-category coord is
 *  within the same `ANCHOR_NEAR_MI` radius `anchor-backfill.ts` uses for its
 *  own "is the anchor bare" test. Same radius, same reason: within 25 mi is
 *  the "somewhere you'd stop in the first stretch out of town" band. */
function hasFuelNearAnchor(
  coveredCoords: readonly [number, number][],
  anchor: [number, number],
): boolean {
  return coveredCoords.some((c) => haversineMi(c, anchor) <= ANCHOR_NEAR_MI);
}

/** The persisted card gets ONLY this note as its provenance signal — no
 *  structured `isFuelBackfill` field is added to `BrowsePlace` (parallel to
 *  the `anchor-backfill.ts:299-307` posture). Distinguishable in text from
 *  `anchorStopNote`/`corridorStopNote` so the read side can tell them apart
 *  without new schema. */
export function fuelStopNote(anchorLabel: string): string {
  return `top up on fuel near ${anchorLabel}`;
}
