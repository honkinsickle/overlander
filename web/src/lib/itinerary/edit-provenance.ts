/**
 * Living-plan provenance + staging helpers — PURE, no server/DB imports, so
 * `edit-actions.ts` (a "use server" module, which may only export async server
 * actions) keeps these here and this file stays unit-testable.
 *
 * Three concerns, all born from the 2026-07-18 diagnosis:
 *   - summarizeSignature: a human-readable one-liner from an editSignature, so
 *     an applied trip records WHAT changed (not just a date-stamped version).
 *   - versionStamp: a full-ISO version stamp — never a UTC-truncated date,
 *     which stamps an evening-Pacific write as the next day and misled the
 *     investigation.
 *   - pendingClash: the decision to block silently overwriting an existing
 *     staged edit (the likely way a staged change of Adam's vanished).
 */

import type { LivingPlanProvenance } from "@/lib/trips/types";

export type { LivingPlanProvenance };

/** The signature + summary carried on a staged `<tripId>--pending` payload. */
export type PendingProvenance = {
  signature: string;
  summary: string;
};

/** Blocked-staging result: a DIFFERENT edit is already staged. */
export type PendingClashResult = {
  ok: false;
  kind: "pending-clash";
  existing: PendingProvenance;
  error: string;
};

/**
 * A human-readable one-line summary of an editSignature. Derived from the
 * signature itself (the canonical description of what was applied) so it can
 * never disagree with the change that actually landed. Signatures are
 * "|"-joined parts whose last element is the scope ("full" | "partial").
 */
export function summarizeSignature(signature: string): string {
  const parts = signature.split("|");
  const kind = parts[0];
  const scope = parts[parts.length - 1];
  const mid = parts.slice(1, -1);
  const tail = scope === "partial" ? " (from where you are)" : "";
  const nights = (n: string) => `${n} night${n === "1" ? "" : "s"}`;

  let body: string;
  switch (kind) {
    case "arrive-by":
      body = `Arrive at ${mid[0]} by ${mid[1]}`;
      break;
    case "add-stop": {
      const mode = mid[1];
      const modeText =
        mode === "add-days"
          ? " (+1 day)"
          : mode === "adjust"
            ? " (keeping your dates)"
            : "";
      body = `Add ${mid[0]}${modeText}`;
      break;
    }
    case "reschedule":
      body = `Reschedule ${mid[0]} to ${mid[1]}`;
      break;
    case "stay-longer":
      body = `Stay ${nights(mid[1])} longer at ${mid[0]}`;
      break;
    case "skip":
      body = `Skip ${mid[0]}`;
      break;
    case "change-end":
      body = `Change trip end to ${mid[0]}`;
      break;
    default:
      // Unknown shape → never fabricate; echo the raw signature verbatim.
      return signature;
  }
  return body + tail;
}

/**
 * A `reference_trips.source_version` stamp carrying the FULL instant, not a
 * UTC-truncated date. `toISOString().slice(0, 10)` stamps any write after
 * ~17:00 Pacific as the next UTC day — which actively misled a diagnosis.
 * `at` is injectable for tests.
 */
export function versionStamp(
  kind: "pending" | "applied",
  at: Date = new Date(),
): string {
  return `livingplan-${kind}@${at.toISOString()}`;
}

/**
 * Build the provenance stamped on a trip when an edit is applied. `summary`
 * comes from the staged row when present (already derived at stage time),
 * else re-derived from the signature so it is always populated.
 */
export function buildAppliedProvenance(
  signature: string,
  summary: string | undefined,
  at: Date = new Date(),
): LivingPlanProvenance {
  return {
    signature,
    summary: summary ?? summarizeSignature(signature),
    appliedAt: at.toISOString(),
  };
}

/**
 * Pure decision: should staging a new edit be blocked by an existing pending
 * row? Block ONLY when a DIFFERENT edit is already staged and the caller has
 * not confirmed replacement — re-staging the identical signature is a benign
 * preview refresh, and an explicit replace is the user's choice. Anything else
 * would silently discard staged work (how a staged edit went missing).
 */
export function pendingClash(
  existing: PendingProvenance | null,
  nextSignature: string,
  replaceExisting: boolean,
): { blocked: false } | { blocked: true; existing: PendingProvenance } {
  if (!existing || replaceExisting || existing.signature === nextSignature) {
    return { blocked: false };
  }
  return { blocked: true, existing };
}
