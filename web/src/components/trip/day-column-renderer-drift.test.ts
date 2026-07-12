/**
 * Drift guard: BOTH trip-detail surfaces must mount the SAME day-column
 * renderer (`DayDetailCorridorColumn`) — the slideup and the full page.
 *
 * This is the invariant the 2026-07-12 renderer-unification established:
 * one renderer, both surfaces. The legacy full-page renderer (`DayDetail`)
 * and its `SuggestedSection` were deleted; if a future change reintroduces
 * a second day-column renderer on either surface, this test fails.
 *
 * Structural (source-scan) rather than a render test: the repo's test
 * harness is `node:test` via `tsx --test`, with no DOM/React-testing
 * layer. Run with:
 *   npx tsx --test src/components/trip/day-column-renderer-drift.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (rel: string) =>
  fileURLToPath(new URL(`../../${rel}`, import.meta.url));

const read = (rel: string) => readFileSync(src(rel), "utf8");

// The two mount points, one per surface.
const SLIDEUP = "components/trip/trip-slideup-body.tsx";
const FULL_PAGE = "components/trip/full-page-day-detail.tsx";

test("both surfaces mount DayDetailCorridorColumn", () => {
  for (const file of [SLIDEUP, FULL_PAGE]) {
    const body = read(file);
    assert.match(
      body,
      /<DayDetailCorridorColumn\b/,
      `${file} must mount <DayDetailCorridorColumn> (one renderer, both surfaces)`,
    );
  }
});

test("the full-page route renders the shared full-page column", () => {
  const page = read("app/trip/[id]/page.tsx");
  assert.match(
    page,
    /FullPageDayDetail/,
    "app/trip/[id]/page.tsx must render FullPageDayDetail (the shared corridor column), not a legacy renderer",
  );
});

test("legacy DayDetail / SuggestedSection renderers are gone", () => {
  assert.equal(
    existsSync(src("components/trip/day-detail.tsx")),
    false,
    "components/trip/day-detail.tsx (legacy DayDetail) must stay deleted",
  );
  assert.equal(
    existsSync(src("components/trip/suggested-section.tsx")),
    false,
    "components/trip/suggested-section.tsx must stay deleted",
  );
});

test("nothing imports the deleted SuggestedSection", () => {
  // Scan the two surfaces + their route entrypoints for a real import.
  const scan = [
    SLIDEUP,
    FULL_PAGE,
    "components/trip/full-page-day-rail.tsx",
    "app/trip/[id]/page.tsx",
    "app/trip/[id]/layout.tsx",
  ];
  for (const file of scan) {
    const body = read(file);
    assert.doesNotMatch(
      body,
      /import[^;]*\bSuggestedSection\b/,
      `${file} must not import SuggestedSection`,
    );
  }
});
