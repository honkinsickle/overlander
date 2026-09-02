/**
 * Two-phase entity resolution for `oregon_state_parks`.
 *
 * Rewritten 2026-09-02 onto the shared runner. The previous version took the
 * FIRST containing polygon, which is order-dependent and wrong where park
 * polygons overlap — the same bug found and fixed on CA. Its 107
 * `spatial_containment` links were produced by that logic; run `--verify` to
 * diff them against a correct re-derivation before trusting them.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/or-state-parks-er.ts --verify
 *   npx tsx --env-file=.env scripts/or-state-parks-er.ts --dry-run
 */

import { runStateParksEr } from "./lib/state-parks-er.ts";
import { logger } from "../ingestion/lib/logger.ts";

runStateParksEr({
  sourceId: "oregon_state_parks",
  gisPrefix: "state_parks:OR:%",
  // Unchanged from the original script so future runs stay consistent with the
  // 107 links already stamped this way.
  resolvedBy: "auto:oregon_state_parks_er",
  label: "or-er",
}).catch((e: unknown) => {
  logger.error({ err: e }, "or-er: fatal");
  process.exit(1);
});
