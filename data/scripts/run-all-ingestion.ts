/**
 * Local-dev convenience: run every source ingester once, sequentially.
 *
 * Stub for Phase 1 week 1 — only OSM exists. Will grow as other sources land.
 */

import { logger } from "../ingestion/lib/logger.ts";
import { default as ingestOsm } from "../ingestion/sources/osm.ts";

async function main(): Promise<void> {
  logger.info("run-all-ingestion: starting");
  const results = [];
  results.push(await ingestOsm({ dryRun: false }));
  // Week 2: ridb, nps, google, ioverlander.
  logger.info({ results }, "run-all-ingestion: done");
}

main().catch((err) => {
  logger.error({ err }, "run-all-ingestion: fatal");
  process.exit(1);
});
