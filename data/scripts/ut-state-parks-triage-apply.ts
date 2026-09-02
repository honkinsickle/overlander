/**
 * Manual-review triage for `utah_state_parks`.
 *
 * ⚠️ REWRITTEN 2026-09-02 onto the shared runner, after the previous version
 * caused an unintended PROD write. That version was UT's original one-shot from
 * its TEST round: it took NO arguments, had NO dry-run guard, and
 * blanket-confirmed every pending `place_match` the moment it was invoked.
 * During UT's PROD promotion it was called as
 * `--apply <decisions.json>` — the shared interface every other state uses —
 * and it silently ignored both flags and wrote immediately.
 *
 * The outcome happened to be correct (all 13 items were approved LINKs to their
 * proposed targets, which is exactly what blanket-confirm does, and an audit
 * confirmed 13/13 landed as proposed), but the safety property was absent: no
 * preview, and no way for the caller's intent to be wrong safely.
 *
 * Now identical in shape to ca/wa/or/nv: dry-run by default, decisions supplied
 * as JSON, `--write` required to mutate. Logic lives in
 * `lib/state-parks-triage.ts`.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/ut-state-parks-triage-apply.ts
 *   npx tsx --env-file=.env scripts/ut-state-parks-triage-apply.ts --apply decisions.json
 *   npx tsx --env-file=.env scripts/ut-state-parks-triage-apply.ts --apply decisions.json --write
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { runStateParksTriage } from "./lib/state-parks-triage.ts";
import { logger } from "../ingestion/lib/logger.ts";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

runStateParksTriage(
  sb,
  {
    sourceId: "utah_state_parks",
    resolver: `adam:ut-triage-${new Date().toISOString().slice(0, 10)}`,
    label: "ut-triage",
  },
  (path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
).catch((e: unknown) => {
  logger.error({ err: e }, "ut-triage: fatal");
  process.exit(1);
});
