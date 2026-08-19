/**
 * "Filter C" — the content filter for OSM viewpoint descriptions.
 *
 * The viewpoint category was deactivated wholesale in 47e00e4 because 80.7% of
 * its OSM rows carry nothing beyond the bare category tag. A 2026-08-19
 * investigation of the ~200 rows that DO carry a description found the subset is
 * overwhelmingly real visitor content, but salted with rows that are non-null
 * yet structurally contentless. This is the filter that separates them.
 *
 * ── WHAT IT EXCLUDES ─────────────────────────────────────────────────────
 *   - under 15 characters      ("Great view", "cool place", "Elevation 520")
 *   - a single word            ("overlook", "bench", "Northbound", "Cheetahs")
 *   - an exact name restatement ("Colorado River Overlook" on a place of that
 *                                name — says nothing the title doesn't)
 *   - URL-only content         (a bare image link)
 *
 * ── WHAT IT DELIBERATELY KEEPS ───────────────────────────────────────────
 *   - SHORT BUT REAL content: "View of San Francisco." (22 chars) tells a
 *     visitor what they will see. A pure length threshold would discard it.
 *   - `note`-tag content. OSM convention treats `note` as mapper-to-mapper
 *     commentary, and the investigation expected junk — but measured **0 rows**
 *     containing mapper vocabulary (fixme / survey / verify / imagery / JOSM
 *     …), while the note rows carry some of the best material in the set: trail
 *     directions, snake warnings, private-property access limits, parking
 *     counts. Excluding `note` would throw away safety and access information.
 *
 * Chosen over two alternatives, both rejected on measured evidence: a
 * description-tag-only + 40-char rule (drops the note content above, and still
 * admits a 48-char vandalism entry — length does not separate signal from
 * noise here), and a stricter 40-char variant of this same filter.
 *
 * Pure function, no I/O — so the reactivation and its verification share one
 * definition and cannot drift apart.
 */

/** Lowercase, strip punctuation, collapse whitespace — for name comparison. */
function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export const MIN_DESCRIPTION_CHARS = 15;

/**
 * `no-description` and `under-min-chars` are deliberately distinct. Absent is
 * not the same as short: a row with no description never entered the described
 * population at all, whereas a short one did and was judged contentless. Both
 * are excluded, but conflating them makes the reason code lie to any caller
 * reading it.
 */
export type JunkReason = "no-description" | "url-only" | "single-word" | "name-restatement" | "under-min-chars";

/**
 * Why this description is contentless, or `null` if it is real content.
 * `name` is the source_record's own name, used for the restatement test.
 */
export function classifyViewpointDescription(
  description: string | null | undefined,
  name: string | null | undefined,
): JunkReason | null {
  const d = (description ?? "").trim();
  if (d.length === 0) return "no-description";
  if (/^https?:\/\//i.test(d)) return "url-only";
  if (d.split(/\s+/).length === 1) return "single-word";
  if (normalizeForCompare(d) === normalizeForCompare(name ?? "")) return "name-restatement";
  if (d.length < MIN_DESCRIPTION_CHARS) return "under-min-chars";
  return null;
}

/** True when the description is real content and the row should go live. */
export function passesViewpointContentFilter(
  description: string | null | undefined,
  name: string | null | undefined,
): boolean {
  return classifyViewpointDescription(description, name) === null;
}
