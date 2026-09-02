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
  .option("--iso <code>", "ISO 3166-2 area filter (OSM only, e.g. US-UT). Mutually exclusive with --bbox")
  .option(
    "--families <list>",
    "OSM only: restrict to comma-separated tag families (camping|tourism_misc|fuel|water_san|trailheads|shops|natural|leisure). Default omits 'shops' — pass --families with shops to opt in.",
  )
  .option("--park-codes <codes>", "comma-separated NPS park codes (NPS source only)")
  .option(
    "--site-types <list>",
    "USFS only: restrict INFRA layer to comma-separated site-type tokens (trailhead|campground|group_campground|camping_area|picnic_site|group_picnic_site). Default = all six.",
  )
  .option(
    "--state <code>",
    "State parks only: two-letter state code (CA|AZ|NV|UT|WA|OR) or ALL. Required for state_parks source.",
  )
  .option("--dry-run", "validate + log without writing", false)
  .parse(process.argv);

const opts = program.opts<{
  source: string;
  bbox?: string;
  iso?: string;
  families?: string;
  parkCodes?: string;
  siteTypes?: string;
  state?: string;
  dryRun?: boolean;
}>();

if (opts.bbox && opts.iso) {
  console.error("Error: --bbox and --iso are mutually exclusive");
  process.exit(2);
}

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
    case "bc_parks": {
      const mod = await import("./sources/bc-parks.ts");
      return mod.default;
    }
    case "alberta_parks": {
      const mod = await import("./sources/alberta-parks.ts");
      return mod.default;
    }
    case "padus": {
      const mod = await import("./sources/padus.ts");
      return mod.default;
    }
    case "usfs": {
      const mod = await import("./sources/usfs.ts");
      return mod.default;
    }
    case "blm": {
      const mod = await import("./sources/blm-rec.ts");
      return mod.default;
    }
    case "state_parks": {
      const mod = await import("./sources/state-parks.ts");
      return mod.default;
    }
    case "atlas_oddities": {
      const mod = await import("./sources/atlas-oddities.ts");
      return mod.default;
    }
    case "family_destinations": {
      const mod = await import("./sources/family-destinations.ts");
      return mod.default;
    }
    case "editorial_food": {
      const mod = await import("./sources/editorial-food.ts");
      return mod.default;
    }
    case "california_state_parks": {
      const mod = await import("./sources/state-parks-web.ts");
      return mod.default;
    }
    case "washington_state_parks": {
      const mod = await import("./sources/state-parks-web-wa.ts");
      return mod.default;
    }
    case "oregon_state_parks": {
      const mod = await import("./sources/oregon-state-parks.ts");
      return mod.default;
    }
    case "nevada_state_parks": {
      const mod = await import("./sources/nevada-state-parks.ts");
      return mod.default;
    }
    case "arizona_state_parks": {
      const mod = await import("./sources/arizona-state-parks.ts");
      return mod.default;
    }
    case "utah_state_parks": {
      const mod = await import("./sources/utah-state-parks.ts");
      return mod.default;
    }
    default:
      throw new Error(
        `Unknown source: ${name}. Available: osm, ridb, nps, google, parks_canada, bc_parks, alberta_parks, padus, usfs, blm, state_parks, atlas_oddities, family_destinations, editorial_food, california_state_parks, washington_state_parks, oregon_state_parks, nevada_state_parks, arizona_state_parks, utah_state_parks`,
      );
  }
}

const ingestOpts: IngestOptions = {
  dryRun: opts.dryRun ?? false,
  ...(opts.bbox ? { bbox: parseBboxString(opts.bbox) } : {}),
  ...(opts.iso ? { iso: opts.iso } : {}),
  ...(opts.families
    ? { families: opts.families.split(",").map((s) => s.trim()).filter(Boolean) }
    : {}),
  ...(opts.parkCodes
    ? { parkCodes: opts.parkCodes.split(",").map((s) => s.trim()).filter(Boolean) }
    : {}),
  ...(opts.siteTypes
    ? { siteTypes: opts.siteTypes.split(",").map((s) => s.trim()).filter(Boolean) }
    : {}),
  ...(opts.state ? { state: opts.state } : {}),
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
