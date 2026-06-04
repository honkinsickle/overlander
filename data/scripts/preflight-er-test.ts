/**
 * Preflight for the destructive ER suites (`npm run -w data test:er`).
 *
 * The ER suites call reset_phase3a_test_state(), which DELETEs all
 * master_place + place_match and UNLINKs source_records on the targeted DB.
 * They are safe to run ONLY against a disposable test project that is distinct
 * from the working DB.
 *
 * This guard aborts (exit 1) if the resolved test ref equals the working ref
 * — i.e. if SUPABASE_TEST_URL === SUPABASE_URL. While both still resolve to the
 * same project, `test:er` is intentionally inert; it unblocks once a separate
 * disposable test DB exists and SUPABASE_TEST_URL points at it.
 *
 * Env is loaded by the npm script via `tsx --env-file=.env --env-file=.env.test`,
 * so we read the RAW values from the two files (no test-setup override is in
 * effect in this process):
 *   SUPABASE_URL       — the working DB (from .env)
 *   SUPABASE_TEST_URL  — the intended disposable test DB (from .env.test)
 */

function projectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] ?? url;
  } catch {
    return url;
  }
}

function fail(message: string): never {
  // Operator-facing fatal gate — a plain, unmissable stderr message is
  // intentional here (pino JSON would bury it).
  // eslint-disable-next-line no-console
  console.error(`\n[test:er preflight] ABORT — ${message}\n`);
  process.exit(1);
}

const workingUrl = process.env.SUPABASE_URL;
const testUrl = process.env.SUPABASE_TEST_URL;

if (!workingUrl || workingUrl.length === 0) {
  fail("SUPABASE_URL is not set (expected from data/.env). Cannot verify isolation.");
}
if (!testUrl || testUrl.length === 0) {
  fail("SUPABASE_TEST_URL is not set (expected from data/.env.test). Cannot verify isolation.");
}

const workingRef = projectRef(workingUrl);
const testRef = projectRef(testUrl);

if (workingRef === testRef) {
  fail(
    `the destructive ER test target equals the working DB.\n` +
      `  SUPABASE_URL      -> ${workingRef}\n` +
      `  SUPABASE_TEST_URL -> ${testRef}\n` +
      `Running the ER suites here would wipe the working corpus. ` +
      `Provision a SEPARATE disposable test project, point SUPABASE_TEST_URL ` +
      `at it (and seed test_marker ONLY there), then re-run.`,
  );
}

// eslint-disable-next-line no-console
console.log(
  `[test:er preflight] OK — test ref (${testRef}) is distinct from working ref (${workingRef}).`,
);
