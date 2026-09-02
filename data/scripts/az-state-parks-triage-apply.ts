/**
 * Manual-review triage for `arizona_state_parks`.
 *
 * Converted 2026-09-02 from the original `az-state-parks-triage-apply.mjs`,
 * the last non-uniform triage script of the six. The `.mjs` was safer than
 * UT's one-shot — it was dry-run-by-default and could not silently write — but
 * it sat outside `tsc --noEmit` (so no type checking at all) and hardcoded its
 * two decisions in the file, meaning it could only ever replay that one round.
 *
 * All six states now share one shape: dry-run by default, decisions supplied as
 * JSON, `--write` required to mutate. Logic lives in
 * `lib/state-parks-triage.ts`.
 *
 * The `.mjs`'s two TEST decisions are preserved verbatim as a historical record
 * at `data/triage-decisions/az-test-2026-09-02.json`. They are deliberately NOT
 * added to `RELINKS_BY_SOURCE` in the decisions builder: that map holds
 * PROD master_place UUIDs and prefix-asserts them, and AZ's are TEST UUIDs —
 * putting them there would either fail the assertion or, worse, aim a future
 * PROD relink at an id that does not exist. AZ's PROD queue came back empty, so
 * there were no PROD relinks to record.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/az-state-parks-triage-apply.ts
 *   npx tsx --env-file=.env scripts/az-state-parks-triage-apply.ts --apply decisions.json
 *   npx tsx --env-file=.env scripts/az-state-parks-triage-apply.ts --apply decisions.json --write
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { runStateParksTriage } from "./lib/state-parks-triage.ts";
import { logger } from "../ingestion/lib/logger.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

runStateParksTriage(
  sb,
  {
    sourceId: "arizona_state_parks",
    resolver: `adam:az-triage-${new Date().toISOString().slice(0, 10)}`,
    label: "az-triage",
  },
  (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
).catch((e: unknown) => {
  logger.error({ err: e }, "az-triage: fatal");
  process.exit(1);
});
