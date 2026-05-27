/**
 * Load the LA→Deadhorse route polyline into ingestion_corridor.
 *
 * Not yet implemented. Will read from web/src/lib/trips/alaska-route.ts
 * (shared source of truth for the reference trip's route geometry) and
 * insert a single LineString into ingestion_corridor with `active = true`,
 * `buffer_meters = 80000`.
 *
 * Stub for Phase 1 week 1.
 */

import { logger } from "../ingestion/lib/logger.ts";

async function main(): Promise<void> {
  logger.warn("deploy-corridor: not implemented yet");
  logger.info(
    "for smoke testing OSM end-to-end, use `ingest:manual --bbox` and skip corridor setup",
  );
}

main().catch((err) => {
  logger.error({ err }, "deploy-corridor: fatal");
  process.exit(1);
});
