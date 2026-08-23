/**
 * verify-places-details-wired.ts — LIVE proof that the WIRED
 * POST /api/places/details route (not enrichByGoogleId in isolation) returns
 * correct enrichment end-to-end with DATE_DETAIL_USE_RESOLVER on, plus a
 * flag-off contrast on the same ids.
 *
 * Drives the real POST handler (which reads the flag at module load, so this
 * script sets the env var BEFORE dynamic-importing the route), builds a real
 * Request, and inspects `{ details }`.
 *
 * PURE GOOGLE PASSTHROUGH — no Supabase, no DB. The route chain
 * (route → handler → enrichByGoogleId → placeDetails) touches only Google
 * Place Details. `.env.local` is loaded ONLY for GOOGLE_PLACES_API_KEY; its
 * Supabase vars are never used (no client is created), so nothing DB is touched.
 *
 * Run BOTH modes (each a fresh process → fresh in-process cache):
 *   npx tsx --env-file=.env.local scripts/verify-places-details-wired.ts --on
 *   npx tsx --env-file=.env.local scripts/verify-places-details-wired.ts --off
 */
import type { PlaceRich } from "@/lib/discovery/google-places";

// Real, resolvable Google place_ids (probed this session) + one garbage id that
// Google rejects (INVALID_ARGUMENT) → placeDetails returns null → must be omitted.
const REAL_A = "ChIJN1t_tDeuEmsRUsoyG83frY4";
const REAL_B = "ChIJj61dQgK6j4AR4GeTYWZsKWw";
const GARBAGE = "ChIJVVVVVVVVVVVVVVVVVVVVVVV";

async function main() {
  const mode = process.argv.includes("--on") ? "on" : "off";

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.error("REFUSING: GOOGLE_PLACES_API_KEY not set (load --env-file=.env.local).");
    process.exit(1);
  }

  // Set the flag BEFORE importing the route (it reads env at module load).
  process.env.DATE_DETAIL_USE_RESOLVER = mode === "on" ? "true" : "false";
  const { POST } = await import("@/app/api/places/details/route");

  const req = new Request("http://localhost/api/places/details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeIds: [REAL_A, REAL_B, GARBAGE] }),
  });
  const res = await POST(req);
  const status = res.status;
  const { details } = (await res.json()) as { details: Record<string, PlaceRich> };

  console.log(`\n=== mode: FLAG ${mode.toUpperCase()} ===`);
  console.log(`status ${status}`);
  console.log(`keys: ${JSON.stringify(Object.keys(details))}`);
  for (const id of [REAL_A, REAL_B]) {
    const d = details[id];
    console.log(
      `  ${id} → ${d ? `rating=${d.rating} reviews=${d.reviewCount} photo=${d.photoUrl ? "yes" : "no"} hours=${d.hours ? "yes" : "no"}` : "ABSENT"}`,
    );
  }
  console.log(`  ${GARBAGE} → ${GARBAGE in details ? "PRESENT (bad!)" : "absent (correct)"}`);

  // Hard gate — identical for both modes (both are Google passthroughs; the
  // routing difference is proven at unit level, this proves end-to-end data).
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
    console.error(`\nFAIL (flag ${mode}):`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  // Emit a stable line the caller can diff across the two runs.
  console.log(
    `RESULT_JSON ${JSON.stringify({
      keys: Object.keys(details).sort(),
      a: { rating: details[REAL_A]?.rating, reviews: details[REAL_A]?.reviewCount },
      b: { rating: details[REAL_B]?.rating, reviews: details[REAL_B]?.reviewCount },
    })}`,
  );
  console.log(
    `\nPASS (flag ${mode}): wired route returned real enrichment for both ids, garbage omitted.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
