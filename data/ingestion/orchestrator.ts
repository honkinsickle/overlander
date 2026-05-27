/**
 * Orchestrator: scheduled-run entry point.
 *
 * GitHub Actions invokes individual source ingesters directly per their
 * cron schedules (one workflow per source — see spec section 11). This
 * file is reserved for a future "run all stale sources" mode, where the
 * orchestrator decides which sources to rerun based on their last
 * fetch_timestamp.
 *
 * Currently a stub.
 */

import { logger } from "./lib/logger.ts";

export async function run(): Promise<void> {
  logger.warn("orchestrator: not implemented yet — use ingest:manual or per-source CLI");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    logger.error({ err }, "orchestrator: fatal");
    process.exit(1);
  });
}
