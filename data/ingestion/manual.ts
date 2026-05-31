#!/usr/bin/env tsx
/**
 * CLI for ad-hoc ingestion runs.
 *
 * Usage:
 *   npm run -w data ingest:manual -- --source osm    --bbox 34.0,-118.5,34.1,-118.4
 *   npm run -w data ingest:manual -- --source ridb   --bbox 33.78,-116.20,34.05,-115.75
 *   npm run -w data ingest:manual -- --source nps    --park-codes jotr [--bbox W,S,E,N]
 *   npm run -w data ingest:manual -- --source google --bbox 33.78,-116.20,34.05,-115.75
 *   npm run -w data ingest:manual -- --source osm    --dry-run
 *
 * Flags:
 *   --source        (required) source name: osm | ridb | nps | google
 *   --bbox          manual bbox: "west,south,east,north" (skips corridor lookup)
 *   --park-codes    comma-separated NPS park codes (NPS only)
 *   --dry-run       validate + log without writing
 */

import { Command } from "commander";
import { logger } from "./lib/logger.ts";
import { parseBboxString } from "./lib/geometry.ts";
import type { IngestFn, IngestOptions } from "./sources/_types.ts";

const program = new Command();
program
  .name("ingest:manual")
  .description("Run one ingestion source ad-hoc")
  .requiredOption("--source <name>", "source to run: osm | ridb | nps")
  .option("--bbox <w,s,e,n>", "manual bbox override")
  .option("--park-codes <codes>", "comma-separated NPS park codes (NPS source only)")
  .option("--dry-run", "validate + log without writing", false)
  .parse(process.argv);

const opts = program.opts<{
  source: string;
  bbox?: string;
  parkCodes?: string;
  dryRun?: boolean;
}>();

async function loadSource(name: string): Promise<IngestFn> {
  switch (name) {
    case "osm": {
      const mod = await import("./sources/osm.ts");
      return mod.default;
    }
    case "ridb": {
      const mod = await import("./sources/ridb.ts");
      return mod.default;
    }
    case "nps": {
      const mod = await import("./sources/nps.ts");
      return mod.default;
    }
    case "google": {
      const mod = await import("./sources/google-places.ts");
      return mod.default;
    }
    case "parks_canada": {
      const mod = await import("./sources/parks-canada.ts");
      return mod.default;
    }
    default:
      throw new Error(
        `Unknown source: ${name}. Available: osm, ridb, nps, google, parks_canada`,
      );
  }
}

const ingestOpts: IngestOptions = {
  dryRun: opts.dryRun ?? false,
  ...(opts.bbox ? { bbox: parseBboxString(opts.bbox) } : {}),
  ...(opts.parkCodes
    ? { parkCodes: opts.parkCodes.split(",").map((s) => s.trim()).filter(Boolean) }
    : {}),
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
