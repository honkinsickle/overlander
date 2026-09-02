/**
 * Two-phase entity resolution for `nevada_state_parks`.
 *
 * Rewritten 2026-09-02 onto the shared runner. Like OR's, the previous version
 * took the FIRST containing polygon — order-dependent and wrong where park
 * polygons overlap. NV was not named in the task that fixed OR, but it carried
 * the identical bug, and its 21 `spatial_containment` links came from it. Run
 * `--verify` to diff them against a correct re-derivation.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/nv-state-parks-er.ts --verify
 *   npx tsx --env-file=.env scripts/nv-state-parks-er.ts --dry-run
 */

import { runStateParksEr } from "./lib/state-parks-er.ts";
import { logger } from "../ingestion/lib/logger.ts";

runStateParksEr({
  sourceId: "nevada_state_parks",
  gisPrefix: "state_parks:NV:%",
  // Unchanged from the original script so future runs stay consistent with the
  // 21 links already stamped this way.
  resolvedBy: "auto:nevada_state_parks_er",
  label: "nv-er",
}).catch((e: unknown) => {
  logger.error({ err: e }, "nv-er: fatal");
  process.exit(1);
});
