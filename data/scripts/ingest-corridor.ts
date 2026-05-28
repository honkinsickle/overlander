/**
 * Ingest a corridor segment end-to-end.
 *
 * Phase 3 spec §4 — runs the four sources against one named
 * `ingestion_corridor` row in the documented order (cheap first):
 *
 *   1. OSM (free)        — whole-segment envelope; OSM's ingester
 *                          tiles internally at 50km.
 *   2. RIDB (free)       — externally tiled into ~5–15 bboxes per
 *                          segment (RIDB's API model breaks at
 *                          1500-mile radii).
 *   3. NPS (free)        — parkCodes discovered for the segment's
 *                          US state set; bbox is irrelevant.
 *   4. Google Places ($) — two narrow modes only (per spec §2.3):
 *      a. Enrichment: for every existing source_record inside the
 *         corridor envelope in the configured categories, do a
 *         textSearch + Place Details lookup. Per-seed dedup via a
 *         persistent cache so re-runs cost zero.
 *      b. Discovery:  small-radius searchNearby at a hand-curated
 *         set of populated-area anchors (town centroids that the
 *         route passes through).
 *
 * Hard-stops on the Google cost-ledger budget cap (default $100, set
 * via GOOGLE_PLACES_BUDGET_USD). Status transitions: pending →
 * ingesting → complete; an aborted run leaves status='ingesting' so
 * the operator can investigate before the next attempt.
 *
 * ER + Typesense sync are deliberately NOT triggered here — that's
 * D3 of the corridor spec (`materialize --rematerialize` invoked
 * separately after this driver finishes and the operator has
 * eyeballed the result).
 *
 * Run:
 *   npm run -w data ingest-corridor -- --corridor segment_a_la_pnw
 */

import { Command } from "commander";

import { getCostLedger, BudgetExceededError } from "../ingestion/lib/cost-ledger.ts";
import { tileCorridorEnvelope } from "../ingestion/lib/corridor-tiles.ts";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

import osmIngest from "../ingestion/sources/osm.ts";
import ridbIngest from "../ingestion/sources/ridb.ts";
import npsIngest from "../ingestion/sources/nps.ts";
import {
  discoverAtAnchor,
  enrichSourceRecord,
  type DiscoverAnchor,
  type DiscoverResult,
  type EnrichResult,
} from "../ingestion/sources/google-places.ts";

import type { BoundingBox } from "../ingestion/lib/geometry.ts";
import type { IngestResult } from "../ingestion/sources/_types.ts";

// ──────────────────────────────────────────────────────────────────────
// Segment-specific config
// ──────────────────────────────────────────────────────────────────────

/**
 * US state codes per segment. Drives NPS parkCode discovery. Segment B
 * (Canada) and (future) parts of Segment C below the AK border don't
 * have NPS units — handled by the empty array.
 */
const SEGMENT_NPS_STATES: Record<string, readonly string[]> = {
  segment_a_la_pnw: ["CA", "OR", "WA"],
  segment_b_bc_ab: [],
  segment_c_yt_ak: ["AK"],
};

/**
 * Google discovery anchors per segment. Spec §2.3 — Google nearbySearch
 * concentrated on populated areas where its commercial data adds the
 * most value over the free sources. Coords are CC-BY-SA via OSM, rounded
 * to four places.
 *
 * Segment B/C lists left empty for now — populated when those PRs land.
 */
const SEGMENT_ANCHORS: Record<string, readonly DiscoverAnchor[]> = {
  segment_a_la_pnw: [
    { label: "Los Angeles, CA", centerLng: -118.2437, centerLat: 34.0522 },
    { label: "Bakersfield, CA", centerLng: -119.0187, centerLat: 35.3733 },
    { label: "Sacramento, CA", centerLng: -121.4944, centerLat: 38.5816 },
    { label: "Redding, CA", centerLng: -122.3917, centerLat: 40.5865 },
    { label: "Medford, OR", centerLng: -122.8756, centerLat: 42.3265 },
    { label: "Eugene, OR", centerLng: -123.0868, centerLat: 44.0521 },
    { label: "Portland, OR", centerLng: -122.6784, centerLat: 45.5152 },
    { label: "Olympia, WA", centerLng: -122.9007, centerLat: 47.0379 },
    { label: "Seattle, WA", centerLng: -122.3321, centerLat: 47.6062 },
    { label: "Bellingham, WA", centerLng: -122.4787, centerLat: 48.7519 },
  ],
  segment_b_bc_ab: [],
  segment_c_yt_ak: [],
};

