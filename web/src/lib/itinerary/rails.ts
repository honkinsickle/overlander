/**
 * Shared write-rails for TEST-only trip mutations (living-plan edits and
 * node-model writes). Extracted from edit-actions.ts so both action modules
 * gate identically — a "use server" file may only export async server actions,
 * so this sync gate can't live there and be imported.
 *
 * The three rails (all must pass before any DB write):
 *   - flag: NEXT_PUBLIC_LIVING_PLAN_EDIT=1 (server-side defense-in-depth;
 *     prod has neither the flag nor the TEST ref).
 *   - forbidden-id: the live PROD trip is never writable.
 *   - TEST-ref: the env Supabase ref must be the TEST project.
 */
const TEST_REF = "znldzjdatkogdktymtvi";
const FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"]);

export type RailsFailure = { ok: false; error: string };

/** Flag + TEST-ref + forbidden-id gate. Every mutating action calls this first. */
export function checkRails(tripId: string): RailsFailure | null {
  if (process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT !== "1") {
    return { ok: false, error: "Living-plan editing is not enabled." };
  }
  if (FORBIDDEN_IDS.has(tripId)) {
    return { ok: false, error: "This trip is live and cannot be re-planned." };
  }
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
