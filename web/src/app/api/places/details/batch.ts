/**
 * Pure helpers for `POST /api/places/details`. No I/O, no cache, no Google.
 *
 * They live here rather than in `route.ts` because Next validates the exports
 * of a route file against the handler shape, so a helper exported for testing
 * cannot sit there. Keeping them pure is also what makes the batching testable
 * at all — the repo convention is node:test via tsx with no module mocking.
 */

/**
 * Ids per batch — and therefore the CONCURRENCY CEILING of this route, since
 * `placeDetails()` issues one `GET /v1/places/{id}` per id and the handler fans
 * a batch out with `Promise.all`. A batch of N ids is N concurrent upstream
 * calls.
 *
 * This is NOT an upstream batch limit. Google Place Details has no batch
 * endpoint; the batching is entirely this route's own construct.
 *
 * The VALUE is inherited, not derived. It arrived as `MAX_IDS = 40` in
 * `79c8cb2`, whose commit message never mentions it, was never modified after,
 * and the two sibling hydrate routes use 50. Nobody has established what it
 * protects, so it is preserved exactly — raising an undocumented limit is a
 * separate decision with its own evidence. See docs/BACKLOG.md § MAX_IDS.
 *
 * What CHANGED is its role: it used to be a hard cap on how many ids a request
 * could carry (ids past the 40th were silently dropped by `.slice(0, MAX_IDS)`
 * — 51 of day 1's 91 on `la-to-deadhorse`). It is now a batch size, so the same
 * ceiling is held while every id is served.
 */
export const BATCH_SIZE = 40;

/**
 * Validate and normalise `{ placeIds: string[] }`.
 *
 * Returns null when the body is malformed (the caller answers 400). Dedupes
 * via `Set`, which preserves first-occurrence order — the caller's order is
 * load-bearing, since the client builds it in mounted-day order and the batches
 * below are consumed in sequence.
 *
 * Deliberately does NOT truncate. The `.slice(0, MAX_IDS)` that used to end
 * this function is the defect being fixed: it dropped ids with no error and no
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

/**
 * Split into consecutive batches of at most `size`, preserving order.
 *
 * An empty input yields an empty array (no batches, so the caller's loop does
 * nothing). A list at or under `size` yields exactly ONE batch, which is what
 * keeps the common case byte-for-byte identical to the pre-chunking behaviour.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
