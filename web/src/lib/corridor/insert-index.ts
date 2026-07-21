/**
 * Pointer-vs-rect insertion index for a vertical card list (spec Option B, drop
 * path — Option 2). Given the cluster's sibling rects in DOM/display order and
 * the drop pointer's Y, return where the dragged card should land. Pure DOM
 * geometry — no dnd-kit, no React, no state. The clusters stay plain
 * `useDroppable`; this derives the index the drop needs without SortableContext
 * (that's the idiomatic source, deferred to a later fidelity pass).
 *
 * The returned index is in the space of the siblings WITH `selfIndex` removed —
 * the caller rebuilds the final order by dropping self out and splicing it back
 * at this index. So on a same-cluster reorder pass `selfIndex` (the dragged
 * card's position, still in the DOM but excluded from the comparison); on a
 * cross-cluster drop pass `null`.
 */
export function computeInsertIndex(
  siblingRects: readonly DOMRect[],
  pointerY: number,
  selfIndex: number | null,
): number {
  // Exclude the dragged card itself before comparing (it's still mounted).
  const comparison = siblingRects.filter((_, i) => i !== selfIndex);
  if (comparison.length === 0) return 0;
  // Insert AFTER every sibling whose vertical midpoint sits above the pointer;
  // i.e. the index = count of siblings the pointer has passed. A pointer exactly
  // on a midpoint inserts ABOVE that card (strict <). Above all → 0; below all →
  // comparison.length.
  let index = 0;
  for (const r of comparison) {
    if (r.top + r.height / 2 < pointerY) index++;
    else break;
  }
  return index;
}
