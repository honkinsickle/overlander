/**
 * Locks the TEST-vs-PROD environment classification used by the
 * "Continue as seed test user" dev-only sign-in bypass (see
 * `docs/decisions/2026-08-25-test-only-signin-bypass.md`).
 *
 * The helpers here are the STRUCTURAL gates that fail closed — if the
 * Supabase URL isn't the TEST project or the runtime isn't a dev build,
 * the bypass is unreachable. `Boolean(x)` semantics ensure undefined /
 * empty / wrong-project URLs return false, not throw.
 *
 * Run: cd web && npx tsx --test src/lib/supabase/env.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTestSupabaseUrl,
  isNonProductionRuntime,
  TEST_SUPABASE_PROJECT_REF,
  TEST_SUPABASE_URL,
} from "./env";

// ── URL classification ────────────────────────────────────────────────

test("isTestSupabaseUrl: recognises the canonical TEST project URL", () => {
  assert.equal(isTestSupabaseUrl(TEST_SUPABASE_URL), true);
  assert.equal(
    isTestSupabaseUrl(`https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`),
    true,
  );
});

test("isTestSupabaseUrl: recognises the TEST URL with a trailing slash", () => {
  assert.equal(isTestSupabaseUrl(`${TEST_SUPABASE_URL}/`), true);
});

test("isTestSupabaseUrl: rejects the PROD project URL", () => {
  // nqzeywzcowujzyegxbsr is PROD per CLAUDE.md — must never match.
  assert.equal(
    isTestSupabaseUrl("https://nqzeywzcowujzyegxbsr.supabase.co"),
    false,
  );
});

test("isTestSupabaseUrl: rejects undefined / null / empty string", () => {
  assert.equal(isTestSupabaseUrl(undefined), false);
  assert.equal(isTestSupabaseUrl(null), false);
  assert.equal(isTestSupabaseUrl(""), false);
});

test("isTestSupabaseUrl: rejects a random string that isn't a supabase URL", () => {
  assert.equal(isTestSupabaseUrl("not a url"), false);
  assert.equal(isTestSupabaseUrl("http://localhost:54321"), false);
});

test("isTestSupabaseUrl: rejects an http:// URL with the right ref (must be https)", () => {
  // Precludes an attacker-controlled proxy at the same ref via plaintext.
  assert.equal(
    isTestSupabaseUrl(`http://${TEST_SUPABASE_PROJECT_REF}.supabase.co`),
    false,
  );
});

test("isTestSupabaseUrl: rejects a URL that starts with the TEST ref but has extra chars (prefix-attack)", () => {
  assert.equal(
    isTestSupabaseUrl(
      `https://${TEST_SUPABASE_PROJECT_REF}-evil.supabase.co`,
    ),
    false,
  );
  assert.equal(
    isTestSupabaseUrl(
      `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co.evil.com`,
    ),
    false,
  );
});

test("isTestSupabaseUrl: rejects a URL with the TEST ref as a subdomain of a different host", () => {
  assert.equal(
    isTestSupabaseUrl(
      `https://evil.${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
    ),
    false,
  );
});

// ── Runtime classification ────────────────────────────────────────────

test("isNonProductionRuntime: true when NODE_ENV is 'development'", () => {
  assert.equal(isNonProductionRuntime("development"), true);
});

test("isNonProductionRuntime: true when NODE_ENV is 'test'", () => {
  assert.equal(isNonProductionRuntime("test"), true);
});

test("isNonProductionRuntime: false when NODE_ENV is exactly 'production'", () => {
  assert.equal(isNonProductionRuntime("production"), false);
});

test("isNonProductionRuntime: false when NODE_ENV is undefined (fail closed)", () => {
  // A missing NODE_ENV should NOT be treated as dev — the deployed build must
  // always report "production" (Next.js sets it), so absence is suspicious and
  // must fail toward safety.
  assert.equal(isNonProductionRuntime(undefined), false);
});

test("isNonProductionRuntime: false when NODE_ENV is an empty string (fail closed)", () => {
  assert.equal(isNonProductionRuntime(""), false);
});

test("isNonProductionRuntime: false for unexpected values (fail closed)", () => {
  assert.equal(isNonProductionRuntime("staging"), false);
  assert.equal(isNonProductionRuntime("prod"), false);
  assert.equal(isNonProductionRuntime("dev"), false); // must be "development"
});

// ── Constant integrity — do not drift ─────────────────────────────────

test("TEST_SUPABASE_PROJECT_REF is the exact CLAUDE.md-documented TEST project", () => {
  // The one canonical TEST project ref for OVERLANDER_01. If this changes,
  // half the codebase's TEST-only guards move — expedition.ts:TEST_PROJECT_REF
  // is the sibling constant. Regression-lock the value.
  assert.equal(TEST_SUPABASE_PROJECT_REF, "znldzjdatkogdktymtvi");
});

test("TEST_SUPABASE_URL is the https://<ref>.supabase.co form of the ref", () => {
  assert.equal(
    TEST_SUPABASE_URL,
    `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`,
  );
});
