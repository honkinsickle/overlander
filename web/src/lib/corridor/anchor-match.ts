/**
 * Anchor-match: the single source of truth for "is this place the same as a
 * day's start/end anchor?". A curated key stop that IS an anchor must never
 * render as a separate key-stop tile (it's already the anchor city node) — this
 * predicate decides that, everywhere, so no renderer re-remembers the rule.
 *
 * Robust across resolution paths (the same place can arrive as a corpus `mp:`
 * id on one path and a Google-resolved `google:` id on another): match by
 *   1. id equality           — exact same place id, when both carry one;
 *   2. normalized name        — the primary signal (strips a trailing region,
 *                               so "Meziadin Lake Provincial Park" ==
 *                               "Meziadin Lake Provincial Park, British Columbia");
 *   3. coords within a TIGHT gate — same physical point, even if names differ.
 *
 * The coord gate is deliberately tight (ANCHOR_COORD_MI). Evidence: in the
 * Cassiar preview, S.S. Klondike sits 0.42 mi from the Whitehorse anchor yet is
 * a DISTINCT place — a looser gate would wrongly dedup it. Destination hits are
 * essentially coincident (≤0.15 mi) or caught by name, so 0.15 mi is safe.
 */

/** ~0.15 mi ≈ 250 m: "the same point", not "the same town". */
export const ANCHOR_COORD_MI = 0.15;

export type AnchorLike = {
  id?: string;
  name: string;
  coords?: [number, number];
};

/** Lowercase, drop a trailing ", <region>", trim. */
export function normPlaceName(s: string): string {
  return s.toLowerCase().replace(/,\s*[^,]+$/, "").trim();
}

function milesBetween(a: [number, number], b: [number, number]): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** True when a and b are the same place (id | name | tight coords). */
export function isSameAnchorPlace(a: AnchorLike, b: AnchorLike): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  const an = normPlaceName(a.name);
  const bn = normPlaceName(b.name);
  if (an && bn && an === bn) return true;
  if (a.coords && b.coords && milesBetween(a.coords, b.coords) <= ANCHOR_COORD_MI)
    return true;
  return false;
}

/** True when `pick` is the day's START or END anchor (first/last city). */
export function coincidesWithAnchor(
  pick: AnchorLike,
  cities: AnchorLike[],
): boolean {
  if (cities.length === 0) return false;
  const anchors = [cities[0], cities[cities.length - 1]];
  return anchors.some((a) => isSameAnchorPlace(pick, a));
}
