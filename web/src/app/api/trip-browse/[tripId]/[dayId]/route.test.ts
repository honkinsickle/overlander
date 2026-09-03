/**
 * trip-browse route — category VALIDATION guard.
 *
 * Why this file exists: `handler.test.ts` opens by saying the route "has no
 * tests of its own because it is a thin wrapper (validate + cache + fixture +
 * `{ source, places }` shape); the behaviour lives here." That assumption is
 * exactly what let a validation bug ship — tapping the `urban` or `interest`
 * chip returned `400 Invalid category`, because one constant answered both
 * "what does `categories=all` expand to" and "what is legal to request".
 *
 * Reproduced against the running route on 2026-09-03 before the fix (both the
 * `?categories=` and `?category=` forms returned 400 for urban and interest;
 * camping/scenic returned 404 "Trip not found", i.e. validation passed).
 *
 * These tests drive the PURE `resolveRequestedCategories`, so they need no DB,
 * no network and no env.
 *
 * ⚠️ RUN IT WITHOUT `--test`:
 *     cd web && npx tsx "src/app/api/trip-browse/[tripId]/[dayId]/route.test.ts"
 *
 * `npx tsx --test <path>` collects ZERO tests for any file under a
 * `[param]` directory — node:test treats `[tripId]` as a glob character class,
 * so the path never matches. Verified 2026-09-03: the invocation documented at
 * the top of the sibling `handler.test.ts` reports `tests 0 / pass 0` for the
 * same reason, i.e. those tests are not running when invoked as documented.
 * Executing the file directly registers and runs them normally.
 *
 * ⚠️ NOT RUN BY CI. `.github/workflows/ci.yml`'s `test` job runs
 * `npm run -w data test` only, and `web/package.json` has no `test` script —
 * so no web test file is executed in CI today. This guard is therefore
 * manual-only until that is wired up. Flagged as an open item rather than
 * fixed here: adding a web test job is outside this bug-fix pass and could
 * surface unrelated pre-existing failures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRequestedCategories } from "./route";
import {
  BROWSE_CARD_CATEGORIES,
  browseCategoryToSlide,
} from "@/lib/trip-browse/palette";

/** Every slide key the browse chip row can actually emit. Derived the same way
 *  the route derives its allowlist, but computed independently here from the
 *  chip row so the test would still catch the route hard-coding a short list. */
const CHIP_SLIDE_KEYS = Array.from(
  new Set(BROWSE_CARD_CATEGORIES.map(browseCategoryToSlide)),
);

// ── The regression: every chip must be requestable ──────────────────────

test("every chip the filter row renders is accepted via ?categories=", () => {
  for (const key of CHIP_SLIDE_KEYS) {
    const r = resolveRequestedCategories(key, null);
    assert.equal(r.ok, true, `?categories=${key} must not be rejected`);
    if (r.ok) assert.deepEqual(r.categories, [key]);
  }
});

test("every chip the filter row renders is accepted via ?category=", () => {
  for (const key of CHIP_SLIDE_KEYS) {
    const r = resolveRequestedCategories(null, key);
    assert.equal(r.ok, true, `?category=${key} must not be rejected`);
    if (r.ok) assert.deepEqual(r.categories, [key]);
  }
});

test("urban and interest specifically — the two that used to 400", () => {
  for (const key of ["urban", "interest"]) {
    assert.ok(
      CHIP_SLIDE_KEYS.includes(key as (typeof CHIP_SLIDE_KEYS)[number]),
      `${key} should still be a chip; if the row dropped it, this guard is moot`,
    );
    assert.equal(resolveRequestedCategories(key, null).ok, true);
    assert.equal(resolveRequestedCategories(null, key).ok, true);
  }
});

test("a multi-chip set mixing live-backed and corpus-only keys is accepted", () => {
  const r = resolveRequestedCategories("camping,urban,interest", null);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.categories, ["camping", "urban", "interest"]);
});

// ── The guard must still reject genuinely bad input ─────────────────────

test("an unknown category is still rejected", () => {
  const r = resolveRequestedCategories("notacategory", null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Invalid category "notacategory"/);
});

test("one bad key in an otherwise valid set rejects the whole request", () => {
  const r = resolveRequestedCategories("camping,notacategory", null);
  assert.equal(r.ok, false);
});

test("`hotel` is a DISPLAY category, not a slide key — still rejected", () => {
  // The client maps hotel -> overnight before sending. If `hotel` ever starts
  // being accepted, the client/server contract has drifted.
  assert.equal(resolveRequestedCategories("hotel", null).ok, false);
  assert.equal(resolveRequestedCategories(null, "overnight").ok, true);
});

test("missing both params is rejected", () => {
  const r = resolveRequestedCategories(null, null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Missing/);
});

// ── The deliberate asymmetry: `all` stays narrower than what's requestable ──

test("`all` expands to the live-fanout set, NOT every requestable chip", () => {
  const r = resolveRequestedCategories("all", null);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // urban/interest have empty live query sets, so they must stay OUT of the
  // default feed even though they are individually requestable. This is the
  // asymmetry the fix preserves on purpose — collapsing the two lists back
  // into one is what caused the bug.
  assert.ok(!r.categories.includes("urban"), "`all` must not fan out to urban");
  assert.ok(
    !r.categories.includes("interest"),
    "`all` must not fan out to interest",
  );
  assert.ok(r.categories.length < CHIP_SLIDE_KEYS.length, "`all` is narrower");
  for (const key of r.categories) {
    assert.ok(
      CHIP_SLIDE_KEYS.includes(key),
      `\`all\` expanded to ${key}, which no chip can request`,
    );
  }
});
