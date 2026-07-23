/**
 * STEP 3 verify — drives the REAL collapsed repo.addWaypoint / repo.removeWaypoint
 * under the seeded owner's JWT (the DI `client` seam), with the Mapbox leaf stubbed
 * via the `route` seam (offline + deterministic). Proves the two-write add path is
 * now ONE guarded write: waypoint + derived (miles/driveHours) land together in a
 * single version bump, a routing failure still persists the waypoint (derived
 * skipped, no error), and remove recomputes derived through the same single write.
 *   npx tsx --env-file=.env.development.local scripts/verify-trip-collapse.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { addWaypoint, removeWaypoint } from "../src/lib/trips/repository";
import { updateUserTripPayload } from "../src/lib/trips/user-trips";
import type { LngLat, Route } from "../src/lib/routing/route-between";
import type { Trip } from "../src/lib/trips/types";

const TEST_REF = "znldzjdatkogdktymtvi";
const OWNER = "seed-owner@overlander.test";
const PW = "seed-pw-manual-edit-8471";
const METERS_PER_MILE = 1609.34;

function assertTest(url: string) {
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "?";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: ${ref}`);
}
const ok = (name: string, pass: boolean, extra = "") =>
  console.log(`${pass ? "✔" : "✘"} ${name}${extra ? "  — " + extra : ""}`);

/** Deterministic Mapbox stub: derived miles == `miles`, driveHours == `hours`. */
const routeOf =
  (miles: number, hours: number) =>
  async (coords: LngLat[]): Promise<Route> => ({
    coordinates: coords,
    distanceM: miles * METERS_PER_MILE,
    durationS: hours * 3600,
    steps: [],
  });
const routeThrows = async (): Promise<Route> => {
  throw new Error("mapbox-down");
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  assertTest(url);
  const anonClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await anonClient.auth.signInWithPassword({ email: OWNER, password: PW });
  if (sErr || !sess.session) throw new Error(`signIn failed: ${sErr?.message}`);
  const client: SupabaseClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });

  const { data: row } = await client.from("trips").select("id").eq("owner_id", sess.user!.id).limit(1).single();
  const tripId = row!.id as string;
  const day1 = (t: Trip) => t.days.find((d) => d.id === "day-1")!;
  const read = async () => (await client.from("trips").select("payload,version").eq("id", tripId).single()).data!;
  const snapshot = async () => { const r = await read(); const d = day1(r.payload as Trip); return { v: r.version as number, ids: d.waypoints.map((w) => w.id), miles: d.miles, hours: d.driveHours }; };

  // Baseline reset (idempotent): drop collapse-* test waypoints, set a sentinel
  // miles=100 so a subsequent derived recompute is detectable.
  const reset = () => updateUserTripPayload(tripId, (t) => { const d = day1(t); d.waypoints = d.waypoints.filter((w) => !/^collapse-/.test(w.id)); d.label = "Day 1"; d.miles = 100; d.driveHours = 1; return t; }, { onConflict: "retry", client });
  await reset();

  let allPass = true;
  const check = (n: string, p: boolean, e = "") => { if (!p) allPass = false; ok(n, p, e); };

  // A — add persists waypoint + derived in ONE version bump; survives reload.
  const a0 = await snapshot();
  const addedA = await addWaypoint(tripId, "day-1", { id: "collapse-A", title: "A", coords: [-128.4, 55.4] } as never, { client, route: routeOf(200, 3) });
  const a1 = await snapshot(); // reload = fresh DB read
  check("A add persists waypoint + derived in ONE version bump, survives reload",
    addedA !== null && a1.ids.includes("collapse-A") && a1.miles === 200 && a1.hours === 3 && a1.v === a0.v + 1,
    `wp?${a1.ids.includes("collapse-A")} miles=${a1.miles} hrs=${a1.hours} v=${a1.v}(${a0.v}+1)`);

  // B — Mapbox failure: waypoint still persists, derived SKIPPED (miles unchanged
  // from A's 200), single bump, addWaypoint returns the waypoint (no error).
  const b0 = await snapshot();
  const addedB = await addWaypoint(tripId, "day-1", { id: "collapse-B", title: "B", coords: [-128.3, 55.3] } as never, { client, route: routeThrows });
  const b1 = await snapshot();
  check("B Mapbox failure — waypoint persists, derived skipped, no error, one bump",
    addedB !== null && b1.ids.includes("collapse-B") && b1.miles === b0.miles && b1.v === b0.v + 1,
    `wp?${b1.ids.includes("collapse-B")} miles=${b1.miles}(unchanged from ${b0.miles}) v=${b1.v}(${b0.v}+1)`);

  // C — remove works through the collapsed path AND recomputes derived in one bump.
  const c0 = await snapshot();
  const removedC = await removeWaypoint(tripId, "day-1", "collapse-A", { client, route: routeOf(150, 2.5) });
  const c1 = await snapshot();
  check("C remove works + recomputes derived in ONE bump",
    removedC === true && !c1.ids.includes("collapse-A") && c1.miles === 150 && c1.hours === 2.5 && c1.v === c0.v + 1,
    `gone?${!c1.ids.includes("collapse-A")} miles=${c1.miles} hrs=${c1.hours} v=${c1.v}(${c0.v}+1)`);

  // Restore baseline and report the DB literal.
  await reset();
  const base = await snapshot();
  console.log(`\nbaseline after restore: day-1 waypoints=[${base.ids.join(",")}] miles=${base.miles} driveHours=${base.hours} version=${base.v}`);
  console.log("NOTE: waypoint-index reorder (reorderWaypoints/reorderWaypointsAction) was DELETED in STEP 2 as dead code; the live reorder goes through placeRanks/node-actions, which does not touch this add/remove/recompute path — nothing to verify here.");

  console.log(allPass ? "\nALL PASS" : "\nFAILURES");
  if (!allPass) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
