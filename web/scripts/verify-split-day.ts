/**
 * Live verification of `splitDay` on a real TEST trip (not by reading). Drives the
 * REAL repository fn under a service client with REAL Mapbox routing. Constructs a
 * generated-shape row from the expedition-ms28y793 payload (48-tile generated
 * shape), runs the two scenarios, asserts the 6 invariants against the stored
 * payload, and DELETES the temp rows (snapshot = they didn't exist).
 *
 *   cd web && npx tsx --env-file=.env.development.local scripts/verify-split-day.ts
 */
import { createClient } from "@supabase/supabase-js";
import { splitDay } from "@/lib/trips/repository";
import { decodePolyline } from "@/lib/routing/point-to-polyline";
import type { Trip } from "@/lib/trips/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(url, key, { auth: { persistSession: false } });

let pass = 0,
  fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function read(id: string): Promise<Trip> {
  const { data, error } = await client
    .from("trips")
    .select("payload")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`read ${id}: ${error.message}`);
  if (!data) throw new Error(`read ${id}: row not found`);
  return (data as { payload: Trip }).payload;
}

async function main() {
  // owner + source payload
  const { data: u } = await client.from("users").select("id").limit(1).single();
  const ownerId = (u as { id: string }).id;
  const { data: ref } = await client
    .from("reference_trips")
    .select("payload")
    .eq("id", "expedition-ms28y793")
    .single();
  const sourcePayload = (ref as { payload: Trip }).payload;

  const ids: string[] = [];
  const makeRow = async (): Promise<string> => {
    const id = crypto.randomUUID();
    const payload = { ...structuredClone(sourcePayload), id };
    const { data, error } = await client
      .from("trips")
      .insert({ id, owner_id: ownerId, reference_id: null, title: "SPLIT VERIFY", state: "active", payload })
      .select("id");
    if (error) throw new Error(`insert: ${error.message}`);
    if (!data?.length) throw new Error(`insert: no row written for ${id}`);
    ids.push(id);
    return id;
  };

  try {
    // ── Scenario 1: normal split of day-6 at its geographic midpoint ──────────
    const t1 = await makeRow();
    const before = await read(t1);
    const d6 = before.days[5];
    const s = d6.startCoord!,
      e = d6.coords!;
    const M: [number, number] = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
    const nextDayBefore = before.days[6]; // the day AFTER day-6

    const r1 = await splitDay(t1, "day-6", { coords: M, name: "Mid Point" }, { client });
    check("splitDay returned ok", r1.ok, r1.ok ? "" : (r1 as { reason: string }).reason);
    if (!r1.ok) return;

    const after = await read(t1);
    const a = after.days.find((d) => d.id === r1.halfAId)!;
    const b = after.days.find((d) => d.id === r1.halfBId)!;

    // Invariant 1
    check(
      "1: both halves carry real miles/driveHours/corridorCities",
      (a.miles ?? 0) > 0 && (b.miles ?? 0) > 0 &&
        typeof a.driveHours === "number" && typeof b.driveHours === "number" &&
        (a.corridorCities?.length ?? 0) >= 2 && (b.corridorCities?.length ?? 0) >= 2,
      `A ${a.miles}mi/${a.driveHours}h/${a.corridorCities?.length}nodes · B ${b.miles}mi/${b.driveHours}h/${b.corridorCities?.length}nodes`,
    );

    // Invariant 2 — the day after the cut has byte-identical endpoints
    const nextAfter = after.days.find((d) => d.label === nextDayBefore.label)!;
    check(
      "2: day after the cut has byte-identical startCoord + coords",
      JSON.stringify(nextAfter.startCoord) === JSON.stringify(nextDayBefore.startCoord) &&
        JSON.stringify(nextAfter.coords) === JSON.stringify(nextDayBefore.coords),
      `id ${nextDayBefore.id}→${nextAfter.id}, date ${nextDayBefore.date}→${nextAfter.date}`,
    );

    // Invariant 3 — segmentSuggestions fully partitioned
    const orig = (d6.segmentSuggestions ?? []).map((t) => t.id);
    const aIds = (a.segmentSuggestions ?? []).map((t) => t.id);
    const bIds = (b.segmentSuggestions ?? []).map((t) => t.id);
    // Multiset equality (day-6 carries the documented Bryce duplicate id, so a
    // unique-set check is wrong): every original tile appears exactly once across
    // A∪B, and no tile lands in BOTH halves. Zero loss, zero new duplication.
    const multisetEqual =
      JSON.stringify([...orig].sort()) === JSON.stringify([...aIds, ...bIds].sort());
    const noCrossHalfDup = aIds.filter((id) => bIds.includes(id)).length === 0;
    check(
      "3: segmentSuggestions partitioned — multiset preserved, no tile in both halves",
      multisetEqual && noCrossHalfDup,
      `in ${orig.length} → A ${aIds.length} + B ${bIds.length}`,
    );

    // Invariant 4 — routePolyline rebuilt, non-null, decodes
    const decoded = after.routePolyline ? decodePolyline(after.routePolyline) : [];
    check(
      "4: routePolyline rebuilt non-null and decodes to a real line",
      !!after.routePolyline && decoded.length > 2,
      `${after.routePolyline?.length ?? 0} chars → ${decoded.length} pts`,
    );

    // Invariant 5 — day count grew by one, tail renumbered
    check(
      "5b: day inserted + tail renumbered (positional ids contiguous)",
      after.days.length === before.days.length + 1 &&
        after.days.every((d, i) => d.id === `day-${i + 1}` && d.dayNumber === i + 1),
      `${before.days.length} → ${after.days.length} days`,
    );

    // ── Scenario 2: unroutable split (M in the Pacific) ───────────────────────
    const t2 = await makeRow();
    // Mid-Pacific, ~1500mi offshore — no road within snapping distance, so Mapbox
    // returns NoRoute and the split takes the Haversine fallback.
    const r2 = await splitDay(t2, "day-3", { coords: [-140.0, 30.0], name: "Open Ocean" }, { client });
    check("scenario 2 splitDay returned ok (completed despite unroutable)", r2.ok);
    if (r2.ok) {
      const after2 = await read(t2);
      const fellBackHalf = after2.days.find((d) => d.id === r2.halfBId)!;
      check(
        "6: unroutable leg completed with Haversine fallback (driveHours null, miles>0)",
        (r2.fellBack.halfA || r2.fellBack.halfB) &&
          fellBackHalf.driveHours === null &&
          (fellBackHalf.miles ?? 0) > 0,
        `fellBack A=${r2.fellBack.halfA} B=${r2.fellBack.halfB}, B miles ${fellBackHalf.miles} hrs ${fellBackHalf.driveHours}`,
      );
    }
  } finally {
    for (const id of ids) await client.from("trips").delete().eq("id", id);
    console.log(`\ncleanup: deleted ${ids.length} temp row(s)`);
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("VERIFY ERROR:", e);
  process.exit(1);
});
