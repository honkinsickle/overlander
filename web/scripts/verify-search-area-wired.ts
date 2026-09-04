/**
 * verify-search-area-wired.ts — LIVE proof that the WIRED /api/search-area
 * route returns correct results end-to-end through resolvePlaces().
 *
 * Post-cutover (2026-09-03): the SEARCH_AREA_USE_RESOLVER flag and the legacy
 * inline body are gone — the route ALWAYS calls resolvePlaces(). This script
 * drives the real GET handler, builds a real Request, and asserts the resolver
 * markers: every place is source-stamped (the legacy path used to leave live
 * untagged) and the federated block is tier-sorted (verified before unverified).
 *
 * Federated half hits Typesense (places_test) + Supabase (TEST); live half hits
 * Google/Mapbox if keys are present (absence is reported, not fatal).
 *
 * READ-ONLY. TEST project only — asserts the Supabase URL is TEST and refuses
 * otherwise.
 *
 * Run (env cascade: .env.local gives Typesense places_test + live keys,
 * .env.development.local overrides Supabase to TEST):
 *   npx tsx --env-file=.env.local --env-file=.env.development.local \
 *     scripts/verify-search-area-wired.ts
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
  // ── SAFETY: TEST project only ──────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes(PROD_REF) || !url.includes(TEST_REF)) {
    console.error(
      `REFUSING: Supabase URL is not TEST (${TEST_REF}). Got: ${url || "<unset>"}. ` +
        `Load .env.development.local AFTER .env.local so TEST wins.`,
    );
    process.exit(1);
  }

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
  const untagged = places.filter((p) => p.source === undefined);
  const verifiedFed = federated.filter((p) => p.verified === "verified").length;
  const unverifiedFed = federated.filter((p) => p.verified === "unverified").length;
  const violations = tierViolations(places);

  console.log(`\n=== /api/search-area (post-cutover, resolvePlaces) ===`);
  console.log(`status ${status} · x-cache ${res.headers.get("x-cache")}`);
  console.log(
    `places ${places.length} · counts ${JSON.stringify(payload.counts)} · ` +
      `failedSources ${JSON.stringify(payload.failedSources)}`,
  );
  console.log(
    `by source: master_place ${federated.length} · live ${live.length} · untagged ${untagged.length}`,
  );
  console.log(
    `federated tiers: verified ${verifiedFed} · unverified ${unverifiedFed} · ` +
      `tier-ordering violations ${violations}`,
  );

  const failures: string[] = [];
  if (status !== 200) failures.push(`status ${status} != 200`);
  if (places.length === 0) failures.push("no places returned");
  if (federated.length === 0)
    failures.push("no federated places — cannot test tiers (widen bbox/categories)");
  if (verifiedFed === 0)
    failures.push("zero verified federated places — the tier data did not flow through");
  if (violations !== 0)
    failures.push(`${violations} tier-ordering violation(s) — resolvePlaces sort not applied`);
  // resolvePlaces stamps EVERY place's source (D7) — no place may be untagged.
  if (untagged.length > 0)
    failures.push(`${untagged.length} place(s) with source=undefined — resolver stamps all`);

  if (failures.length > 0) {
    console.error(`\nFAIL:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    `\nPASS: wired route returned ${places.length} places, ${verifiedFed} verified + ` +
      `${unverifiedFed} unverified federated, tier-sorted (0 violations), every place ` +
      `source-stamped (resolver path confirmed).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
