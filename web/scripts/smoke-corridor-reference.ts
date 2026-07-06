/**
 * One-off smoke test for the reference-trip corridor path
 * (src/lib/trips/resolve-corridor-cities.ts).
 *
 * Usage:
 *   npx tsx scripts/smoke-corridor-reference.ts
 *
 * Runs resolveCorridorCities over the committed la-to-deadhorse snapshot
 * (web/.alaska-snapshot.json) — no network, no Supabase, no seed write.
 * Prints a per-day summary (node count, max along-route gap), flags days
 * whose gap exceeds max_gap_mi = 150 (adaptive-fallback stress evidence:
 * where cities5000 had nothing to offer), and detail-prints a few days
 * including the emptiest far-north legs.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCorridorCities } from "../src/lib/trips/resolve-corridor-cities";
import type { Trip } from "../src/lib/trips/types";

const snapshotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../.alaska-snapshot.json",
);
const trip = JSON.parse(readFileSync(snapshotPath, "utf8")) as Trip;

const t0 = performance.now();
const resolved = resolveCorridorCities(trip);
const ms = ((performance.now() - t0) / 1000).toFixed(1);

let withCorridor = 0;
const gapDays: { n: number; label: string; maxGap: number; nodes: number }[] = [];
for (const day of resolved.days) {
  const cc = day.corridorCities;
  if (!cc) continue;
  withCorridor++;
  let maxGap = 0;
  for (let i = 1; i < cc.length; i++) {
    maxGap = Math.max(maxGap, cc[i].milesFromStart - cc[i - 1].milesFromStart);
  }
  if (maxGap > 150) {
    gapDays.push({ n: day.dayNumber, label: day.label, maxGap, nodes: cc.length });
  }
}
console.log(
  `Resolved ${withCorridor}/${resolved.days.length} days in ${ms}s; ${gapDays.length} day(s) still exceed max_gap_mi=150:`,
);
for (const g of gapDays) {
  console.log(
    `  Day ${g.n} (${g.label}): ${g.nodes} nodes, max gap ${g.maxGap.toFixed(0)} mi`,
  );
}

function printDay(n: number) {
  const day = resolved.days.find((d) => d.dayNumber === n);
  if (!day) return;
  console.log(`\nDay ${day.dayNumber} — ${day.label} (${day.miles ?? "?"} mi):`);
  if (!day.corridorCities) {
    console.log("  (no corridorCities)");
    return;
  }
  for (const c of day.corridorCities) {
    console.log(
      `  ${c.kind.padEnd(8)} ${c.milesFromStart.toFixed(1).padStart(7)} mi  ${c.name}`,
    );
  }
}

// Day 1 (LA metro), plus the emptiest far-north legs: BC/Yukon on the
// Alaska Highway and the Dalton Highway run to Deadhorse.
printDay(1);
for (const g of gapDays.slice(0, 4)) printDay(g.n);
printDay(resolved.days.length);
