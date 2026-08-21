/**
 * Backfill normalized_payload.contact.website onto existing BLM
 * source_records from raw_payload.props.WEB_LINK.
 *
 * Root cause (2026-08-20 NONE-bucket characterization pass, docs/
 * measurements/2026-08-20-none-bucket-characterization.md §5, and the
 * accompanying fix report): blm-rec.ts's normalize() wrote WEB_LINK to a
 * non-standard `web_link` key, deliberately NOT `contact.website`, because
 * the URL is office/region-level, not per-POI — see the comment preserved
 * on that field in blm-rec.ts. The has_website eligibility signal (data/
 * scripts/lib/eligibility.ts) only reads `contact.website`, so BLM rows
 * with a real WEB_LINK were invisible to it. Fixed at ingest time in
 * blm-rec.ts; this backfill re-normalizes rows written before that fix.
 *
 * Purely a re-derivation from each row's own stored raw_payload.props — no
 * network calls, no re-fetch from BLM's ArcGIS endpoint. Idempotent +
 * re-runnable: writes only when the recomputed normalized_payload.contact
 * differs from what's stored (a second run reports 0 changed). Same
 * Phase-1-read-then-Phase-2-write shape as backfill-ridb-photo.ts, so
 * pagination can't be perturbed mid-scan by an interleaved write.
 *
 * NOT a corpus materialize/--rematerialize: writes NO master_place row and
 * inserts NO source_record — sets one jsonb key on existing blm
 * source_records. PROD is guarded behind --confirm; TEST is the default via
 * data/.env.
 *
 * Run:
 *   npm run -w data backfill:blm-website -- --dry-run     # read-only preview
 *   npm run -w data backfill:blm-website                  # apply (test)
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { _internals } from "../ingestion/sources/blm-rec.ts";

const { normalize: normalizeBlm } = _internals;

const PROD_REF = "nqzeywzcowujzyegxbsr";
const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE_SIZE = 1000;

function targetRef(): string {
  const m = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./);
  return m ? m[1] : "unknown";
}

type Row = {
  id: string;
  external_id: string;
  raw_payload: { props?: Record<string, unknown> } | null;
  normalized_payload: Record<string, unknown> | null;
};

function contactsMatch(a: unknown, b: unknown): boolean {
  const an = (a ?? null) as { website?: unknown } | null;
  const bn = (b ?? null) as { website?: unknown } | null;
  if (an === null && bn === null) return true;
  if (an === null || bn === null) return false;
  return (an.website ?? null) === (bn.website ?? null);
}

export async function scan(
  db: SupabaseClient,
  apply: boolean,
  pageSize: number = PAGE_SIZE,
): Promise<{
  scanned: number;
  withWebLink: number;
  withRealWebsite: number;
  changed: number;
  skipped: number;
  errors: number;
}> {
  const stats = { scanned: 0, withWebLink: 0, withRealWebsite: 0, changed: 0, skipped: 0, errors: 0 };

  // Phase 1 — READ ONLY. Enumerate every blm row in a stable id order and
  // recompute its normalized_payload from its own stored raw_payload.props.
  const pending: { id: string; normalized: Record<string, unknown> }[] = [];

  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("source_record")
      .select("id, external_id, raw_payload, normalized_payload")
      .eq("source_id", "blm")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch blm source_records: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    for (const row of rows) {
      stats.scanned += 1;
      const props = row.raw_payload?.props;
      if (!props) {
        logger.warn({ id: row.id, external_id: row.external_id }, "blm-backfill: no raw_payload.props — skipped");
        stats.skipped += 1;
        continue;
      }
      const webLink = typeof props.WEB_LINK === "string" ? props.WEB_LINK.trim() : "";
      if (webLink.length > 0) stats.withWebLink += 1;

      // Re-derive the whole normalized_payload from stored raw_payload —
      // same function the live ingester calls, so this can never drift from
      // ingest-time behavior. `name`/`globalId` aren't inputs to the fields
      // we're backfilling (contact/web_link), but normalize() requires them;
      // pass through the row's own stored values so the rest of the object
      // (canonical_name, description, overlander_tags, etc.) round-trips
      // unchanged for the equality check below.
      const existingName = (row.normalized_payload?.canonical_name as string) ?? "";
      const parts = row.external_id.split(":"); // blm:recpt:<GlobalID>
      const globalId = parts[2] ?? "";
      const recomputed = normalizeBlm(props as any, existingName, globalId);

      if ((recomputed as any).contact?.website) stats.withRealWebsite += 1;

      if (contactsMatch(row.normalized_payload?.contact, (recomputed as any).contact)) {
        stats.skipped += 1;
        continue;
      }
      stats.changed += 1;
      pending.push({
        id: row.id,
        normalized: { ...(row.normalized_payload ?? {}), contact: (recomputed as any).contact, web_link: (recomputed as any).web_link },
      });
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // Phase 2 — WRITE by id.
  if (apply) {
    for (const { id, normalized } of pending) {
      const { error: upErr } = await db
        .from("source_record")
        .update({ normalized_payload: normalized })
        .eq("id", id);
      if (upErr) throw new Error(`update ${id}: ${upErr.message}`);
    }
  }

  return stats;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("backfill-blm-website")
    .description("Backfill normalized_payload.contact.website on blm source_records from raw_payload.props.WEB_LINK.")
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
  const stats = await scan(db, apply);
  logger.info({ target: ref, apply, ...stats }, apply ? "backfill-blm-website: applied" : "backfill-blm-website: dry-run");
  console.log(JSON.stringify({ target: ref, apply, ...stats }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "backfill-blm-website: fatal");
    process.exit(1);
  });
}
