#!/usr/bin/env tsx
/**
 * CLI for ad-hoc ingestion runs.
 *
 * Usage:
 *   npm run -w data ingest:manual -- --source osm --bbox 34.0,-118.5,34.1,-118.4
 *   npm run -w data ingest:manual -- --source osm --dry-run
 *
 * --source       (required) which ingester to invoke
 * --bbox         (optional) manual bbox: "west,south,east,north" (skips corridor lookup)
 * --dry-run      (optional) validate + log without writing
 */

import { Command } from "commander";
import { logger } from "./lib/logger.ts";
import { parseBboxString } from "./lib/geometry.ts";
import type { IngestFn, IngestOptions } from "./sources/_types.ts";

const program = new Command();
program
  .name("ingest:manual")
  .description("Run one ingestion source ad-hoc")
  .requiredOption("--source <name>", "source to run: osm")
  .option("--bbox <w,s,e,n>", "manual bbox override")
  .option("--dry-run", "validate + log without writing", false)
  .parse(process.argv);

const opts = program.opts<{ source: string; bbox?: string; dryRun?: boolean }>();

async function loadSource(name: string): Promise<IngestFn> {
  switch (name) {
    case "osm": {
      const mod = await import("./sources/osm.ts");
      return mod.default;
    }
    // Other sources land here in week 2.
    default:
      throw new Error(`Unknown source: ${name}. Available: osm`);
  }
}

const ingestOpts: IngestOptions = {
  dryRun: opts.dryRun ?? false,
  ...(opts.bbox ? { bbox: parseBboxString(opts.bbox) } : {}),
};

loadSource(opts.source)
  .then((fn) => fn(ingestOpts))
  .then((result) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.errors > 0 ? 1 : 0);
  })
  .catch((err) => {
    logger.error({ err }, "ingest:manual: fatal");
    process.exit(1);
  });
