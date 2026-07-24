/**
 * Tests for the write rails. Run: npx tsx --test src/lib/itinerary/rails.test.ts
 *
 * Two guards, two kinds: checkNotFrozen is the PROPERTY guard (frozen trip,
 * phase-independent — applies to shipped user-trip paths too). The phase-guarded
 * gate is SPLIT by surface into checkManualRails (NEXT_PUBLIC_LIVING_PLAN_EDIT)
 * and checkNlRails (NEXT_PUBLIC_NL_EDIT); both add the SAME phase guards (flag +
 * TEST-ref) and compose the SAME property guard — only the flag env var and the
 * disabled-error string differ.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNotFrozen, checkManualRails, checkNlRails } from "./rails";

const FROZEN = "dawson-vancouver-cassiar";
const TEST_URL = "https://znldzjdatkogdktymtvi.supabase.co";
const PROD_URL = "https://nqzeywzcowujzyegxbsr.supabase.co";
const MANUAL_FLAG = "NEXT_PUBLIC_LIVING_PLAN_EDIT";
const NL_FLAG = "NEXT_PUBLIC_NL_EDIT";

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

// ── Shared env harness. Sets BOTH surface flags + the Supabase ref, restores
//    all three afterward, so a manual-path test can't leak the NL flag or v.v. ──

function withEnv(
  opts: { manual?: string; nl?: string; url: string },
  fn: () => void,
) {
  const saved = {
    manual: process.env[MANUAL_FLAG],
    nl: process.env[NL_FLAG],
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  const setOrDelete = (key: string, val: string | undefined) => {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  };
  try {
    setOrDelete(MANUAL_FLAG, opts.manual);
    setOrDelete(NL_FLAG, opts.nl);
    process.env.NEXT_PUBLIC_SUPABASE_URL = opts.url;
    fn();
  } finally {
    setOrDelete(MANUAL_FLAG, saved.manual);
    setOrDelete(NL_FLAG, saved.nl);
    setOrDelete("NEXT_PUBLIC_SUPABASE_URL", saved.url);
  }
}

// A surface under test: its guard, its flag key, and its distinct disabled msg.
const SURFACES = [
  {
    name: "checkManualRails",
    guard: checkManualRails,
    flagKey: "manual" as const,
    disabledError: "Living-plan editing is not enabled.",
  },
  {
    name: "checkNlRails",
    guard: checkNlRails,
    flagKey: "nl" as const,
    disabledError: "Change-trip (NL) editing is not enabled.",
  },
];

for (const s of SURFACES) {
  // flag off refuses
  test(`${s.name}: flag off → refuses (phase guard #1)`, () => {
    withEnv({ url: TEST_URL }, () => {
      assert.deepEqual(s.guard("any-trip"), {
        ok: false,
        error: s.disabledError,
      });
    });
  });

  // FORBIDDEN_IDS refuses (flag on, TEST ref — so it's the property guard firing)
  test(`${s.name}: flag on + frozen id → refuses (property guard, unchanged string)`, () => {
    withEnv({ [s.flagKey]: "1", url: TEST_URL }, () => {
      assert.deepEqual(s.guard(FROZEN), {
        ok: false,
        error: "This trip is live and cannot be re-planned.",
      });
    });
  });

  // non-TEST ref refuses
  test(`${s.name}: flag on + non-TEST Supabase ref → refuses (phase guard #2)`, () => {
    withEnv({ [s.flagKey]: "1", url: PROD_URL }, () => {
      const r = s.guard("ok-trip");
      assert.equal(r?.ok, false);
      assert.match(r!.error, /Supabase ref is nqzeywzcowujzyegxbsr, not TEST/);
    });
  });

  // flag on + TEST ref + allowed id → passes
  test(`${s.name}: flag on + TEST ref + allowed id → passes (null)`, () => {
    withEnv({ [s.flagKey]: "1", url: TEST_URL }, () => {
      assert.equal(s.guard("dawson-cassiar-livingplan-test"), null);
    });
  });
}

// ── The split itself: each surface reads ONLY its own flag ──

test("split: manual flag on, NL flag off → manual passes, NL refuses", () => {
  withEnv({ manual: "1", url: TEST_URL }, () => {
    assert.equal(checkManualRails("dawson-cassiar-livingplan-test"), null);
    assert.deepEqual(checkNlRails("dawson-cassiar-livingplan-test"), {
      ok: false,
      error: "Change-trip (NL) editing is not enabled.",
    });
  });
});

test("split: NL flag on, manual flag off → NL passes, manual refuses", () => {
  withEnv({ nl: "1", url: TEST_URL }, () => {
    assert.equal(checkNlRails("dawson-cassiar-livingplan-test"), null);
    assert.deepEqual(checkManualRails("dawson-cassiar-livingplan-test"), {
      ok: false,
      error: "Living-plan editing is not enabled.",
    });
  });
});
