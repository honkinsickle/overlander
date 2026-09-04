/**
 * verify-places-details-wired.ts — LIVE proof that the WIRED
 * POST /api/places/details route returns correct enrichment end-to-end through
 * resolvePlaces()'s enrichByGoogleId().
 *
 * Post-cutover (2026-09-03): the DATE_DETAIL_USE_RESOLVER flag and the legacy
 * inline placeDetails loop are gone — the route ALWAYS delegates cache-misses to
 * enrichByGoogleId(). This drives the real POST handler, builds a real Request,
 * and asserts real enrichment for real ids + null-omit for a garbage id.
 *
 * PURE GOOGLE PASSTHROUGH — no Supabase, no DB. The route chain
 * (route → handler → enrichByGoogleId → placeDetails) touches only Google
 * Place Details. `.env.local` is loaded ONLY for GOOGLE_PLACES_API_KEY.
 *
 * Run (fresh process → fresh in-process cache):
 *   npx tsx --env-file=.env.local scripts/verify-places-details-wired.ts
 */
import type { PlaceRich } from "@/lib/discovery/google-places";

// Real, resolvable Google place_ids (probed this session) + one garbage id that
// Google rejects (INVALID_ARGUMENT) → placeDetails returns null → must be omitted.
const REAL_A = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const REAL_B = "ChIJj61dQgK6j4AR4GeTYWZsKWw";
const GARBAGE = "ChIJVVVVVVVVVVVVVVVVVVVVVVV";

async function main() {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error("REFUSING: GOOGLE_PLACES_API_KEY not set (load --env-file=.env.local).");
    process.exit(1);
  }

  const { POST } = await import("@/app/api/places/details/route");
  const req = new Request("http://localhost/api/places/details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeIds: [REAL_A, REAL_B, GARBAGE] }),
  });
  const res = await POST(req);
  const status = res.status;
  const { details } = (await res.json()) as { details: Record<string, PlaceRich> };

  console.log(`\n=== POST /api/places/details (post-cutover, enrichByGoogleId) ===`);
  console.log(`status ${status}`);
  console.log(`keys: ${JSON.stringify(Object.keys(details))}`);
  for (const id of [REAL_A, REAL_B]) {
    const d = details[id];
    console.log(
      `  ${id} → ${d ? `rating=${d.rating} reviews=${d.reviewCount} photo=${d.photoUrl ? "yes" : "no"} hours=${d.hours ? "yes" : "no"}` : "ABSENT"}`,
    );
  }
  console.log(`  ${GARBAGE} → ${GARBAGE in details ? "PRESENT (bad!)" : "absent (correct)"}`);

  const failures: string[] = [];
  if (status !== 200) failures.push(`status ${status} != 200`);
  for (const id of [REAL_A, REAL_B]) {
    if (!details[id]) failures.push(`${id} missing — wired route did not return real enrichment`);
    else if (typeof details[id].rating !== "number")
      failures.push(`${id} has no rating — enrichment fields did not flow through`);
  }
  if (GARBAGE in details)
    failures.push(`garbage id present — the null-omit semantics did not survive the wiring`);

  if (failures.length > 0) {
    console.error(`\nFAIL:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    `\nPASS: wired route returned real enrichment for both ids via enrichByGoogleId, garbage omitted.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
