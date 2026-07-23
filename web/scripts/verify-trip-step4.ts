/**
 * STEP 4 verify — ADR §1 dispatch of node-actions onto public.trips (UUID) under
 * RLS, driving the REAL server actions under the seeded JWT via the DI `client`
 * seam. Proves: corridor bake-at-write (edit visible in the served spine), the
 * closure-recompute concurrency rule (two edits to different places both survive
 * — the test that catches naive clobber-wiring), RLS ownership refusal, the
 * frozen-slug refusal, and the no-routePolyline graceful degrade.
 *   npx tsx --env-file=.env.development.local scripts/verify-trip-step4.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createNodeSeedAction,
  setPlaceRankAction,
} from "../src/lib/itinerary/node-actions";
import { updateUserTripPayload } from "../src/lib/trips/user-trips";
import { encodePolyline } from "../src/lib/routing/polyline";
import type { Trip } from "../src/lib/trips/types";

const TEST_REF = "znldzjdatkogdktymtvi";
const PW = "seed-pw-manual-edit-8471";
const OWNER = "seed-owner@overlander.test";
const OTHER = "seed-other@overlander.test";
const FROZEN = "dawson-vancouver-cassiar";

function assertTest(url: string) {
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "?";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: ${ref}`);
}
const ok = (name: string, pass: boolean, extra = "") =>
  console.log(`${pass ? "✔" : "✘"} ${name}${extra ? "  — " + extra : ""}`);

async function sessionClient(url: string, anon: string, email: string) {
  const a = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await a.auth.signInWithPassword({ email, password: PW });
  if (error || !data.session) throw new Error(`signIn ${email}: ${error?.message}`);
  return { client: createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } }), userId: data.user!.id };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  assertTest(url);
  // checkRails (slug path) checks this flag before checkNotFrozen — set it so the
  // frozen-slug test proves the PROPERTY guard, not the flag.
  process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT = "1";

  const owner = await sessionClient(url, anon, OWNER);
  const other = await sessionClient(url, anon, OTHER);
  const client = owner.client;
  const { data: row } = await client.from("trips").select("id").eq("owner_id", owner.userId).limit(1).single();
  const tripId = row!.id as string;
  const read = async () => (await client.from("trips").select("payload,version").eq("id", tripId).single()).data!;
  const day1 = (t: Trip) => t.days.find((d) => d.id === "day-1")!;

  let allPass = true;
  const check = (n: string, p: boolean, e = "") => { if (!p) allPass = false; ok(n, p, e); };

  // PREP: give day-1 a routePolyline + parseable "A — B" label so
  // resolveCorridorCities can slice + derive; clear overlays.
  const line: [number, number][] = [[-128, 55], [-128.5, 55.5], [-129, 56]];
  await updateUserTripPayload(tripId, (t) => {
    const d = day1(t);
    d.label = "Seed Start — Seed End";
    d.startCoord = [-128, 55]; d.coords = [-129, 56];
    t.routePolyline = encodePolyline(line);
    t.nodeSeeds = []; t.placeOverrides = []; t.placeRanks = {};
    delete d.corridorCities; delete t.seedResolutions;
    return t;
  }, { onConflict: "retry", client });

  // 1 — BAKE PROOF: createNodeSeed on the owner's UUID trip persists, bumps
  // version, and the SERVED spine (day-1.corridorCities) reflects the seed.
  const v0 = (await read()).version as number;
  const seedRes = await createNodeSeedAction(tripId, { name: "Test Node", coords: [-128.5, 55.5] }, { client });
  const after1 = await read();
  const cc = day1(after1.payload as Trip).corridorCities ?? [];
  const seedNode = cc.some((c) => c.name === "Test Node");
  check("1 bake-at-write: seed persists, version bumps, seed VISIBLE in served spine",
    seedRes.ok && (after1.version as number) === v0 + 1 && cc.length > 0 && seedNode,
    `ok=${seedRes.ok} v=${after1.version}(${v0}+1) corridorNodes=${cc.length} hasSeedNode=${seedNode}`);

  // 2 — CONCURRENCY: two rank edits to DIFFERENT places off the same version.
  // The second retries on a stale version; the closure re-reads fresh placeRanks
  // and merges — BOTH survive. (Naive clobber-wiring would drop one.)
  await updateUserTripPayload(tripId, (t) => { day1(t); t.placeRanks = {}; return t; }, { onConflict: "retry", client });
  const vC = (await read()).version as number;
  const [rA, rB] = await Promise.all([
    setPlaceRankAction(tripId, { "place-A": { nodeId: "n1", rank: 1 } }, { client }),
    setPlaceRankAction(tripId, { "place-B": { nodeId: "n1", rank: 2 } }, { client }),
  ]);
  const afterC = await read();
  const ranks = (afterC.payload as Trip).placeRanks ?? {};
  check("2 concurrency: two edits to different places BOTH present, version +2 (closure recompute, not clobber)",
    rA.ok && rB.ok && "place-A" in ranks && "place-B" in ranks && (afterC.version as number) === vC + 2,
    `keys=[${Object.keys(ranks).join(",")}] v=${afterC.version}(${vC}+2)`);

  // 3 — NON-OWNER: same action under the OTHER user's JWT. Guard passes (authed),
  // but RLS returns 0 rows → the write no-ops → refused; owner's payload intact.
  const beforeN = (await read()).payload as Trip;
  const nonOwner = await setPlaceRankAction(tripId, { "place-Z": { nodeId: "n1", rank: 9 } }, { client: other.client });
  const afterN = (await read()).payload as Trip;
  check("3 non-owner refused by RLS (0 rows), owner payload unchanged",
    !nonOwner.ok && !("place-Z" in (afterN.placeRanks ?? {})),
    `refused=${!nonOwner.ok} placeZLeaked=${"place-Z" in (afterN.placeRanks ?? {})}`);

  // 4 — FROZEN SLUG: dispatch sends it down the slug path → checkRails →
  // checkNotFrozen refuses (flag is ON, so this proves the PROPERTY guard).
  const frozen = await setPlaceRankAction(FROZEN, { "x": { nodeId: "n", rank: 1 } }, {});
  const frozenMsg = !frozen.ok ? frozen.error : "";
  check("4 frozen slug refused by checkNotFrozen (property guard)",
    !frozen.ok && /live and cannot be re-planned/.test(frozenMsg),
    `msg="${frozenMsg}"`);

  // 5 — NO-POLYLINE GRACEFUL: strip routePolyline, add another seed. The overlay
  // still persists; resolveCorridorCities returns unchanged, so corridorCities is
  // NOT baked worse — it stays as-is (existing spine preserved).
  await updateUserTripPayload(tripId, (t) => { delete t.routePolyline; return t; }, { onConflict: "retry", client });
  const ccBefore = JSON.stringify(day1((await read()).payload as Trip).corridorCities ?? []);
  const npRes = await createNodeSeedAction(tripId, { name: "NoPoly Node", coords: [-128.6, 55.6] }, { client });
  const afterNP = (await read()).payload as Trip;
  const ccAfter = JSON.stringify(day1(afterNP).corridorCities ?? []);
  const seedPersisted = (afterNP.nodeSeeds ?? []).some((s) => s.name === "NoPoly Node");
  check("5 no-polyline: overlay persists, corridor unchanged (graceful, not worse)",
    npRes.ok && seedPersisted && ccBefore === ccAfter,
    `ok=${npRes.ok} seedInNodeSeeds=${seedPersisted} corridorUnchanged=${ccBefore === ccAfter}`);

  // Restore baseline: minimal seed-trip shape.
  await updateUserTripPayload(tripId, (t) => {
    const d = day1(t);
    d.label = "Day 1"; d.miles = 100; d.driveHours = 2;
    d.coords = [-129, 56]; d.startCoord = [-128, 55];
    d.waypoints = d.waypoints.filter((w) => w.id === "seed-wp-1");
    delete d.corridorCities;
    delete t.routePolyline; delete t.seedResolutions;
    t.nodeSeeds = []; t.placeOverrides = []; t.placeRanks = {};
    return t;
  }, { onConflict: "retry", client });
  const base = await read();
  const bd = day1(base.payload as Trip);
  console.log(`\nbaseline after restore: day-1 label="${bd.label}" waypoints=[${bd.waypoints.map((w) => w.id).join(",")}] nodeSeeds=${(base.payload as Trip).nodeSeeds?.length ?? 0} placeRanks=${Object.keys((base.payload as Trip).placeRanks ?? {}).length} routePolyline=${(base.payload as Trip).routePolyline ? "set" : "none"} version=${base.version}`);

  console.log(allPass ? "\nALL PASS" : "\nFAILURES");
  if (!allPass) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
