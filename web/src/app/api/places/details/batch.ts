/**
 * Pure helper for `POST /api/places/details`. No I/O, no cache, no Google.
 *
 * Lives here rather than in `route.ts` because Next validates the exports of a
 * route file against the handler shape, so a helper exported for testing cannot
 * sit there. Keeping it pure is what makes it testable (node:test via tsx, no
 * module mocking).
 *
 * The old `chunk` / `BATCH_SIZE` batching helpers were removed 2026-09-03 when
 * the route cut over to `enrichByGoogleId()`, which owns its own batching
 * (`ENRICH_BATCH = 40`, the same fan-out ceiling the old `BATCH_SIZE` held).
 * Only id parsing remains here.
 */

/**
 * Validate and normalise `{ placeIds: string[] }`.
 *
 * Returns null when the body is malformed (the caller answers 400). Dedupes via
 * `Set`, which preserves first-occurrence order — the caller's order is
 * load-bearing, since the client builds it in mounted-day order.
 *
 * Deliberately does NOT truncate. The `.slice(0, MAX_IDS)` that used to end this
 * function is the defect that was fixed: it dropped ids with no error and no
 * signal, and the client could not tell a short response from a complete one.
 */
export function parsePlaceIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const ids = (body as { placeIds?: unknown }).placeIds;
  if (!Array.isArray(ids)) return null;
  if (!ids.every((x): x is string => typeof x === "string" && x.length > 0)) {
    return null;
  }
  return Array.from(new Set(ids));
}
