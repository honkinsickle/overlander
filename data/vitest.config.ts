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
  },
});
