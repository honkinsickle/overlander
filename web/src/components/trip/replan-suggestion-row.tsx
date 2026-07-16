"use client";

import { Route } from "lucide-react";

/**
 * Living-plan affordance (dev-gated): one additive row above the Find Nearby
 * place results when the query LOOKS like a plan constraint (see
 * lib/itinerary/constraint-like.ts). Offers — never routes: the place search
 * underneath is untouched, and this row renders nothing at all unless
 * NEXT_PUBLIC_LIVING_PLAN_EDIT=1 (dev/TEST only; prod has no flag → no row).
 *
 * Amber styling per the token split (amber = navigation/state; the row is a
 * navigation offer into the re-plan flow, not a form CTA).
 */
export function ReplanSuggestionRow({
  query,
  onReplan,
}: {
  query: string;
  /** Opens the gated parse → confirm → re-plan → diff flow. */
  onReplan?: () => void;
}) {
  if (process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT !== "1") return null;

  return (
    <div
      className="shrink-0"
      style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 10 }}
    >
      <button
        type="button"
        onClick={onReplan}
        aria-label={`Re-plan the trip for: ${query}`}
        className="w-full flex items-center text-left transition-colors hover:bg-white/[0.06]"
        style={{
          gap: 10,
          padding: "10px 14px",
          borderRadius: 8,
          backgroundColor: "rgba(200,169,110,0.10)",
          border: "1px solid var(--amber-dark)",
        }}
      >
        <Route
          className="w-4 h-4 shrink-0"
          style={{ color: "var(--amber)" }}
          strokeWidth={1.75}
        />
        <span className="flex-1 min-w-0">
          <span
            className="block truncate"
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 13,
              color: "var(--text-primary)",
            }}
          >
            Looks like a trip change — “{query}”
          </span>
        </span>
        <span
          className="shrink-0"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--amber)",
          }}
        >
          Re-plan for this?
        </span>
      </button>
    </div>
  );
}
