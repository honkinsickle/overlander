/**
 * Drift guard: every trip-detail SURFACE must mount the SAME slideup
 * (`TripSlideupBody`), which in turn mounts the ONE day-column renderer
 * (`DayDetailCorridorColumn`) — so a soft-nav slideup, the /trips modal,
 * and a shared/direct `/trip/[id]` URL all render identically.
 *
 * History: the legacy full-page renderer (`DayDetail` + `SuggestedSection`)
 * was deleted (2026-07-12), briefly replaced by a full-page-only corridor
 * column, then the direct-URL route was pointed at the canonical slideup
 * itself so a shared link renders exactly like a wizard-`router.push`
 * slideup. If a future change forks any surface onto a different renderer,
 * this test fails.
 *
 * Structural (source-scan) — the repo's harness is `node:test` via
 * `tsx --test`, with no DOM. Run with:
 *   npx tsx --test src/components/trip/day-column-renderer-drift.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) =>
  fileURLToPath(new URL(`../../${rel}`, import.meta.url));

const read = (rel: string) => readFileSync(src(rel), "utf8");

// Every route entrypoint that opens a trip detail surface.
const TRIP_SURFACES = [
  "app/trip/[id]/page.tsx", // direct / shared-URL visit
  "app/@modal/(.)trip/[id]/page.tsx", // soft-nav intercept slideup
  "app/trips/@modal/[id]/page.tsx", // /trips modal slideup
];

test("every trip surface mounts the shared slideup (TripSlideupBody)", () => {
  for (const file of TRIP_SURFACES) {
    const body = read(file);
    assert.match(
      body,
      /<TripSlideupBody\b/,
      `${file} must mount <TripSlideupBody> — one slideup surface across all trip routes`,
    );
  }
});

test("the slideup mounts the one day-column renderer", () => {
  const body = read("components/trip/trip-slideup-body.tsx");
  assert.match(
    body,
    /<DayDetailCorridorColumn\b/,
    "TripSlideupBody must mount <DayDetailCorridorColumn> (the single day-column renderer)",
  );
});

test("legacy DayDetail / SuggestedSection renderers are gone", () => {
  for (const rel of [
    "components/trip/day-detail.tsx",
    "components/trip/suggested-section.tsx",
    "components/trip/full-page-day-detail.tsx",
    "components/trip/full-page-day-rail.tsx",
  ]) {
    assert.equal(
      existsSync(src(rel)),
      false,
      `${rel} must stay deleted (superseded by the shared slideup)`,
    );
  }
});

test("nothing imports the deleted SuggestedSection", () => {
  for (const file of [...TRIP_SURFACES, "components/trip/trip-slideup-body.tsx"]) {
    assert.doesNotMatch(
      read(file),
      /import[^;]*\bSuggestedSection\b/,
      `${file} must not import SuggestedSection`,
    );
  }
});
