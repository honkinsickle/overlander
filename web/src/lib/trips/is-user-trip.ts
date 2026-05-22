/**
 * Single source of truth for "is this a user-owned trip" — i.e. does
 * its id look like a UUID (matching the `trips.id` PK column on Supabase)
 * as opposed to a reference slug (`la-to-deadhorse`, etc.)?
 *
 * Lives in its own module rather than `user-trips.ts` because that file
 * imports the Supabase server client; client-side callers (SlideupShell,
 * OffCacheBanner) need the check without pulling server code into the
 * bundle. `user-trips.ts` re-exports `isUserTripId` from here so the
 * 15+ server-side call sites don't have to change.
 *
 * Accepts either a string id directly or anything with an `id` field
 * — saves callers a `.id` access when they already have a `Trip` /
 * `OfflinePhase` / Day in scope.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserTrip(tripOrId: { id: string } | string): boolean {
  const id = typeof tripOrId === "string" ? tripOrId : tripOrId.id;
  return UUID_RE.test(id);
}
