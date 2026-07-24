/**
 * Shared write-rails for trip mutations. Two KINDS of guard live here:
 *
 *   - PHASE guards (flag + TEST-ref): the living-plan / node-model write path is
 *     pre-prod, so it's fenced to the TEST project behind a dev flag. These
 *     disappear at ADR §1 when the write path moves to user-owned trips.
 *   - PROPERTY guard (forbidden-id, `checkNotFrozen`): the live PROD trip stays
 *     frozen regardless of phase. This one applies even to SHIPPED user-trip
 *     paths (the waypoint actions), where the phase guards would be wrong — a
 *     shipped feature must not be fenced to TEST.
 *
 * The phase-guarded gate is SPLIT by surface, because the two surfaces are two
 * different cost profiles behind two different flags:
 *   - `checkManualRails` (NEXT_PUBLIC_LIVING_PLAN_EDIT) — manual node-actions,
 *     pure overlay writes, no LLM spend.
 *   - `checkNlRails` (NEXT_PUBLIC_NL_EDIT) — NL edit-actions, per-interaction
 *     Opus spend with no quota/rate-limit infra; unset => off (the prod end
 *     state). See docs/decisions/2026-07-18-living-plan-productionization-scope.md.
 * Both compose the SAME property guard (`checkNotFrozen`) and the SAME TEST-ref
 * phase guard — only the flag and the disabled-error string differ. Shipped
 * paths call `checkNotFrozen` alone.
 */
const TEST_REF = "znldzjdatkogdktymtvi";
const FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"]);

export type RailsFailure = { ok: false; error: string };

/** PROPERTY guard: refuse a frozen (live PROD) trip. The ONE forbidden-id list
 *  and its ONE implementation — both surface gates compose it, and shipped
 *  user-trip paths call it directly (without the phase guards). */
export function checkNotFrozen(tripId: string): RailsFailure | null {
  if (FORBIDDEN_IDS.has(tripId)) {
    return { ok: false, error: "This trip is live and cannot be re-planned." };
  }
  return null;
}

/** Flag + forbidden-id + TEST-ref gate, parameterized ONLY by which env flag
 *  turns the surface on and the message when it's off. `checkNotFrozen` (property)
 *  and the TEST-ref check (phase) are identical across surfaces — do not diverge
 *  them. Order unchanged: phase (flag) → property (frozen) → phase (ref). */
function checkRailsWithFlag(
  tripId: string,
  flagEnabled: boolean,
  disabledError: string,
): RailsFailure | null {
  if (!flagEnabled) {
    return { ok: false, error: disabledError };
  }
  const frozen = checkNotFrozen(tripId);
  if (frozen) return frozen;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  if (ref !== TEST_REF) {
    return {
      ok: false,
      error: `Refusing: Supabase ref is ${ref}, not TEST. Point dev at the TEST project.`,
    };
  }
  return null;
}

/** MANUAL surface (node-actions): pure overlay writes, no LLM spend. Reads
 *  NEXT_PUBLIC_LIVING_PLAN_EDIT. Behavior unchanged from the pre-split checkRails. */
export function checkManualRails(tripId: string): RailsFailure | null {
  return checkRailsWithFlag(
    tripId,
    process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT === "1",
    "Living-plan editing is not enabled.",
  );
}

/** NL surface (edit-actions): per-interaction Opus spend, no quota/rate-limit
 *  infra. Reads its OWN flag NEXT_PUBLIC_NL_EDIT — unset => off, the desired prod
 *  end state, so this stays dark while manual stays live. */
export function checkNlRails(tripId: string): RailsFailure | null {
  return checkRailsWithFlag(
    tripId,
    process.env.NEXT_PUBLIC_NL_EDIT === "1",
    "Change-trip (NL) editing is not enabled.",
  );
}
