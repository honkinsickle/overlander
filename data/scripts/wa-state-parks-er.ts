/**
 * Two-phase entity resolution for `state_parks_web_wa` (WA).
 *
 * WA had no committed ER script at all — its 127 phase-1/triage links carry
 * `resolved_by = null`, the same signature CA's missing script left behind.
 * Written 2026-09-02 to close that gap; WA was slated as the next PROD
 * promotion after CA and would have hit the identical wall.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/wa-state-parks-er.ts --verify
 *   npx tsx --env-file=.env scripts/wa-state-parks-er.ts --dry-run
 */

import { runStateParksEr } from "./lib/state-parks-er.ts";
import { logger } from "../ingestion/lib/logger.ts";

runStateParksEr({
  sourceId: "state_parks_web_wa",
  gisPrefix: "state_parks:WA:%",
  resolvedBy: "auto:state_parks_web_wa_er",
  label: "wa-er",
}).catch((e: unknown) => {
  logger.error({ err: e }, "wa-er: fatal");
  process.exit(1);
});
