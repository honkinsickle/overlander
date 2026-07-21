/**
 * GEOMETRY-ONLY per-day coord recovery for a persisted reference trip.
 *
 * WHY THIS AND NOT AN AUDIT RE-RUN: re-running the audit would re-resolve 14 of
 * this trip's 17 day endpoints through live Google (only Dawson / Stewart /
 * Vancouver are trip anchors). That is a silent CONTENT change — a place that
 * moved, closed, or now ranks differently would land at a new coord. This
 * script re-resolves NOTHING and re-routes NOTHING. It recovers each day's
 * start/end coord purely from data already persisted: the trip's own
 * `routePolyline` walked by the per-day published `miles` (net of round-trip /
 * dwell days, which make zero forward progress).
 *
 * PROVENANCE — READ BEFORE TRUSTING day.coords ON A RE-SEEDED TRIP:
 *   The coords this script writes are a POINT ON THE ROAD at cumulative mile X,
 *   NOT the overnight place's own coordinate. That is exactly what
 *   resolveCorridorCities wants (it slices the polyline between two miles), but
 *   it is DIFFERENT PROVENANCE from what to-trip.ts persists for NEW trips,
 *   where day.coords is the audit's *resolved place* coordinate. Same field,
 *   two meanings. Do not read a re-seeded day.coords as "where Whitehorse is."
 *   (Recorded also in docs/findings/2026-07-20-generated-day-coords-discarded.md.)
 *
 * Guards (all must pass before the write): TEST-ref-or-abort + forbidden-id
 * (the live PROD trip `dawson-vancouver-cassiar` is never writable). Mirrors
 * lib/itinerary/rails.ts. Reads back after writing and reports what landed.
 *
 * Run (dry by default — prints before/slop, writes nothing):
 *   npx tsx --env-file=.env.development.local scripts/reseed-day-coords.ts
 * Commit the write with --write:
 *   npx tsx --env-file=.env.development.local scripts/reseed-day-coords.ts --write
 */
import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import { getPersistedReferenceTrip } from "../src/lib/trips/reference";
import { decodePolyline, haversineMi } from "../src/lib/routing/point-to-polyline";
import { normPlaceName } from "../src/lib/corridor/anchor-match";
import type { Trip } from "../src/lib/trips/types";

const TRIP_ID = "dawson-cassiar-livingplan-test";
const TEST_REF = "znldzjdatkogdktymtvi"; // rails.ts TEST_REF
const FORBIDDEN_IDS = new Set(["dawson-vancouver-cassiar"]); // rails.ts FORBIDDEN_IDS

