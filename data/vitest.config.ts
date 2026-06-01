import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default 5s per-test timeout isn't enough for matchAll over
    // the full JT corpus (~219 source_records, ~1-2 minutes with the
    // current per-candidate same-source-guard lookups). The dedicated
    // batch-fetch perf pass after D4 will bring this back down. For now
    // we generously over-allocate.
    testTimeout: 60_000,
    hookTimeout: 300_000,
    include: ["**/*.test.ts"],
    // pino-pretty has a known memory accumulation issue when stdio is
    // piped (e.g., npm scripts). NODE_ENV=production disables the
    // pino-pretty transport entirely. The data/package.json `test` script
    // sets this in env — flagging here so the reader knows why.

    // Phase 2.5 Part B Option 1: route the suite at the isolated test
    // project via SUPABASE_TEST_* and set ALLOW_DESTRUCTIVE_TEST_RESET.
    // Setup runs once per worker before tests load.
    setupFiles: ["./test-setup.ts"],

    // Serialize test FILES. phase3a.test.ts and phase3b-containment.test.ts
    // both call reset_phase3a_test_state() (deletes all master_place) against
    // the SHARED test project. Run concurrently, one suite's reset would
    // clobber the other mid-run and drift the D4 baseline. The other test
    // files (matcher/profiler/progress-cache) mock the DB, so serializing is
    // cheap. Within-file order is already sequential.
    fileParallelism: false,
  },
});
