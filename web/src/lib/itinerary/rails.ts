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
 * `checkRails` = phase guards + the property guard, for the TEST-only living-plan
 * actions. Shipped paths call `checkNotFrozen` alone.
 */
const TEST_REF = "znldzjdatkogdktymtvi";
const FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"]);

export type RailsFailure = { ok: false; error: string };

/** PROPERTY guard: refuse a frozen (live PROD) trip. The ONE forbidden-id list
 *  and its ONE implementation — `checkRails` composes it, and shipped user-trip
 *  paths call it directly (without the phase guards). */
export function checkNotFrozen(tripId: string): RailsFailure | null {
  if (FORBIDDEN_IDS.has(tripId)) {
    return { ok: false, error: "This trip is live and cannot be re-planned." };
  }
  return null;
}

/** Flag + forbidden-id + TEST-ref gate. Every TEST-only living-plan action calls
 *  this first. Order unchanged: phase (flag) → property (frozen) → phase (ref). */
export function checkRails(tripId: string): RailsFailure | null {
  if (process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT !== "1") {
    return { ok: false, error: "Living-plan editing is not enabled." };
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
