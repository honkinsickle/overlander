/**
 * Backfill RIDB imagery onto source_record.normalized_payload.photo (Route A).
 *
 * Unlike NPS, RIDB list responses (/facilities, /recareas) do NOT include a
 * media array — media lives at /facilities/{id}/media and /recareas/{id}/media.
 * The ridb ingester started calling those endpoints and promoting the primary
 * Image at ingest time. This backfill covers rows written BEFORE that change:
 * it re-fetches media per row, computes the same photo, and updates
 * normalized_payload.
 *
 * Idempotent + re-runnable: writes only when the recomputed photo differs
 * from what's stored (jsonb field-wise compare, not stringify — matches the
 * NPS backfill pattern). A second run reports 0 changed.
 *
 * NOT a corpus materialize/--rematerialize: writes NO master_place row and
 * inserts NO source_record — sets one jsonb key on existing ridb source_records.
 * PROD is guarded behind --confirm; TEST is the default via `data/.env`.
 *
 * Rate-limited via limits.ridb (pLimit(4)); the /media endpoint hits the same
 * RIDB API quota as the paginated list endpoints.
 *
 * Run:
 *   npm run -w data backfill:ridb-photo -- --dry-run     # read-only preview
 *   npm run -w data backfill:ridb-photo                  # apply (test)
 *   # PROD: swap data/.env to prod creds, then: ... -- --confirm
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { limits } from "../ingestion/lib/rate-limit.ts";
import { fetchEntityMedia, ridbPhotoFromMedia, type RidbPhoto } from "../ingestion/sources/ridb.ts";

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
  raw_payload: { media?: unknown[] } | null;
  normalized_payload: Record<string, unknown> | null;
};

function parseExternal(externalId: string): { entity: "facilities" | "recareas"; id: string } | null {
  // ridb:facility:<id> | ridb:recarea:<id>
  const parts = externalId.split(":");
  if (parts.length !== 3 || parts[0] !== "ridb") return null;
  if (parts[1] === "facility") return { entity: "facilities", id: parts[2] };
  if (parts[1] === "recarea") return { entity: "recareas", id: parts[2] };
  return null;
}

function alreadyMatches(row: Row, want: RidbPhoto | null): boolean {
  const cur = ((row.normalized_payload ?? {}).photo ?? null) as
    | { url?: unknown; altText?: unknown; credit?: unknown }
    | null;
  if (want === null) return cur === null;
  if (cur === null) return false;
  return (
    cur.url === want.url &&
    (cur.altText ?? null) === want.altText &&
    (cur.credit ?? null) === want.credit
  );
}

export async function scan(
  db: SupabaseClient,
  apply: boolean,
  pageSize: number = PAGE_SIZE,
): Promise<{
  scanned: number;
  fetched: number;
  cacheHits: number;
  withPhoto: number;
  changed: number;
  skipped: number;
  errors: number;
}> {
  const stats = { scanned: 0, fetched: 0, cacheHits: 0, withPhoto: 0, changed: 0, skipped: 0, errors: 0 };

  // Phase 1 — READ ONLY. Enumerate every ridb row in a stable id order and
  // resolve its desired photo. No writes happen here so pagination cannot be
  // perturbed mid-scan. Same lesson the NPS backfill learned the hard way.
  const pending: { id: string; normalized: Record<string, unknown> }[] = [];
  const limit = limits.ridb;

  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("source_record")
      .select("id, external_id, raw_payload, normalized_payload")
      .eq("source_id", "ridb")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch ridb source_records: ${error.message}`);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    await Promise.all(
      rows.map((row) =>
        limit(async () => {
          stats.scanned += 1;
          let photo: RidbPhoto | null = null;

          // Fast path: if raw_payload.media is already present (row written
          // AFTER the ingester started saving it), recompute from that without
          // hitting the network. Older rows have no media key — fetch it.
          const cached = row.raw_payload?.media;
          if (Array.isArray(cached)) {
            stats.cacheHits += 1;
            photo = ridbPhotoFromMedia(cached);
          } else {
            const ext = parseExternal(row.external_id);
            if (!ext) {
              logger.warn({ id: row.id, external_id: row.external_id }, "ridb: unparseable external_id — skipped");
              stats.skipped += 1;
              return;
            }
            try {
              const media = await fetchEntityMedia(ext.entity, ext.id);
              stats.fetched += 1;
              photo = ridbPhotoFromMedia(media);
            } catch (err) {
              logger.warn({ err, id: row.id }, "ridb: media fetch failed — leaving row unchanged");
              stats.errors += 1;
              return;
            }
          }

          if (photo) stats.withPhoto += 1;
          if (alreadyMatches(row, photo)) {
            stats.skipped += 1;
            return;
          }
          stats.changed += 1;
          pending.push({
            id: row.id,
            normalized: { ...(row.normalized_payload ?? {}), photo },
          });
        }),
      ),
    );

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
    .name("backfill-ridb-photo")
    .description("Backfill normalized_payload.photo on ridb source_records via /media endpoints.")
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
  logger.info({ target: ref, apply, ...stats }, apply ? "backfill-ridb-photo: applied" : "backfill-ridb-photo: dry-run");
  console.log(JSON.stringify({ target: ref, apply, ...stats }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "backfill-ridb-photo: fatal");
    process.exit(1);
  });
}
