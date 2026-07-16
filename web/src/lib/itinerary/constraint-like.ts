/**
 * Local, zero-cost heuristic for the living-plan search-box affordance: does
 * a search query LOOK like a plan constraint ("arrive at Salmon Glacier on
 * the 19th") rather than a place search ("gas near Dease Lake")?
 *
 * Used to OFFER — never to route. When it fires, FindNearbyPanel shows one
 * additive "re-plan for this?" row above the place results; the place search
 * itself is untouched, so a false positive is ignorable noise and a false
 * negative just means no shortcut. That asymmetry is why a cheap regex is
 * the right tool here — the REAL parse (LLM, lib/itinerary/edit.ts) runs
 * only after the user clicks the offer.
 *
 * Fires only when BOTH are present:
 *   - a constraint verb (arrive / get to / be at / stay / skip / add …)
 *   - a date-ish or duration token ("on the 19th", "july 19", "7/19",
 *     "2026-07-19", "an extra day", "2 nights")
 * The conjunction is what keeps place names honest: "Stay Inn Motel Dease
 * Lake" has a verb but no date; "2 day hike viewpoint" has a duration but
 * no verb.
 */

const CONSTRAINT_VERB =
  /\b(arrive|arriving|get\s+to|be\s+(at|in)|stay(ing)?|skip(ping)?|add(ing)?|leave|leaving|depart(ing)?|spend(ing)?|extend)\b/i;

const DATE_OR_DURATION = new RegExp(
  [
    // "on the 19th", "by the 19th", "on 19", "by 19th"
    String.raw`\b(on|by)\s+(the\s+)?\d{1,2}(st|nd|rd|th)?\b`,
    // "july 19", "jul 19th"
    String.raw`\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?\b`,
    // "7/19", "07/19"
    String.raw`\b\d{1,2}/\d{1,2}\b`,
    // ISO "2026-07-19"
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    // "a day", "an extra day", "one more night", "2 nights"
    String.raw`\b(a|an|one|two|three|four|five|\d+)\s+((more|extra)\s+)?(day|night)s?\b`,
  ].join("|"),
  "i",
);

export function isConstraintLike(query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  return CONSTRAINT_VERB.test(q) && DATE_OR_DURATION.test(q);
}
