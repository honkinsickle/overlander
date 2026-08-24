/**
 * verify-trip-browse-wired.ts — LIVE TEST proof that the wired day-scoped browse
 * cutover returns correct results end-to-end for the two combinations that
 * matter: (both off = today) and (both on = the new sorted-federated case).
 *
 * Drives `produceBrowsePlaces` (the route's delegate — the whole cutover: the
 * flag branch, the include.federated wiring, resolvePlaces day-corridor, live
 * discover, the federated pois_along_corridor RPC). It loads the SAME trip/day
 * the route would (`getTrip`) and derives the geometry the SAME way, then calls
 * the handler with real deps.
 *
 * ⚠ WHY NOT the full GET() in-process: the route's `createSupabaseServerClient()`
 * calls `cookies()`, which throws outside a Next request scope — so the
 * federated path can't run under `tsx`. This substitutes a plain anon client
 * (the corridor RPC is anon-callable, SECURITY DEFINER) and drives the delegate,
 * covering the entire cutover surface except the thin GET wrapper
 * (validate/cache/fixture/shape). Flagged in the PR.
 *
 * TEST project only — asserts the Supabase URL is TEST and refuses otherwise.
 *
 * Run (env cascade: .env.local for Google keys, .env.development.local wins for TEST Supabase):
 *   npx tsx --env-file=.env.local --env-file=.env.development.local scripts/verify-trip-browse-wired.ts --both-off
 *   npx tsx --env-file=.env.local --env-file=.env.development.local scripts/verify-trip-browse-wired.ts --both-on
 */
import { createClient } from "@supabase/supabase-js";
import { getTrip } from "@/lib/trips/repository";
import { produceBrowsePlaces } from "@/app/api/trip-browse/[tripId]/[dayId]/handler";
import type { SlideCategoryKey } from "@/lib/trip-browse/places";

const TEST_REF = "znldzjdatkogdktymtvi";
const TRIP = "la-to-deadhorse";
const CATEGORIES: SlideCategoryKey[] = ["scenic", "camping"];

async function main() {
  const mode = process.argv.includes("--both-on") ? "both-on" : "both-off";
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

  const useFederated = mode === "both-on";
  const useResolver = mode === "both-on";
  const supabase = useFederated ? createClient(url, anon) : null;

  const places = await produceBrowsePlaces({
    requested: CATEGORIES,
    dayStart,
    dayEnd: day.coords,
    points,
    useResolver,
    useFederated,
    supabase,
  });

  const federated = places.filter((p) => p.source === "master_place");
  const liveTagged = places.filter((p) => p.source === "live");
  const untagged = places.filter((p) => p.source === undefined);
  const verifiedCount = places.filter((p) => p.verified === "verified").length;
  const unverifiedCount = places.filter((p) => p.verified === "unverified").length;
  // tier-ordering violation: a verified appearing AFTER an unverified.
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
  if (mode === "both-off") {
    // Legacy live-only: untagged live, NO federated rows.
    if (federated.length > 0) fail.push(`${federated.length} federated rows leaked into legacy off`);
    if (liveTagged.length > 0) fail.push(`${liveTagged.length} live rows tagged (legacy off must leave live untagged)`);
    if (untagged.length === 0) fail.push("no untagged live rows (legacy off should leave live untagged)");
  } else {
    // both-on: federated merged, every place source-stamped, tier-ordered.
    if (federated.length === 0) fail.push("no federated rows — resolvePlaces federated merge did not run");
    if (untagged.length > 0) fail.push(`${untagged.length} untagged places — resolver stamps all (D7); legacy leaked`);
    if (tierViolations > 0) fail.push(`${tierViolations} tier-ordering violations — verified-first sort not applied`);
  }

  if (fail.length > 0) {
    console.error(`\nFAIL (${mode}):`);
    for (const f of fail) console.error("  - " + f);
    process.exit(1);
  }
  console.log(
    mode === "both-off"
      ? `\nPASS (both-off): legacy live-only — ${untagged.length} untagged live, 0 federated (matches today).`
      : `\nPASS (both-on): resolvePlaces merged ${federated.length} federated rows, every place source-stamped, tier-sorted (0 violations).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
