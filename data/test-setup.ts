/**
 * Vitest setup — route the data-workspace Supabase client at the
 * isolated test project (Phase 2.5 Part B Option 1).
 *
 * Loads env from data/.env and data/.env.test (latter wins on
 * conflict). If SUPABASE_TEST_* is present:
 *
 *   - Overrides SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY so every
 *     `getDb()` call in the test process points at the test project.
 *   - Sets ALLOW_DESTRUCTIVE_TEST_RESET=true, which the suite's own
 *     describe.skip check uses to gate destructive operations.
 *
 * If SUPABASE_TEST_* is missing (e.g. CI without a provisioned test
 * project, or a contributor who hasn't set up data/.env.test), the
 * setup leaves env alone and the suite-level guard skips all tests
 * with a clear warning.
 *
 * Belt-and-suspenders: even with this override in place, the
 * reset_phase3a_test_state() RPC itself refuses unless a row exists
 * in public.test_marker. The test project has that row (inserted by
 * scripts/seed-test-fixtures.ts); production does not. Bypassing one
 * layer is not enough to clobber real data.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // Missing file is fine — caller decides whether the suite runs.
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    // Don't overwrite values already in process.env (so .env.test wins
    // by being loaded SECOND with the override semantics below).
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// Load base .env first, then .env.test on top. We want test values to
// win, so we set them by hand after loading.
loadEnvFile(resolve(HERE, ".env"));

// Now load .env.test, OVERRIDING values from .env. We can't rely on
// `process.env[key] === undefined` for these because .env already set
// the prod values — that's the whole point of having a separate file.
function loadEnvFileOverride(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) continue;
    process.env[key] = value;
  }
}
loadEnvFileOverride(resolve(HERE, ".env.test"));

// Route the data-workspace Supabase client at the test project.
const testUrl = process.env.SUPABASE_TEST_URL;
const testKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

if (testUrl !== undefined && testKey !== undefined && testUrl.length > 0 && testKey.length > 0) {
  process.env.SUPABASE_URL = testUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = testKey;
  process.env.ALLOW_DESTRUCTIVE_TEST_RESET = "true";
  // eslint-disable-next-line no-console
  console.log(
    "[test-setup] routed Supabase client at SUPABASE_TEST_URL; destructive reset allowed.",
  );
} else {
  // eslint-disable-next-line no-console
  console.log(
    "[test-setup] SUPABASE_TEST_* not set; suite will skip via guard in phase3a.test.ts. " +
      "To run tests, populate data/.env.test (see Phase 2.5 spec Part B Option 1).",
  );
}
