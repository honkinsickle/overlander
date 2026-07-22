/**
 * Tests for the write rails. Run: npx tsx --test src/lib/itinerary/rails.test.ts
 *
 * Two guards, two kinds: checkNotFrozen is the PROPERTY guard (frozen trip,
 * phase-independent — applies to shipped user-trip paths too); checkRails adds
 * the PHASE guards (flag + TEST-ref) on top for the TEST-only living-plan actions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNotFrozen, checkRails } from "./rails";

const FROZEN = "dawson-vancouver-cassiar";
const TEST_URL = "https://znldzjdatkogdktymtvi.supabase.co";

// ── checkNotFrozen — the extracted PROPERTY guard (one list, one impl) ──

test("checkNotFrozen: the frozen PROD trip is refused with the exact message", () => {
  assert.deepEqual(checkNotFrozen(FROZEN), {
    ok: false,
    error: "This trip is live and cannot be re-planned.",
  });
});

test("checkNotFrozen: any other id passes (null) — no phase dependence", () => {
  assert.equal(checkNotFrozen("dawson-cassiar-livingplan-test"), null);
  assert.equal(checkNotFrozen("00000000-0000-0000-0000-000000000000"), null);
});

// ── checkRails — extraction must NOT change its three-condition behavior ──

function withEnv(flag: string | undefined, url: string, fn: () => void) {
  const sf = process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT;
  const su = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    if (flag === undefined) delete process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT;
    else process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT = flag;
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    fn();
  } finally {
    if (sf === undefined) delete process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT;
    else process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT = sf;
    if (su === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = su;
  }
}

test("checkRails: flag off → refuses (phase guard #1)", () => {
  withEnv(undefined, TEST_URL, () => {
    assert.deepEqual(checkRails("any-trip"), {
      ok: false,
      error: "Living-plan editing is not enabled.",
    });
  });
});

test("checkRails: flag on + frozen id → refuses (property guard, unchanged string)", () => {
  withEnv("1", TEST_URL, () => {
    assert.deepEqual(checkRails(FROZEN), {
      ok: false,
      error: "This trip is live and cannot be re-planned.",
    });
  });
});

test("checkRails: flag on + non-TEST Supabase ref → refuses (phase guard #2)", () => {
  withEnv("1", "https://nqzeywzcowujzyegxbsr.supabase.co", () => {
    const r = checkRails("ok-trip");
    assert.equal(r?.ok, false);
    assert.match(r!.error, /Supabase ref is nqzeywzcowujzyegxbsr, not TEST/);
  });
});

test("checkRails: flag on + TEST ref + allowed id → passes (null)", () => {
  withEnv("1", TEST_URL, () => {
    assert.equal(checkRails("dawson-cassiar-livingplan-test"), null);
  });
});
