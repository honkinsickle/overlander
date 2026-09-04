/**
 * verify-trip-browse-wired.ts — LIVE TEST proof that the wired day-scoped browse
 * feed returns correct results end-to-end through resolvePlaces().
 *
 * Post-cutover (2026-09-03): the TRIP_BROWSE_USE_RESOLVER flag and the legacy
 * dual path are gone — `produceBrowsePlaces` ALWAYS runs resolvePlaces()
 * day-corridor. `USE_FEDERATED_POIS` remains as the orthogonal DATA flag, so this
 * checks BOTH of its states:
 *   --federated-off : resolver live-only — every place source-stamped "live".
 *   --federated-on  : resolver live + federated merge, tier-sorted.
 *
 * Drives `produceBrowsePlaces` (the route's delegate). It loads the SAME trip/day
 * the route would (`getTrip`) and derives the geometry the SAME way.
 *
 * ⚠ WHY NOT the full GET(): the route's `createSupabaseServerClient()` calls
 * `cookies()`, which throws outside a Next request scope — so this substitutes a
 * plain anon client (the corridor RPC is anon-callable, SECURITY DEFINER) and
 * drives the delegate, covering the whole cutover except the thin GET wrapper.
 *
 * TEST project only — asserts the Supabase URL is TEST and refuses otherwise.
 *
 * Run (env cascade: .env.local for keys, .env.development.local wins for TEST):
 *   npx tsx --env-file=.env.local --env-file=.env.development.local scripts/verify-trip-browse-wired.ts --federated-off
 *   npx tsx --env-file=.env.local --env-file=.env.development.local scripts/verify-trip-browse-wired.ts --federated-on
 */
import { createClient } from "@supabase/supabase-js";
import { getTrip } from "@/lib/trips/repository";
import { produceBrowsePlaces } from "@/app/api/trip-browse/[tripId]/[dayId]/handler";
import type { SlideCategoryKey } from "@/lib/trip-browse/places";

const TEST_REF = "znldzjdatkogdktymtvi";
const TRIP = "la-to-deadhorse";
const CATEGORIES: SlideCategoryKey[] = ["scenic", "camping"];

async function main() {
  const useFederated = process.argv.includes("--federated-on");
  const mode = useFederated ? "federated-on" : "federated-off";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url.includes(TEST_REF)) {
    console.error(`REFUSING: Supabase URL is not TEST (${TEST_REF}). Got: ${url || "<unset>"}`);
    process.exit(1);
  }

  const trip = await getTrip(TRIP);
  if (!trip) {
    console.error(`Trip ${TRIP} not found on TEST`);
    process.exit(1);
  }
  const dayIndex = 0;
  const day = trip.days[dayIndex];
  const prev = trip.days[dayIndex - 1];
  const dayStart = prev?.coords ?? (dayIndex === 0 ? trip.startCoords : undefined);
  const points: [number, number][] = [];
  if (day.coords) points.push(day.coords);
  if (prev?.coords) points.push(prev.coords);
  else if (dayIndex === 0 && trip.startCoords) points.push(trip.startCoords);

  const supabase = useFederated ? createClient(url, anon) : null;

  const places = await produceBrowsePlaces({
    requested: CATEGORIES,
    dayStart,
    dayEnd: day.coords,
    points,
    useFederated,
    supabase,
  });

  const federated = places.filter((p) => p.source === "master_place");
  const liveTagged = places.filter((p) => p.source === "live");
  const untagged = places.filter((p) => p.source === undefined);
  const verifiedCount = places.filter((p) => p.verified === "verified").length;
  const unverifiedCount = places.filter((p) => p.verified === "unverified").length;
  let seenUnverified = false;
  let tierViolations = 0;
  for (const p of places) {
    if (p.verified === "unverified") seenUnverified = true;
    else if (p.verified === "verified" && seenUnverified) tierViolations += 1;
  }

  console.log(`\n=== ${mode} · ${TRIP}/${day.id} · categories=${CATEGORIES.join(",")} ===`);
  console.log(`places ${places.length} · federated(master_place) ${federated.length} · live(tagged) ${liveTagged.length} · untagged ${untagged.length}`);
  console.log(`tiers: verified ${verifiedCount} · unverified ${unverifiedCount} · ordering-violations ${tierViolations}`);

  const fail: string[] = [];
  if (places.length === 0) fail.push("no places returned");
  // resolvePlaces stamps every place (D7) on BOTH federated states — no untagged.
  if (untagged.length > 0) fail.push(`${untagged.length} untagged places — resolver stamps all (D7)`);
  if (tierViolations > 0) fail.push(`${tierViolations} tier-ordering violations — verified-first sort not applied`);
  if (mode === "federated-off") {
    if (federated.length > 0) fail.push(`${federated.length} federated rows with USE_FEDERATED_POIS off`);
  } else {
    if (federated.length === 0) fail.push("no federated rows — resolvePlaces federated merge did not run");
  }

  if (fail.length > 0) {
    console.error(`\nFAIL (${mode}):`);
    for (const f of fail) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    mode === "federated-off"
      ? `\nPASS (federated-off): resolver live-only — ${liveTagged.length} live (all source-stamped), 0 federated, 0 untagged.`
      : `\nPASS (federated-on): resolver merged ${federated.length} federated rows, every place source-stamped, tier-sorted (0 violations).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
