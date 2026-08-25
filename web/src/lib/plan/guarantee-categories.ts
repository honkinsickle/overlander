import type { SlideCategoryKey } from "@/lib/trip-browse/places";

/**
 * The pool-side interest categories the D-B per-city guarantee mechanism
 * actually honors, in wizard display order. This is the UI face of the backend
 * gate `GUARANTEE_CATEGORIES` in `lib/itinerary/anchor-backfill.ts` — the
 * semantic source of truth. `guarantee-categories.test.ts` locks the two sets
 * together so they can't drift.
 *
 * Deliberately NOT the full 9-category taxonomy. Excluded, each for a recorded
 * reason (see docs/decisions/2026-08-25-interest-category-guarantee-granularity.md
 * §"Deviations"):
 *   - `fuel`      — its own checkbox + separate live-resolve path A
 *                   (`fuel-live-resolve.ts`); inert in this pool-only mechanism.
 *   - `overnight` — this is the `SlideCategoryKey` name for the display category
 *                   `hotel` (isomorphic via `palette.ts`). Excluded from the
 *                   backend gate because it would duplicate the dedicated
 *                   per-day overnight slot the #279–#285 chain owns (blocker B.2).
 *   - `interest`  — the junk-drawer catch-all, excluded from the gate.
 *
 * A chip for any of the three would render but silently do nothing, so none is
 * offered (same reasoning that kept the fuel PR from shipping a "1-of-8-working"
 * row). Add one here only once its backend blocker resolves.
 */
export const GUARANTEE_CHIP_CATEGORIES: ReadonlyArray<{
  key: SlideCategoryKey;
  label: string;
}> = [
  { key: "scenic", label: "Scenic" },
  { key: "food", label: "Food" },
  { key: "camping", label: "Camping" },
  { key: "attraction", label: "Attraction" },
  { key: "oddity", label: "Oddity" },
  { key: "urban", label: "Towns" },
];