/**
 * Categories to feed the Google enrichment pass. Adam's call
 * (2026-05-28) per spec §2.3 follow-up: campground / gas_station /
 * lodging carry the most Google-unique value for the overlander
 * use case. Restaurant + grocery deliberately excluded — useful but
 * not critical for V1, and they'd more than triple the candidate
 * count.
 *
 * Different sources tag the same concept differently, so this set
 * unions the variants we know about:
 *   - OSM:  campground (tourism=camp_site), gas_station (amenity=fuel)
 *   - RIDB: campground, lodging (FacilityTypeDescription snake_cased)
 *   - NPS:  campground (from /campgrounds endpoint)
 *   - Generic: lodging / hotel / motel for OSM's brand mapping
 */
const ENRICH_CATEGORIES = [
  "campground",
  "gas_station",
  "lodging",
] as const;

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

interface ActiveCorridorRow {
  id: string;
  name: string;
  bbox: BoundingBox;
}

async function lookupCorridor(name: string): Promise<ActiveCorridorRow> {
  const db = getDb();
  const { data, error } = await db
    .from("active_corridor_buffer")
    .select("id, name, bbox_west, bbox_south, bbox_east, bbox_north")
    .eq("name", name)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      `No active corridor named '${name}'. Run npm run -w data deploy-corridor first.`,
    );
  }
  return {
    id: data.id as string,
    name: data.name as string,
    bbox: [
      data.bbox_west as number,
      data.bbox_south as number,
      data.bbox_east as number,
      data.bbox_north as number,
    ],
  };
}

async function setStatus(
  corridorId: string,
  status: "pending" | "ingesting" | "complete",
): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("ingestion_corridor")
    .update({ status })
    .eq("id", corridorId);
  if (error) throw error;
}

async function fetchParkCodesByState(states: readonly string[]): Promise<string[]> {
  if (states.length === 0) return [];
  const apiKey = process.env.NPS_API_KEY;
  if (!apiKey) throw new Error("NPS_API_KEY not set — needed for parkCode discovery");

  const url = new URL("https://developer.nps.gov/api/v1/parks");
  url.searchParams.set("stateCode", states.join(","));
  url.searchParams.set("limit", "500");
  url.searchParams.set("fields", "parkCode");

  const res = await fetch(url, {
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
      "User-Agent": "overlander-data-ingestion/0.0.1",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NPS parks list ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ parkCode?: string }> };
  const codes = (json.data ?? [])
    .map((p) => p.parkCode)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  // Dedup (NPS sometimes lists a park under multiple states).
  return Array.from(new Set(codes));
}

interface EnrichmentCandidate {
  id: string;
  name: string;
  inferredCategory: string;
  lng: number;
  lat: number;
}

async function fetchEnrichmentCandidates(
  bbox: BoundingBox,
  categories: readonly string[],
): Promise<EnrichmentCandidate[]> {
  const db = getDb();
  // Pre-filter by bbox + category server-side; in-memory dedup happens
  // in the per-seed cache check below.
  const { data, error } = await db
    .from("source_record_view")
    .select("id, name, inferred_category, lng, lat")
    .in("inferred_category", [...categories])
    .gte("lng", bbox[0])
    .lte("lng", bbox[2])
    .gte("lat", bbox[1])
    .lte("lat", bbox[3])
    .order("id"); // deterministic order for re-runs
  if (error) throw error;

  return ((data ?? []) as Array<{
    id: string;
    name: string;
    inferred_category: string;
    lng: number;
    lat: number;
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    inferredCategory: row.inferred_category,
    lng: row.lng,
    lat: row.lat,
  }));
}

