/**
 * Sanity check for viewport-vs-phase coverage. Loads the LA→Deadhorse
 * reference snapshot, generates default phases, and verifies:
 *
 *   1. LA viewport at z=12 → covered by phase 1 (Week 1: Days 1-7)
 *   2. Whitehorse viewport at z=12 → covered by phase 2 (Days 8-14;
 *      Day 11 = Whitehorse arrival)
 *   3. Mid-Pacific viewport at z=8 → uncovered (and no suggested phase)
 *   4. Empty trip (no offlinePhases) → status "no-phases"
 *   5. Zoom above phase.maxZoom (z=15 > 13) → uncovered, even at LA
 *   6. findCoveringPhase filters on prime status: an uncovered viewport
 *      with primed phases still reports "uncovered" rather than picking
 *      a primed-but-non-geographic phase
 *
 * Run via `npm run check:coverage`. Exits 0 on pass, 1 on first
 * failure with a one-line reason.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Trip } from "../src/lib/trips/types";
import { suggestDefaultPhases } from "../src/lib/offline/offline-phase-suggest";
import {
  __resetCoverageCacheForTests,
  findCoveringPhase,
  suggestPhaseForViewport,
  viewportCoveredBy,
} from "../src/lib/offline/coverage";
import type { PhaseStatus } from "../src/lib/offline/prime-status-db";

type Bbox = [number, number, number, number];

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Small bbox centered on (lng, lat). Half-widths in degrees roughly
 *  matching a typical viewport at z=12 (~0.05° per side at mid-lat). */
function bboxAround(lng: number, lat: number, halfDeg = 0.05): Bbox {
  return [lng - halfDeg, lat - halfDeg, lng + halfDeg, lat + halfDeg];
}

function statusRow(phaseId: string, status: PhaseStatus["status"]): PhaseStatus {
  return {
    tripId: "test",
    phaseId,
    status,
    tilesPrimed: status === "ready" ? 100 : 50,
    tilesTotal: 100,
    primedAt: status === "ready" ? new Date().toISOString() : null,
    primedPolylineHash: "test",
    tilesetVersion: "streetsv8",
    lastError: null,
  };
}

function main() {
  __resetCoverageCacheForTests();
  const snapshotPath = resolve(process.cwd(), ".alaska-snapshot.json");
  const trip = JSON.parse(readFileSync(snapshotPath, "utf8")) as Trip;
  const phases = suggestDefaultPhases(trip);
  const tripWithPhases: Trip = { ...trip, offlinePhases: phases };

  // ---------- 1. LA viewport covered by phase 1
  const phase1 = phases[0];
  const laBbox = bboxAround(-118.25, 34.05); // downtown LA
  if (!viewportCoveredBy(laBbox, 12, phase1, tripWithPhases)) {
    fail(`LA viewport at z=12 should be covered by phase 1`);
  }
  console.log(`  ✓ LA z=12 covered by ${phase1.label}`);

  // ---------- 2. Whitehorse viewport covered by phase 2
  // Day 11 (Watson Lake → Whitehorse) lands in Week 2 = Days 8-14.
  const phase2 = phases[1];
  const whitehorseBbox = bboxAround(-135.05, 60.72);
  if (!viewportCoveredBy(whitehorseBbox, 12, phase2, tripWithPhases)) {
    fail(`Whitehorse viewport at z=12 should be covered by phase 2`);
  }
  console.log(`  ✓ Whitehorse z=12 covered by ${phase2.label}`);

  // ---------- 3. Mid-Pacific uncovered
  const pacificBbox = bboxAround(-160.0, 30.0);
  for (const p of phases) {
    if (viewportCoveredBy(pacificBbox, 8, p, tripWithPhases)) {
      fail(`mid-Pacific should not be covered by ${p.label}`);
    }
  }
  const suggested = suggestPhaseForViewport(pacificBbox, 8, tripWithPhases);
  if (suggested !== null) {
    fail(`mid-Pacific should suggest no phase (got ${suggested.label})`);
  }
  console.log(`  ✓ mid-Pacific z=8 uncovered + no suggested phase`);

  // ---------- 4. Empty trip → no-phases
  const emptyTrip: Trip = { ...trip, offlinePhases: [] };
  const empty = findCoveringPhase(laBbox, 12, emptyTrip, new Map());
  if (empty.status !== "no-phases") {
    fail(`empty trip should return no-phases (got ${empty.status})`);
  }
  console.log(`  ✓ trip with no phases → status "no-phases"`);

  // ---------- 5. Zoom above maxZoom → uncovered
  // phase.maxZoom defaults to 13; z=15 is above. Viewport over LA at
  // z=15 should return false even though it'd be covered at z<=13.
  if (viewportCoveredBy(laBbox, 15, phase1, tripWithPhases)) {
    fail(`LA at z=15 (>maxZoom 13) should be uncovered`);
  }
  console.log(`  ✓ z=15 above phase.maxZoom=13 → uncovered`);

  // ---------- 6. findCoveringPhase respects prime status
  // Mark only phase 5 (Days 29-35) as ready; ask about LA viewport.
  // LA is in phase 1 territory but phase 1 isn't primed → uncovered.
  const statuses = new Map<string, PhaseStatus>([
    [phases[4].id, statusRow(phases[4].id, "ready")],
  ]);
  const filtered = findCoveringPhase(laBbox, 12, tripWithPhases, statuses);
  if (filtered.status !== "uncovered") {
    fail(
      `LA viewport with only phase 5 primed should be uncovered ` +
        `(got ${filtered.status}, phase ${filtered.phase?.label})`,
    );
  }
  console.log(`  ✓ findCoveringPhase respects prime status (not just geometry)`);

  // ---------- bonus: when phase 1 IS primed, LA returns covered
  const ready1 = new Map<string, PhaseStatus>([
    [phase1.id, statusRow(phase1.id, "ready")],
  ]);
  const hit = findCoveringPhase(laBbox, 12, tripWithPhases, ready1);
  if (hit.status !== "covered" || hit.phase?.id !== phase1.id) {
    fail(`LA viewport with phase 1 primed should be covered by phase 1`);
  }
  console.log(`  ✓ LA viewport with phase 1 primed → covered by phase 1`);

  console.log("PASS");
}

main();
