/**
 * Pure helpers for the continuous day-detail scroll (Design A). The scroll is a
 * PRESENTATION LAYER ONLY — these functions carry no model state, no overlays,
 * and no side effects. They exist so the two pieces that are pure math (the
 * never-mounted height estimate and the centered-day pick with hysteresis) are
 * unit-testable away from the DOM. The IntersectionObserver / ResizeObserver /
 * scroll wiring lives in `continuous-day-stack.tsx`.
 */

/** Chrome a day slot occupies before any place rows: day header band + hero +
 *  briefing gap + footer CTA. Deliberately generous — an over-estimate keeps a
 *  never-yet-mounted placeholder from collapsing (which would jump the scroll
 *  UP when the real, taller content mounts). Once mounted, the measured height
 *  from ResizeObserver replaces the estimate. */
const DAY_CHROME_PX = 520;
/** Approx height of one CategoryListCard place row (card + 8px inter-row gap).
 *  Sized to the description-present card (title 23 + gap 2 + verified 20 +
 *  gap 2 + description 2×21 + gap 2 + status/Details 18 + top pad 4 = 113,
 *  + 8 inter-row gap = 121; rounded to 127 for the small safety margin the
 *  DAY_CHROME_PX docstring calls for — over-estimate is safe here because
 *  ResizeObserver replaces the estimate on mount, while under-estimate would
 *  jump the cold-scroll placeholder DOWN when the real content mounts). */
const PLACE_ROW_PX = 127;

/** Model-driven height estimate for a day never mounted yet. `poolCount` is
 *  `placePool(day).length`, known from the payload without mounting. */
export function estimateDayHeight(poolCount: number): number {
  const rows = Math.max(0, poolCount);
  return DAY_CHROME_PX + PLACE_ROW_PX * rows;
}

/** A day's vertical span in the scroll content's coordinate space. */
export type DaySlotSpan = {
  id: string;
  /** Offset of the slot's top edge within the scrolled content. */
  top: number;
  /** Offset of the slot's bottom edge within the scrolled content. */
  bottom: number;
};

/**
 * Pick the day whose span sits at the viewport center, with hysteresis so the
 * signal doesn't flap while a day boundary hovers near center.
 *
 * `viewportCenter` is `scrollTop + viewportHeight / 2` in content coordinates.
 * `prev` is the previously-centered day id (or null). `deadZonePx` is the
 * margin a boundary must cross past center before the pick flips (~15% of
 * viewport height at the call site).
 *
 * Rule: if `prev` is still a real slot and the center is within `[prevTop -
 * deadZone, prevBottom + deadZone]`, keep `prev`. Otherwise return the raw
 * slot under the center (clamped to the ends). "Raw pick, not neighbor-step"
 * so a fast jump lands on the right day directly instead of walking days.
 */
export function pickCenteredDay(
  slots: DaySlotSpan[],
  viewportCenter: number,
  prev: string | null,
  deadZonePx: number,
): string | null {
  if (slots.length === 0) return null;

  const prevSlot = prev ? slots.find((s) => s.id === prev) : undefined;
  if (
    prevSlot &&
    viewportCenter >= prevSlot.top - deadZonePx &&
    viewportCenter <= prevSlot.bottom + deadZonePx
  ) {
    return prevSlot.id;
  }

  // Raw pick: the slot whose half-open span contains the center.
  for (const s of slots) {
    if (viewportCenter >= s.top && viewportCenter < s.bottom) return s.id;
  }
  // Center sits in a gap or past an end — clamp to first/last.
  const first = slots[0];
  if (viewportCenter < first.top) return first.id;
  return slots[slots.length - 1].id;
}