// ──────────────────────────────────────────────────────────────────────
// Stage runners
// ──────────────────────────────────────────────────────────────────────

interface RidbAggregate {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  tiles: number;
  duration_ms: number;
}

async function runRidbTiled(envelope: BoundingBox): Promise<RidbAggregate> {
  const startedAt = Date.now();
  const tiles = tileCorridorEnvelope(envelope);
  const totals = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  logger.info({ tileCount: tiles.length }, "ingest-corridor: RIDB tiling");

  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i]!;
    logger.info({ tileIdx: i + 1, of: tiles.length, tile }, "ingest-corridor: RIDB tile");
    const res = await ridbIngest({ bbox: tile });
    totals.fetched += res.fetched;
    totals.inserted += res.inserted;
    totals.updated += res.updated;
    totals.skipped += res.skipped;
    totals.errors += res.errors;
  }
  return {
    ...totals,
    tiles: tiles.length,
    duration_ms: Date.now() - startedAt,
  };
}

interface EnrichmentAggregate {
  candidates: number;
  cached_hit: number;
  cached_miss: number;
  enriched: number;
  miss: number;
  errors: number;
  duration_ms: number;
}

async function runEnrichment(
  candidates: EnrichmentCandidate[],
): Promise<EnrichmentAggregate> {
  const startedAt = Date.now();
  const agg: Omit<EnrichmentAggregate, "duration_ms"> = {
    candidates: candidates.length,
    cached_hit: 0,
    cached_miss: 0,
    enriched: 0,
    miss: 0,
    errors: 0,
  };
  logger.info({ candidates: candidates.length }, "ingest-corridor: enrichment pass starting");

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]!;
    try {
      const result: EnrichResult = await enrichSourceRecord({
        name: c.name,
        lng: c.lng,
        lat: c.lat,
      });
      switch (result.status) {
        case "cached_hit":
          agg.cached_hit += 1;
          break;
        case "cached_miss":
          agg.cached_miss += 1;
          break;
        case "enriched":
          agg.enriched += 1;
          break;
        case "miss":
          agg.miss += 1;
          break;
        case "dry_run":
          // Should not occur in this driver (we don't pass dryRun).
          break;
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      agg.errors += 1;
      logger.warn({ err, candidate: c }, "ingest-corridor: enrichment error (continuing)");
    }
    if ((i + 1) % 100 === 0) {
      const ledger = getCostLedger();
      logger.info(
        { processed: i + 1, of: candidates.length, ...agg, cost: ledger.summary() },
        "ingest-corridor: enrichment progress",
      );
    }
  }
  return { ...agg, duration_ms: Date.now() - startedAt };
}

interface DiscoveryAggregate {
  anchors: number;
  fetched: number;
  inserted: number;
  skipped: number;
  errors: number;
  duration_ms: number;
}

async function runDiscovery(anchors: readonly DiscoverAnchor[]): Promise<DiscoveryAggregate> {
  const startedAt = Date.now();
  const agg: Omit<DiscoveryAggregate, "duration_ms"> = {
    anchors: anchors.length,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
  };
  for (const anchor of anchors) {
    try {
      const r: DiscoverResult = await discoverAtAnchor(anchor);
      agg.fetched += r.fetched;
      agg.inserted += r.inserted;
      agg.skipped += r.skipped;
      agg.errors += r.errors;
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      agg.errors += 1;
      logger.warn({ err, anchor: anchor.label }, "ingest-corridor: discovery anchor error");
    }
  }
  return { ...agg, duration_ms: Date.now() - startedAt };
}

// ──────────────────────────────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────────────────────────────