function assertRails() {
  if (FORBIDDEN_IDS.has(TRIP_ID)) throw new Error(`Refusing: "${TRIP_ID}" is a forbidden (live PROD) id.`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: Supabase ref is ${ref}, not TEST (${TEST_REF}).`);
}

/** Round-trip day = start city == end city (a dwell or an out-and-back). Zero
 *  NET forward progress, so it must not advance the cumulative walk. */
function isRoundTrip(label: string): boolean {
  const parts = label.split(" — ");
  if (parts.length < 2) return false;
  const a = normPlaceName(parts[0]);
  const b = normPlaceName(parts[parts.length - 1]);
  return a.length > 0 && a === b;
}

function main() {
  assertRails();
  const write = process.argv.includes("--write");

  return (async () => {
    const sb = createSupabaseServiceClient();
    const { data, error } = await sb
      .from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle();
    if (error || !data) throw new Error(`load failed: ${error?.message ?? "not found"}`);
    const trip = data.payload as Trip;

    const before = {
      cc: trip.days.filter((d) => d.corridorCities?.length).length,
      start: trip.days.filter((d) => d.startCoord).length,
      end: trip.days.filter((d) => d.coords).length,
    };

    if (!trip.routePolyline) throw new Error("no routePolyline — cannot recover geometry");
    const line = decodePolyline(trip.routePolyline);
    const cum: number[] = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineMi(line[i - 1], line[i]));
    const L = cum[cum.length - 1];

    // Cumulative NET forward mile at each day boundary (round-trip days add 0).
    const startNet: number[] = [];
    const endNet: number[] = [];
    let acc = 0;
    for (const d of trip.days) {
      startNet.push(acc);
      if (!isRoundTrip(d.label)) acc += d.miles ?? 0;
      endNet.push(acc);
    }
    const totalNet = acc;

    // Scale net miles onto the actual polyline length so BOTH endpoints pin
    // exactly (Dawson at mile 0, Vancouver at mile L) and interior boundaries
    // distribute proportionally — the systemic net-vs-polyline gap is spread,
    // not dumped on the last day. Report the gap so the correction is visible.
    const toCoord = (netMi: number): [number, number] => {
      const target = totalNet > 0 ? (netMi / totalNet) * L : 0;
      // first vertex at/after target mile, then interpolate to the exact mile
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; }
      if (lo === 0) return line[0];
      const a = line[lo - 1], b = line[lo];
      const span = cum[lo] - cum[lo - 1];
      const t = span > 0 ? (target - cum[lo - 1]) / span : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };

    const nextDays = trip.days.map((d, i) => ({
      ...d,
      startCoord: toCoord(startNet[i]),
      coords: toCoord(endNet[i]),
    }));

    // ── slop report against the coords we can actually check ──
    const dawson = trip.startCoords; // persisted, exact
    const vancouver = trip.days[trip.days.length - 1].coords; // persisted, exact
    const anchors = (trip as unknown as { generationInput?: { anchors?: { place: string; coords?: [number, number] }[] } })
      .generationInput?.anchors ?? [];
    const barkerville = anchors.find((a) => /barkerville/i.test(a.place))?.coords;

    console.log(`trip=${TRIP_ID}  polyline L=${L.toFixed(1)}mi  sum(net day miles)=${totalNet}mi  gap=${(L - totalNet).toFixed(1)}mi (${((L / totalNet - 1) * 100).toFixed(1)}%)`);
    console.log(`BEFORE: corridorCities ${before.cc}/${trip.days.length}, startCoord ${before.start}/${trip.days.length}, coords ${before.end}/${trip.days.length}`);
    console.log("boundary slop vs the 3 known anchor coords:");
    if (dawson) console.log(`  Dawson (day1 start): recovered vs persisted startCoords = ${haversineMi(nextDays[0].startCoord, dawson).toFixed(2)}mi`);
    if (vancouver) console.log(`  Vancouver (day17 end): recovered vs persisted day17.coords = ${haversineMi(nextDays[nextDays.length - 1].coords, vancouver).toFixed(2)}mi`);
    if (barkerville) {
      // Which day-window does Barkerville's scaled position fall in? (interior calibration — expect the Wells day)
      let bMile = 0, bIdx = 0, bBest = Infinity;
      for (let i = 0; i < line.length; i++) { const dd = haversineMi(line[i], barkerville); if (dd < bBest) { bBest = dd; bIdx = i; } }
      bMile = (cum[bIdx] / L) * totalNet; // back to net-mile space
      const dayOf = trip.days.findIndex((_, i) => bMile >= startNet[i] - 1 && bMile <= endNet[i] + 1);
      console.log(`  Barkerville (interior anchor): nearest route mile ≈ ${bMile.toFixed(0)} net-mi, offset ${bBest.toFixed(1)}mi → falls in day ${dayOf >= 0 ? trip.days[dayOf].dayNumber : "?"} (${dayOf >= 0 ? trip.days[dayOf].label : "n/a"})`);
    }

    if (!write) {
      console.log("\nDRY RUN — no write. Re-run with --write to persist.");
      return;
    }

    const { error: upErr } = await sb.from("reference_trips")
      .update({ payload: { ...trip, days: nextDays } }).eq("id", TRIP_ID);
    if (upErr) throw new Error(`write failed: ${upErr.message}`);

    // Read back RAW to confirm what landed.
    const { data: rb, error: rbErr } = await sb
      .from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle();
    if (rbErr || !rb) throw new Error(`read-back failed: ${rbErr?.message}`);
    const back = rb.payload as Trip;
    const after = {
      cc: back.days.filter((d) => d.corridorCities?.length).length,
      start: back.days.filter((d) => d.startCoord).length,
      end: back.days.filter((d) => d.coords).length,
    };
    console.log(`\nAFTER (raw read-back): corridorCities ${after.cc}/${back.days.length}, startCoord ${after.start}/${back.days.length}, coords ${after.end}/${back.days.length}`);

    // ── render report: run the real serve transform (federated POI fold →
    //    resolveCorridorCities) and show what the engine now derives ──
    const served = await getPersistedReferenceTrip(TRIP_ID);
    if (!served) throw new Error("serve transform returned null");
    console.log("\nRENDER (served trip — engine running):");
    let bucketedTotal = 0, alongTotal = 0;
    served.days.forEach((d) => {
      const cc = d.corridorCities ?? [];
      const nodes = cc.length;
      const bucketed = cc.reduce((s, c) => s + (c.placeIds?.length ?? 0), 0);
      const pool = (d.segmentSuggestions?.length ?? 0);
      bucketedTotal += bucketed;
      alongTotal += Math.max(0, pool - bucketed);
      const rt = isRoundTrip(d.label) ? " [round-trip]" : "";
      console.log(`  day ${String(d.dayNumber).padStart(2)}: ${nodes} nodes, ${bucketed}/${pool} POIs bucketed${rt}  ${d.label}`);
      if (nodes) console.log(`         nodes: ${cc.map((c) => `${c.name}@${Math.round(c.milesFromStart)}`).join("  ·  ")}`);
    });
    const withEngine = served.days.filter((d) => d.corridorCities?.length).length;
    console.log(`\nsummary: ${withEngine}/${served.days.length} days derive a spine; ${bucketedTotal} POIs under nodes, ${alongTotal} along-the-way.`);
  })();
}

main().catch?.((e: unknown) => { console.error(e); process.exit(1); });
