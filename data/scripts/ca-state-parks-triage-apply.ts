/**
 * Manual-review triage for `state_parks_web`.
 *
 * Written 2026-09-02 to close a commit-completeness gap: this state's original
 * triage round was applied by hand, leaving `resolved_by` stamps that
 * correspond to no committed script. It does NOT re-apply those historical
 * decisions — TEST already reflects them, and the pending queue is empty. It
 * exists as the reusable tooling for future quarterly-refresh rounds.
 *
 * Logic lives in `lib/state-parks-triage.ts`, shared with the other states.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/ca-state-parks-triage-apply.ts
 *   npx tsx --env-file=.env scripts/ca-state-parks-triage-apply.ts --apply decisions.json
 *   npx tsx --env-file=.env scripts/ca-state-parks-triage-apply.ts --apply decisions.json --write
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { runStateParksTriage } from "./lib/state-parks-triage.ts";
import { logger } from "../ingestion/lib/logger.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

runStateParksTriage(
  sb,
  {
    sourceId: "state_parks_web",
    resolver: `adam:ca-triage-${new Date().toISOString().slice(0, 10)}`,
    label: "ca-triage",
  },
  (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
).catch((e: unknown) => {
  logger.error({ err: e }, "ca-triage: fatal");
  process.exit(1);
});