interface FinalReport {
  corridor: string;
  envelope: BoundingBox;
  osm: IngestResult | { error: string };
  ridb: RidbAggregate | { error: string };
  nps: (IngestResult & { parkCodes: number }) | { error: string; parkCodes: number };
  google: {
    enrichment: EnrichmentAggregate;
    discovery: DiscoveryAggregate;
    cost: ReturnType<ReturnType<typeof getCostLedger>["summary"]>;
  };
  duration_ms: number;
  aborted_reason?: string;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("ingest-corridor")
    .description("Run OSM + RIDB + NPS + Google ingestion for one corridor segment.")
    .requiredOption("--corridor <name>", "Corridor name (e.g. segment_a_la_pnw)")
    .option("--skip-google", "Skip Google enrichment + discovery (free sources only)")
    .parse(process.argv);

  const opts = program.opts<{ corridor: string; skipGoogle?: boolean }>();
  const startedAt = Date.now();

  const corridor = await lookupCorridor(opts.corridor);
  logger.info({ corridor }, "ingest-corridor: starting");

  await setStatus(corridor.id, "ingesting");

  const report: Partial<FinalReport> = {
    corridor: corridor.name,
    envelope: corridor.bbox,
  };

  try {
    // 1. OSM
    logger.info("ingest-corridor: stage 1 — OSM");
    report.osm = await osmIngest({ bbox: corridor.bbox });

    // 2. RIDB
    logger.info("ingest-corridor: stage 2 — RIDB");
    report.ridb = await runRidbTiled(corridor.bbox);

    // 3. NPS
    logger.info("ingest-corridor: stage 3 — NPS");
    const states = SEGMENT_NPS_STATES[opts.corridor] ?? [];
    const parkCodes = await fetchParkCodesByState(states);
    logger.info({ states, parkCodeCount: parkCodes.length }, "ingest-corridor: NPS parkCodes discovered");
    if (parkCodes.length === 0) {
      report.nps = {
        source_id: "nps",
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        duration_ms: 0,
        parkCodes: 0,
      };
    } else {
      const npsResult = await npsIngest({ parkCodes });
      report.nps = { ...npsResult, parkCodes: parkCodes.length };
    }

    // 4. Google
    if (opts.skipGoogle) {
      logger.info("ingest-corridor: --skip-google — skipping enrichment + discovery");
      report.google = {
        enrichment: {
          candidates: 0,
          cached_hit: 0,
          cached_miss: 0,
          enriched: 0,
          miss: 0,
          errors: 0,
          duration_ms: 0,
        },
        discovery: {
          anchors: 0,
          fetched: 0,
          inserted: 0,
          skipped: 0,
          errors: 0,
          duration_ms: 0,
        },
        cost: getCostLedger().summary(),
      };
    } else {
      logger.info("ingest-corridor: stage 4a — Google enrichment");
      const candidates = await fetchEnrichmentCandidates(corridor.bbox, ENRICH_CATEGORIES);
      const enrichment = await runEnrichment(candidates);

      logger.info("ingest-corridor: stage 4b — Google discovery");
      const anchors = SEGMENT_ANCHORS[opts.corridor] ?? [];
      const discovery = await runDiscovery(anchors);

      report.google = {
        enrichment,
        discovery,
        cost: getCostLedger().summary(),
      };
    }

    await setStatus(corridor.id, "complete");
    report.duration_ms = Date.now() - startedAt;
    logger.info(report, "ingest-corridor: complete");
  } catch (err) {
    report.duration_ms = Date.now() - startedAt;
    if (err instanceof BudgetExceededError) {
      report.aborted_reason = err.message;
      report.google = report.google ?? {
        enrichment: {
          candidates: 0,
          cached_hit: 0,
          cached_miss: 0,
          enriched: 0,
          miss: 0,
          errors: 0,
          duration_ms: 0,
        },
        discovery: {
          anchors: 0,
          fetched: 0,
          inserted: 0,
          skipped: 0,
          errors: 0,
          duration_ms: 0,
        },
        cost: err.summary,
      };
      logger.error(report, "ingest-corridor: aborted — budget cap reached");
    } else {
      report.aborted_reason = err instanceof Error ? err.message : String(err);
      logger.error({ err, report }, "ingest-corridor: aborted");
    }
    // Leave status='ingesting' so the operator notices.
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, "ingest-corridor: fatal");
  process.exit(1);
});
