/**
 * Backfill normalized_payload.amenities on nps source_records using the new
 * coerceCampgroundAmenities normalizer (data/ingestion/sources/nps.ts),
 * which now maps NPS's raw 14-key campground amenities shape to the same
 * canonical shape normalizeOsm() produces (previously it passed the raw
 * shape through untouched — see "NPS amenities gap" scoping report). Also
 * recomputes every master_place whose amenities changed as a result, since
 * field_precedence/resolve_field() changes don't retroactively update
 * master_place — same two-step shape as the OSM amenities fix
 * (20260818140000_osm_amenities_field_precedence.sql +
 * recompute-osm-amenities-candidates.ts).
 *
 * ZERO new API traffic — re-derives amenities from each row's OWN
 * raw_payload.campground.amenities (already stored at ingest time), mirrors
 * backfill-nps-photo.ts exactly (same Phase 1 read-then-Phase 2 write split,
 * for the same reason: an UPDATE mid-scan can relocate a heap tuple and
 * perturb an un-ordered `.range()` page window — `.order("id")` + deferred
 * writes avoids it).
 *
 * NOT a supabase/migrations/ change: this is a data backfill against
 * already-ingested rows, not DDL or a field_precedence seed — no schema or
 * precedence table is touched, so db:push-verify does not apply. Matches
 * the existing backfill-nps-photo.ts / backfill-ridb-photo.ts precedent,
 * which are plain scripts, not migrations.
 *
 * Run:
 *   npm run -w data backfill:nps-amenities -- --dry-run     # read-only preview
 *   npm run -w data backfill:nps-amenities                  # apply (test)
 *   # PROD: swap data/.env to prod creds, then: ... -- --confirm
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { coerceCampgroundAmenities } from "../ingestion/sources/nps.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE_SIZE = 1000;

function targetRef(): string {
  const m = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./);
  return m ? m[1] : "unknown";
}

type Row = {
  id: string;
  master_place_id: string | null;
  raw_payload: { campground?: { amenities?: Record<string, unknown> } } | null;
  normalized_payload: Record<string, unknown> | null;
};

/** The amenities value this row SHOULD carry, from its own raw_payload. Null
 *  for non-campground NPS records (raw_payload has no `campground` key) and
 *  for campgrounds with no amenities data at all — both already write null
 *  today, so those rows correctly no-op below. */
function desiredAmenities(row: Row): Record<string, unknown> | null {
  const raw = row.raw_payload?.campground?.amenities;
  return raw ? coerceCampgroundAmenities(raw) : null;
}

/** Field-wise compare, NOT JSON.stringify — postgres jsonb does not
 *  preserve key order, so a stringify compare would re-write every row on
 *  every run (not idempotent). Mirrors backfill-nps-photo.ts's
 *  alreadyMatches(). */
function sameAmenities(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): boolean {
  if (a === null || b === null) return a === b;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => k === bKeys[i] && a[k] === b[k]);
}

export async function scan(
  db: SupabaseClient,
  apply: boolean,
  pageSize: number = PAGE_SIZE,
): Promise<{
  scanned: number;
  withAmenities: number;
  changed: number;
  skipped: number;
  affectedMasterPlaceIds: string[];
}> {
  const stats = { scanned: 0, withAmenities: 0, changed: 0, skipped: 0 };

  // Phase 1 — READ ONLY, ordered, so a Phase 2 write can never perturb the
  // page window (see backfill-nps-photo.ts's own comment on this exact bug).
  const pending: {
    id: string;
    normalized: Record<string, unknown>;
    master_place_id: string | null;
  }[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("source_record")
      .select("id, master_place_id, raw_payload, normalized_payload")
      .eq("source_id", "nps")
      .eq("is_active", true)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch nps source_records: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      const amenities = desiredAmenities(row);
      if (amenities) stats.withAmenities += 1;
      const current = (row.normalized_payload?.amenities ?? null) as
        | Record<string, unknown>
        | null;
      if (sameAmenities(current, amenities)) {
        stats.skipped += 1;
        continue;
      }
      stats.changed += 1;
      pending.push({
        id: row.id,
        normalized: { ...(row.normalized_payload ?? {}), amenities },
        master_place_id: row.master_place_id,
      });
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const affectedMasterPlaceIds = [
    ...new Set(
      pending
        .map((p) => p.master_place_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  // Phase 2 — WRITE by id. Phase 1's enumeration is already complete, so
  // this single pass writes every changed row.
  if (apply) {
    for (const { id, normalized } of pending) {
      const { error: upErr } = await db
        .from("source_record")
        .update({ normalized_payload: normalized })
        .eq("id", id);
      if (upErr) throw new Error(`update ${id}: ${upErr.message}`);
    }
  }

  return { ...stats, affectedMasterPlaceIds };
}

/** Recompute every affected master_place — resolve_field() re-reads
 *  normalized_payload live, but master_place.amenities is a cached column
 *  only recompute_master_place() writes, so a source_record edit alone
 *  never updates it. Sequential (matches recompute-osm-amenities-
 *  candidates.ts), logs progress every 50 (149-scale, not 9000-scale). */
export async function recompute(
  db: SupabaseClient,
  ids: string[],
): Promise<{ ok: number; failed: number; errors: { id: string; message: string }[] }> {
  let ok = 0;
  let failed = 0;
  const errors: { id: string; message: string }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const { error } = await db.rpc("recompute_master_place", {
      p_master_place_id: ids[i],
    });
    if (error) {
      failed++;
      errors.push({ id: ids[i], message: error.message });
    } else {
      ok++;
    }
    if ((i + 1) % 50 === 0) {
      logger.info({ done: i + 1, total: ids.length, ok, failed }, "backfill-nps-amenities: recompute progress");
    }
  }
  return { ok, failed, errors };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("backfill-nps-amenities")
    .description(
      "Backfill normalized_payload.amenities on nps source_records via the new coerceCampgroundAmenities normalizer, then recompute affected master_place rows.",
    )
    .option("--dry-run", "Read-only preview; writes nothing. Needs no --confirm.")
    .option("--confirm", "Required to write against the PRODUCTION project.")
    .parse(process.argv);
  const opts = program.opts<{ dryRun?: boolean; confirm?: boolean }>();
  const db = getDb();
  const ref = targetRef();

  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) {
    logger.error(
      { target: ref },
      "refusing to backfill PRODUCTION without --confirm. Re-run with --confirm, or use --dry-run.",
    );
    process.exitCode = 1;
    return;
  }
  if (ref !== PROD_REF && ref !== TEST_REF) {
    logger.warn({ target: ref }, "target is neither the known prod nor test ref; proceeding");
  }

  const apply = !opts.dryRun;
  const scanStats = await scan(db, apply);
  logger.info(
    { target: ref, apply, ...scanStats },
    apply ? "backfill-nps-amenities: scan+write applied" : "backfill-nps-amenities: dry-run",
  );

  let recomputeStats: Awaited<ReturnType<typeof recompute>> | null = null;
  if (apply && scanStats.affectedMasterPlaceIds.length > 0) {
    recomputeStats = await recompute(db, scanStats.affectedMasterPlaceIds);
    logger.info({ target: ref, ...recomputeStats, errors: undefined }, "backfill-nps-amenities: recompute complete");
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { target: ref, apply, scan: scanStats, recompute: recomputeStats },
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "backfill-nps-amenities: fatal");
    process.exit(1);
  });
}
