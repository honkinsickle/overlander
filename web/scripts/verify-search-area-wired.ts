/**
 * verify-search-area-wired.ts — LIVE proof that the WIRED /api/search-area
 * route (not resolvePlaces in isolation) returns correct results end-to-end
 * with the SEARCH_AREA_USE_RESOLVER flag on. Closes the gap #259 left open.
 *
 * Drives the real GET handler (which reads the flag at module load, so this
 * script sets the env var BEFORE dynamic-importing the route), builds a real
 * Request, and inspects the JSON. Federated half hits Typesense (places_test)
 * + Supabase (TEST); live half hits Google if a key is present (its absence is
 * reported, not fatal).
 *
 * READ-ONLY. TEST project only — asserts the Supabase URL is TEST and refuses
 * to run otherwise.
 *
 * Run BOTH modes (env cascade mirrors `next dev`: .env.local gives Typesense
 * places_test, .env.development.local overrides Supabase to TEST):
 *   npx tsx --env-file=.env.local --env-file=.env.development.local \
 *     scripts/verify-search-area-wired.ts --on
 *   npx tsx --env-file=.env.local --env-file=.env.development.local \
 *     scripts/verify-search-area-wired.ts --off
 */
import type { BrowsePlace } from "@/lib/trip-browse/places";

const TEST_REF = "znldzjdatkogdktymtvi";
const PROD_REF = "nqzeywzcowujzyegxbsr";

// All of California — dense six-state corpus coverage across tiers.
const BBOX = "-124.5,32.5,-114.0,42.0";
const CATEGORIES = "campground,rv_park,dispersed_camping,viewpoint,peak,scenic_spot";

type Payload = {
  source: string;
  places: BrowsePlace[];
  counts: { live: number; federated: number };
  failedSources: string[];
  sourceErrors?: Record<string, string>;
};

function tierViolations(places: BrowsePlace[]): number {
  // A violation = a verified place appearing AFTER an unverified one. Zero iff
  // the list is tier-sorted (verified block, then unverified block).
  let seenUnverified = false;
  let violations = 0;
  for (const p of places) {
    if (p.verified === "unverified") seenUnverified = true;
    else if (p.verified === "verified" && seenUnverified) violations++;
  }
  return violations;
}

async function main() {
  const mode = process.argv.includes("--on") ? "on" : "off";

  // ── SAFETY: TEST project only ──────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes(PROD_REF) || !url.includes(TEST_REF)) {
    console.error(
      `REFUSING: Supabase URL is not TEST (${TEST_REF}). Got: ${url || "<unset>"}. ` +
        `Load .env.development.local AFTER .env.local so TEST wins.`,
    );
    process.exit(1);
  }

  // Set the flag BEFORE importing the route (the route reads it at module load).
  process.env.SEARCH_AREA_USE_RESOLVER = mode === "on" ? "true" : "false";
  const { GET } = await import("@/app/api/search-area/route");

  const reqUrl = `http://localhost/api/search-area?bbox=${BBOX}&categories=${encodeURIComponent(
    CATEGORIES,
  )}&debug=1`;
  const res = await GET(new Request(reqUrl));
  const status = res.status;
  const payload = (await res.json()) as Payload;

  const places = payload.places ?? [];
  const federated = places.filter((p) => p.source === "master_place");
  const live = places.filter((p) => p.source === "live");
  const liveUntagged = places.filter((p) => p.source === undefined);
  const verifiedFed = federated.filter((p) => p.verified === "verified").length;
  const unverifiedFed = federated.filter((p) => p.verified === "unverified").length;
  const violations = tierViolations(places);

  console.log(`\n=== mode: FLAG ${mode.toUpperCase()} ===`);
  console.log(`status ${status} · x-cache ${res.headers.get("x-cache")}`);
  console.log(
    `places ${places.length} · counts ${JSON.stringify(payload.counts)} · ` +
      `failedSources ${JSON.stringify(payload.failedSources)}`,
  );
  console.log(
    `by source: master_place ${federated.length} · live(tagged) ${live.length} · ` +
      `live(untagged) ${liveUntagged.length}`,
  );
  console.log(
    `federated tiers: verified ${verifiedFed} · unverified ${unverifiedFed} · ` +
      `tier-ordering violations ${violations}`,
  );

  if (mode === "on") {
    // HARD GATE — would fail if the wiring were wrong.
    const failures: string[] = [];
    if (status !== 200) failures.push(`status ${status} != 200`);
    if (places.length === 0) failures.push("no places returned");
    if (federated.length === 0)
      failures.push("no federated places — cannot test tiers (widen bbox/categories)");
    if (verifiedFed === 0)
      failures.push("zero verified federated places — the tier data did not flow through");
    if (violations !== 0)
      failures.push(`${violations} tier-ordering violation(s) — resolvePlaces sort not applied`);
    // resolvePlaces stamps EVERY place's source (D7); the legacy path leaves
    // LIVE results untagged. So under the flag ON there must be no untagged
    // place — a definitive marker that the resolver path ran, not the legacy one.
    if (liveUntagged.length > 0)
      failures.push(
        `${liveUntagged.length} place(s) with source=undefined — legacy path leaked (resolver stamps all)`,
      );

    if (failures.length > 0) {
      console.error(`\nFAIL (flag on):`);
      for (const f of failures) console.error("  - " + f);
      process.exit(1);
    }
    console.log(
      `\nPASS (flag on): wired route returned ${places.length} places, ` +
        `${verifiedFed} verified + ${unverifiedFed} unverified federated, ` +
        `tier-sorted (0 violations), every place source-stamped (resolver path confirmed).`,
    );
  } else {
    // OFF is the contrast: route still works; legacy leaves LIVE untagged.
    if (status !== 200 || places.length === 0) {
      console.error(`FAIL (flag off): status ${status}, places ${places.length}`);
      process.exit(1);
    }
    console.log(
      `\nOK (flag off): route still works. Contrast markers — live(untagged) ` +
        `${liveUntagged.length} (legacy leaves live source unset), ` +
        `tier violations ${violations} (legacy does not tier-sort).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
