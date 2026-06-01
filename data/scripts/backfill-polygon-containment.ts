/**
 * Phase 3b backfill — populate place_relationships for existing master_places.
 *
 * ── PURPOSE: this is a ONE-TIME DEPLOYMENT OPERATION, not a maintenance tool. ──
 * Step 7 of recompute_master_place (migration 20260601040000) computes
 * contained_in edges inline whenever a master_place is recomputed. So every
 * master_place created or recomputed AFTER that migration already gets its
 * edges for free. This script exists solely to cover the one failure mode that
 * inline computation cannot: master_places that were materialized BEFORE Step 7
 * existed (i.e. the production corpus at the moment this migration ships) and
 * therefore have never run the containment logic. Running recompute_master_place
 * over every existing master_place once, at deployment, populates their edges.
 * After that single run it should never need to run again — ongoing ingestion
 * keeps edges current inline. Treat it like a data migration that happens to
 * live in application code, not a recurring job.
 *
 * Iterates every master_place and calls recompute_master_place(), whose Step 7
 * computes the contained_in edges.
 *
 * IDEMPOTENT + RESTARTABLE. Step 7 does a stateless delete-then-reinsert of
 * each master_place's edges with ON CONFLICT DO NOTHING, so:
 *   - running twice converges to the same final state (no dup edges), and
 *   - an interrupted run resumes correctly on re-invocation — already-processed
 *     places keep their edges; the rest are processed next run. Re-running is
 *     safe and cheap to reason about (full re-iteration, not a partial resume).
 *
 * MODES
 *   --dry-run   Read-only. Writes nothing, calls no recompute. Reports the
 *               process set + structural stats (total master_places, parks with
 *               a polygon, non-park points, current edge count). The EXACT
 *               would-be edge count is produced by the real run: a faithful
 *               read-only preview would need a PostGIS spatial join that
 *               PostgREST can't express without a DB helper function, and
 *               re-implementing ST_Covers in app code would violate the
 *               PostGIS-only invariant. Needs no --confirm.
 *   (real run)  Iterates master_places calling recompute_master_place. Reports
 *               edges created (place_relationships count delta), places
 *               processed, runtime. Requires --confirm ONLY when the target is
 *               the PRODUCTION project — guards against accidental prod runs.
 *
 * ENV: loaded by the npm script via `tsx --env-file=.env` (PR #67 convention):
 *   npm run -w data backfill:polygon-containment -- --dry-run
 *   npm run -w data backfill:polygon-containment                (test target)
 *   npm run -w data backfill:polygon-containment -- --confirm   (prod target)
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

// Known project refs. Production requires --confirm; test does not.
const PROD_REF = "nqzeywzcowujzyegxbsr";
const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE_SIZE = 1000;
const PROGRESS_EVERY = 500;

function targetRef(): string {
  const m = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./);
  return m?.[1] ?? "unknown";
}

async function countRows(
  db: SupabaseClient,
  table: string,
  shape?: (q: any) => any,
): Promise<number> {
  let q = db.from(table).select("*", { count: "exact", head: true });
  if (shape) q = shape(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Page through every master_place id (stable order). */
async function fetchAllMasterPlaceIds(db: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("master_place")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) ids.push(row.id as string);
    if (data.length < PAGE_SIZE) break;
  }
  return ids;
}

async function dryRun(db: SupabaseClient): Promise<void> {
  const total = await countRows(db, "master_place");
  const parks = await countRows(db, "master_place", (q) =>
    q.not("geometry_polygon", "is", null),
  );
  const edges = await countRows(db, "place_relationships", (q) =>
    q.eq("relationship_type", "contained_in"),
  );
  logger.info(
    {
      target: targetRef(),
      master_places_total: total,
      parks_with_polygon: parks,
      non_park_points: total - parks,
      existing_contained_in_edges: edges,
    },
    "backfill DRY-RUN: would call recompute_master_place() on every master_place",
  );
  // eslint-disable-next-line no-console
  console.log(
    `\nDRY-RUN (no writes). Target=${targetRef()}\n` +
      `  master_places to process : ${total}\n` +
      `  ├─ parks (geometry_polygon): ${parks}\n` +
      `  └─ non-park points         : ${total - parks}\n` +
      `  existing contained_in edges: ${edges}\n` +
      `  → real run will recompute all ${total} and report the exact edge count.\n`,
  );
}

async function realRun(db: SupabaseClient): Promise<void> {
  const start = Date.now();
  const edgesBefore = await countRows(db, "place_relationships", (q) =>
    q.eq("relationship_type", "contained_in"),
  );
  const ids = await fetchAllMasterPlaceIds(db);
  logger.info(
    { target: targetRef(), master_places: ids.length, edges_before: edgesBefore },
    "backfill: starting recompute_master_place over all master_places",
  );

  let processed = 0;
  let errors = 0;
  for (const id of ids) {
    const { error } = await db.rpc("recompute_master_place", { p_master_place_id: id });
    if (error) {
      errors += 1;
      logger.error({ err: error, master_place_id: id }, "recompute_master_place failed");
    }
    processed += 1;
    if (processed % PROGRESS_EVERY === 0) {
      logger.info(
        { processed, total: ids.length, errors, elapsed_ms: Date.now() - start },
        "backfill progress",
      );
    }
  }

  const edgesAfter = await countRows(db, "place_relationships", (q) =>
    q.eq("relationship_type", "contained_in"),
  );
  const runtimeMs = Date.now() - start;
  logger.info(
    {
      target: targetRef(),
      processed,
      errors,
      edges_before: edgesBefore,
      edges_after: edgesAfter,
      edges_delta: edgesAfter - edgesBefore,
      runtime_ms: runtimeMs,
    },
    "backfill: complete",
  );
  // eslint-disable-next-line no-console
  console.log(
    `\nBACKFILL COMPLETE. Target=${targetRef()}\n` +
      `  master_places processed : ${processed}\n` +
      `  recompute errors        : ${errors}\n` +
      `  contained_in edges      : ${edgesBefore} → ${edgesAfter} (Δ ${edgesAfter - edgesBefore})\n` +
      `  runtime                 : ${(runtimeMs / 1000).toFixed(1)}s\n`,
  );
  if (errors > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("backfill-polygon-containment")
    .description("Backfill place_relationships by recomputing every master_place (Phase 3b).")
    .option("--dry-run", "Read-only preview; no recompute, no writes. Needs no --confirm.")
    .option("--confirm", "Required to run for real against the PRODUCTION project.")
    .parse(process.argv);

  const opts = program.opts<{ dryRun?: boolean; confirm?: boolean }>();
  const db = getDb();
  const ref = targetRef();

  if (opts.dryRun) {
    await dryRun(db);
    return;
  }

  // Real run. Guard production behind --confirm.
  if (ref === PROD_REF && !opts.confirm) {
    logger.error(
      { target: ref },
      "refusing to backfill PRODUCTION without --confirm. Re-run with --confirm, " +
        "or use --dry-run for a read-only preview.",
    );
    process.exitCode = 1;
    return;
  }
  if (ref !== PROD_REF && ref !== TEST_REF) {
    logger.warn({ target: ref }, "target is neither the known prod nor test ref; proceeding");
  }
  await realRun(db);
}

main().catch((err) => {
  logger.error({ err }, "backfill-polygon-containment: fatal");
  process.exit(1);
});
