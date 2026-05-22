/**
 * Sanity check for the prime-status IndexedDB wrapper. Round-trips
 * put/get/list/delete against fake-indexeddb so it runs headlessly,
 * then cross-checks that the tile count enumerateTiles would produce
 * for LA→Deadhorse phase 1 lines up with the value session 2 reports
 * (sanity that the prime loop and the geometry math agree).
 *
 * Exits 0 on pass, 1 on first failure. Run via:
 *   npm run check:prime-status-db
 *
 * The IDB checks here cover the wrapper's *shape* (key uniqueness,
 * filter-by-trip, delete) but cannot exercise:
 *  - real browser IndexedDB behavior (Safari has historic quirks)
 *  - persistence across reload (no DOM here)
 *  - concurrent-tab `blocked` paths
 * Those need manual verification on Vercel preview.
 */
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Trip } from "../src/lib/trips/types";
import { suggestDefaultPhases } from "../src/lib/offline/offline-phase-suggest";
import {
  computePhaseGeometry,
  enumerateTiles,
} from "../src/lib/offline/offline-phase-geometry";
import {
  __resetDbHandleForTests,
  deletePhaseStatus,
  getPhaseStatus,
  listPhaseStatusesForTrip,
  phaseCacheName,
  putPhaseStatus,
  type PhaseStatus,
} from "../src/lib/offline/prime-status-db";

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function rec(tripId: string, phaseId: string, over: Partial<PhaseStatus> = {}): PhaseStatus {
  return {
    tripId,
    phaseId,
    status: "not-primed",
    tilesPrimed: 0,
    tilesTotal: 0,
    primedAt: null,
    primedPolylineHash: null,
    tilesetVersion: "streetsv8",
    lastError: null,
    ...over,
  };
}

async function main() {
  __resetDbHandleForTests();

  // 1. Empty DB returns null
  const empty = await getPhaseStatus("trip-a", "phase-w1");
  if (empty !== null) fail(`expected null on empty get, got ${JSON.stringify(empty)}`);
  console.log("  ✓ empty get returns null");

  // 2. Put + get round-trips all fields
  const a1 = rec("trip-a", "phase-w1", {
    status: "ready",
    tilesPrimed: 26000,
    tilesTotal: 26000,
    primedAt: "2026-05-22T20:00:00.000Z",
    primedPolylineHash: "deadbeef",
  });
  await putPhaseStatus(a1);
  const got = await getPhaseStatus("trip-a", "phase-w1");
  if (!got) fail("expected record back after put");
  for (const k of Object.keys(a1) as (keyof PhaseStatus)[]) {
    if (got[k] !== a1[k]) fail(`field ${k} round-trip mismatch: ${got[k]} != ${a1[k]}`);
  }
  console.log("  ✓ put + get round-trips all fields");

  // 3. Update in place (same composite key) overwrites prior record
  const a1Updated = rec("trip-a", "phase-w1", {
    status: "partial",
    tilesPrimed: 13000,
    tilesTotal: 26000,
  });
  await putPhaseStatus(a1Updated);
  const got2 = await getPhaseStatus("trip-a", "phase-w1");
  if (got2?.status !== "partial" || got2.tilesPrimed !== 13000) {
    fail(`update in place failed: ${JSON.stringify(got2)}`);
  }
  console.log("  ✓ put overwrites on existing composite key");

  // 4. Composite key isolates rows across tripId and phaseId
  await putPhaseStatus(rec("trip-a", "phase-w2"));
  await putPhaseStatus(rec("trip-b", "phase-w1"));
  const aRows = await listPhaseStatusesForTrip("trip-a");
  const bRows = await listPhaseStatusesForTrip("trip-b");
  if (aRows.length !== 2) fail(`expected 2 rows for trip-a, got ${aRows.length}`);
  if (bRows.length !== 1) fail(`expected 1 row for trip-b, got ${bRows.length}`);
  if (bRows[0].phaseId !== "phase-w1") fail(`trip-b row has wrong phaseId`);
  console.log("  ✓ composite key isolates tripId/phaseId");

  // 5. Delete removes only the targeted row
  await deletePhaseStatus("trip-a", "phase-w1");
  const afterDelete = await getPhaseStatus("trip-a", "phase-w1");
  if (afterDelete !== null) fail("delete didn't remove row");
  const aRowsAfter = await listPhaseStatusesForTrip("trip-a");
  if (aRowsAfter.length !== 1 || aRowsAfter[0].phaseId !== "phase-w2") {
    fail(`delete affected wrong rows: ${JSON.stringify(aRowsAfter)}`);
  }
  console.log("  ✓ delete removes only the targeted composite key");

  // 6. Cache-bucket name shape matches SW expectation
  const cacheName = phaseCacheName("phase-w1", "streetsv8");
  if (cacheName !== "mb-phase-phase-w1-streetsv8") {
    fail(`unexpected cache name: ${cacheName}`);
  }
  console.log(`  ✓ phaseCacheName("phase-w1", "streetsv8") = ${cacheName}`);

  // 7. Cross-check that the prime loop's tile-count input source matches
  //    the geometry math from session 2. This is the bridge: the prime
  //    loop reads `enumerateTiles(...)` to know how many tiles to fetch.
  //    Any future change in the geometry signature would silently break
  //    the priming flow unless this script trips.
  const snapshotPath = resolve(process.cwd(), ".alaska-snapshot.json");
  const trip = JSON.parse(readFileSync(snapshotPath, "utf8")) as Trip;
  const phases = suggestDefaultPhases(trip);
  const { coords } = computePhaseGeometry(phases[0], trip);
  const tiles = enumerateTiles(coords, phases[0].bufferMi, 6, phases[0].maxZoom);
  if (tiles.length < 5_000 || tiles.length > 35_000) {
    fail(`phase 1 tile count ${tiles.length} outside sanity range`);
  }
  console.log(
    `  ✓ phase 1 prime would queue ${tiles.length.toLocaleString()} tile fetches`,
  );

  console.log("PASS");
}

main().catch((err) => {
  console.error("FAIL: uncaught", err);
  process.exit(1);
});
