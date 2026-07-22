/**
 * STEP 2 verify — drives the REAL updateUserTripPayload (not a query replica)
 * under the seeded owner's JWT (the DI `client` seam), forcing real version
 * conflicts by racing two writes off the same base version.
 *   npx tsx --env-file=.env.development.local scripts/verify-trip-version.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { updateUserTripPayload, TRIP_CONFLICT } from "../src/lib/trips/user-trips";
import type { Trip } from "../src/lib/trips/types";

const TEST_REF = "znldzjdatkogdktymtvi";
const OWNER = "seed-owner@overlander.test";
const PW = "seed-pw-manual-edit-8471";

function assertTest(url: string) {
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "?";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: ${ref}`);
}
const ok = (name: string, pass: boolean, extra = "") =>
  console.log(`${pass ? "✔" : "✘"} ${name}${extra ? "  — " + extra : ""}`);

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
  const version = async () => (await client.from("trips").select("version").eq("id", tripId).single()).data!.version as number;
  const day1 = (t: Trip) => t.days.find((d) => d.id === "day-1")!;

  // Baseline reset (idempotent): strip test waypoints, reset label/miles.
  await updateUserTripPayload(tripId, (t) => { const d = day1(t); d.waypoints = d.waypoints.filter((w) => !/^conflict-/.test(w.id)); d.label = "Day 1"; d.miles = 100; return t; }, { onConflict: "retry", client });
  let v0 = await version();
  let allPass = true;
  const check = (n: string, p: boolean, e = "") => { if (!p) allPass = false; ok(n, p, e); };

  // A — normal write bumps version.
  await updateUserTripPayload(tripId, (t) => { day1(t).label = "renamed-A"; return t; }, { onConflict: "refuse", client });
  check("A normal write bumps version", (await version()) === v0 + 1);

  // B — retry composes: two concurrent adds off the same base → both present, +2.
  v0 = await version();
  const addWp = (id: string) => updateUserTripPayload(tripId, (t) => { const d = day1(t); if (d.waypoints.some((w) => w.id === id)) return null; d.waypoints.push({ id, title: id, coords: [-128, 55] } as never); return t; }, { onConflict: "retry", client });
  await Promise.all([addWp("conflict-B1"), addWp("conflict-B2")]);
  const after = (await client.from("trips").select("payload,version").eq("id", tripId).single()).data!;
  const wpIds = day1(after.payload as Trip).waypoints.map((w) => w.id);
  check("B retry composes — both waypoints present, version +2",
    wpIds.includes("conflict-B1") && wpIds.includes("conflict-B2") && (after.version as number) === v0 + 2,
    `wp=[${wpIds.join(",")}] v=${after.version}(${v0}+2)`);

  // C — refuse: two concurrent renames → one Trip, one TRIP_CONFLICT, winner intact, +1.
  v0 = await version();
  const rename = (l: string) => updateUserTripPayload(tripId, (t) => { day1(t).label = l; return t; }, { onConflict: "refuse", client });
  const [c1, c2] = await Promise.all([rename("L-1"), rename("L-2")]);
  const conflicts = [c1, c2].filter((r) => r === TRIP_CONFLICT).length;
  const wins = [c1, c2].filter((r) => r !== TRIP_CONFLICT && r !== null).length;
  const finalLabel = day1((await client.from("trips").select("payload").eq("id", tripId).single()).data!.payload as Trip).label;
  check("C refuse — exactly one conflict + one winner, no retry, winner label intact, version +1",
    conflicts === 1 && wins === 1 && (finalLabel === "L-1" || finalLabel === "L-2") && (await version()) === v0 + 1,
    `conflicts=${conflicts} wins=${wins} label=${finalLabel}`);

  // D — abandon: two concurrent derived writes → both "succeed", only one write, winner survives.
  v0 = await version();
  const setMiles = (m: number) => updateUserTripPayload(tripId, (t) => { day1(t).miles = m; return t; }, { onConflict: "abandon", client });
  const [d1r, d2r] = await Promise.all([setMiles(111), setMiles(222)]);
  const finalMiles = day1((await client.from("trips").select("payload").eq("id", tripId).single()).data!.payload as Trip).miles;
  check("D abandon — both return success (Trip), exactly one write, winner miles survive",
    d1r !== null && d2r !== null && (finalMiles === 111 || finalMiles === 222) && (await version()) === v0 + 1,
    `miles=${finalMiles} v(+1)`);

  // E — retry exhaustion → null (client that always reports 0 rows on update, driving the REAL retry loop).
  const stub = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: tripId, title: "t", payload: (await client.from("trips").select("payload").eq("id", tripId).single()).data!.payload, version: 999999 }, error: null }) }) }), update: () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }) } as unknown as SupabaseClient;
  const exhausted = await updateUserTripPayload(tripId, (t) => t, { onConflict: "retry", client: stub });
  check("E retry exhaustion returns null", exhausted === null);

  console.log(allPass ? "\nALL PASS" : "\nFAILURES");
  if (!allPass) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
