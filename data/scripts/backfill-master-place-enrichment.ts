/**
 * Backfill the master_place enrichment columns added by migration
 * 20260821060000 (rating / review_count / price_tier / photo_url) — step 1 of
 * docs/decisions/2026-08-21-place-data-resolver-consolidation.md.
 *
 * WHAT IT ACTUALLY WRITES: photo_url, and nothing else.
 *
 * A full-scan census of every source_record for all ten source_ids in the
 * corpus (data/scripts/investigate-enrichment-fields-2026-08-21.ts, TEST
 * 2026-08-21) found NO ingested source carrying a rating, a review count, or
 * a price tier. So this script leaves those three columns explicitly NULL —
 * it does not write a placeholder, a zero, or an empty string — and asserts
 * afterwards that they are still NULL corpus-wide. Adding a populate path for
 * them is blocked on a source whose terms permit storage: the only source
 * known to carry all three is Google Place Details, whose `rating` /
 * `userRatingCount` are explicitly non-cacheable (docs/measurements/
 * 2026-08-20-google-places-details-compliance-check.md).
 *
 * `description` is NOT written here either. It is an existing column owned by
 * recompute_master_place() via field_precedence; writing it directly would
 * violate the schema invariant and be erased on the next recompute. The
 * measured gap (blm and state_parks carry descriptions that no
 * field_precedence row lets through) is reported by the --report pass, not
 * silently patched.
 *
 * MECHANISM. Two id sets are sent to the backfill_master_place_photo_url()
 * RPC (20260821070000), in chunks:
 *   (a) every master_place linked to an active nps/ridb/blm/state_parks
 *       source_record that carries a photo url — the rows to populate;
 *   (b) every master_place that currently has a non-null photo_url — so a
 *       re-run also CLEARS rows whose source has since been deactivated.
 * The RPC resolves and writes set-based; it is guarded on `is distinct from`,
 * so a second run reports 0 changed.
 *
 * TEST is the default target (data/.env). PROD requires --confirm AND is
 * refused unless the ref matches, so a mis-pointed .env cannot write to prod
 * by accident.
 *
 * Run (from data/):
 *   npm run -w data backfill:mp-enrichment -- --dry-run   # read-only preview
 *   npm run -w data backfill:mp-enrichment                # apply (test)
 *   npm run -w data backfill:mp-enrichment -- --report    # post-run verify only
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE = 1000;
/** Ids per RPC call. Each call runs one correlated-subquery UPDATE over the
 *  chunk; 500 keeps the statement well inside PostgREST's timeout on TEST. */
const RPC_CHUNK = 500;

/** Source precedence for photo_url, mirroring the SQL in the RPC. Kept here
 *  only so the dry-run preview reports the same winner split the RPC will
 *  actually write — the RPC is the single source of truth for the write. */
const PHOTO_SOURCES = ["nps", "ridb", "wikipedia", "blm", "state_parks"] as const;
type PhotoSource = (typeof PHOTO_SOURCES)[number];

type Db = SupabaseClient;

function targetRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}

export type SrRow = {
  master_place_id: string | null;
  source_id: string;
  external_id: string;
  source_quality_score: number | null;
  normalized_payload: Record<string, unknown> | null;
  raw_payload: Record<string, unknown> | null;
};

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** The same coalesce chain the RPC uses:
 *    normalized_payload.photo.url  (nps, ridb)
 *    raw_payload.props.PHOTO_LINK  (blm)
 *    raw_payload.props.Imagelink   (state_parks — Washington only in the
 *                                   current corpus; see the measurement doc)
 *  Exported for backfill-master-place-enrichment.test.ts. It must stay in
 *  step with the coalesce chain in
 *  supabase/migrations/20260821070000_backfill_master_place_photo_url.sql —
 *  that SQL is the single source of truth for the write; this function only
 *  drives the dry-run preview. */
export function photoUrlOf(r: SrRow): string | null {
  const photo = r.normalized_payload?.photo as { url?: unknown } | null | undefined;
  const props = r.raw_payload?.props as Record<string, unknown> | undefined;
  return (
    nonEmpty(photo?.url) ??
    nonEmpty(props?.PHOTO_LINK) ??
    nonEmpty(props?.Imagelink)
  );
}

async function scanSourceRecords(db: Db, sourceId: string): Promise<SrRow[]> {
  const out: SrRow[] = [];
  let from = 0;
  for (;;) {
    const res = await db
      .from("source_record")
      .select(
        "id, master_place_id, source_id, external_id, source_quality_score, normalized_payload, raw_payload",
      )
      .eq("source_id", sourceId)
      .eq("is_active", true)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error || res.data == null) {
      // A supabase-js query with a bad column returns a null payload and often
      // an empty error.message — log the WHOLE response, never just .message.
      logger.error({ response: res, sourceId, from }, "source_record scan failed");
      throw new Error(`source_record scan failed for ${sourceId}`);
    }
    const rows = res.data as unknown as SrRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function scanPopulatedPhotoIds(db: Db): Promise<string[]> {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const res = await db
      .from("master_place")
      .select("id")
      .not("photo_url", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error || res.data == null) {
      logger.error({ response: res, from }, "populated photo_url scan failed");
      throw new Error("populated photo_url scan failed");
    }
    const rows = res.data as { id: string }[];
    out.push(...rows.map((r) => r.id));
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function exactCount(
  db: Db,
  build: (q: any) => any,
  label: string,
): Promise<number> {
  const res = await build(db.from("master_place").select("id", { count: "exact", head: true }));
  if (res.error || res.count == null) {
    logger.error({ response: res, label }, "count failed");
    throw new Error(`count failed: ${label}`);
  }
  return res.count as number;
}

/** Post-run verification. Reports the state of all five ADR fields, and
 *  asserts the three that must remain empty actually are. */
async function report(db: Db): Promise<void> {
  const total = await exactCount(db, (q) => q, "master_place total");
  const withPhoto = await exactCount(db, (q) => q.not("photo_url", "is", null), "photo_url");
  const withRating = await exactCount(db, (q) => q.not("rating", "is", null), "rating");
  const withReviews = await exactCount(db, (q) => q.not("review_count", "is", null), "review_count");
  const withPrice = await exactCount(db, (q) => q.not("price_tier", "is", null), "price_tier");
  const withDesc = await exactCount(db, (q) => q.not("description", "is", null), "description");

  console.log("\n=== master_place enrichment columns — post-backfill state ===");
  console.log(`master_place rows                ${total}`);
  console.log(`  photo_url    non-null         ${withPhoto}`);
  console.log(`  rating       non-null         ${withRating}   (expected 0 — no source carries one)`);
  console.log(`  review_count non-null         ${withReviews}   (expected 0 — no source carries one)`);
  console.log(`  price_tier   non-null         ${withPrice}   (expected 0 — no source carries one)`);
  console.log(`  description  non-null         ${withDesc}   (pre-existing column, recompute-owned, untouched here)`);

  // Empty-string check: the ADR calls for explicit NULL, never a placeholder.
  const emptyPhoto = await exactCount(db, (q) => q.eq("photo_url", ""), "photo_url empty string");
  console.log(`  photo_url    empty-string     ${emptyPhoto}   (expected 0 — NULL is the "no data" value)`);

  if (withRating || withReviews || withPrice || emptyPhoto) {
    throw new Error(
      "post-backfill assertion FAILED — rating/review_count/price_tier must be NULL corpus-wide and photo_url must never be an empty string",
    );
  }
}

async function main(): Promise<void> {
  const program = new Command()
    .option("--dry-run", "read and preview only; write nothing", false)
    .option("--report", "skip the backfill; print the verification report only", false)
    .option("--confirm", "required to write to PROD", false)
    .parse(process.argv);
  const opts = program.opts<{ dryRun: boolean; report: boolean; confirm: boolean }>();

  const ref = targetRef();
  if (ref === PROD_REF && !opts.confirm && !opts.dryRun && !opts.report) {
    throw new Error("target is PROD — re-run with --confirm to write there");
  }
  if (ref !== PROD_REF && ref !== TEST_REF) {
    throw new Error(`unrecognised project ref ${ref} — refusing to run`);
  }
  console.log(`Target project ref: ${ref}${ref === PROD_REF ? "  ** PROD **" : "  (test)"}`);

  const db = getDb();

  if (opts.report) {
    await report(db);
    return;
  }

  // ── Phase 1: read. Resolve the winning photo per master_place, client-side,
  //    purely to produce an accurate preview. The RPC re-resolves in SQL.
  const winner = new Map<string, { url: string; source: PhotoSource }>();
  const perSource: Record<string, { rows: number; linked: number }> = {};
  for (const src of PHOTO_SOURCES) {
    const rows = await scanSourceRecords(db, src);
    let withPhoto = 0;
    let linked = 0;
    for (const r of rows) {
      const url = photoUrlOf(r);
      if (!url) continue;
      withPhoto += 1;
      if (!r.master_place_id) continue;
      linked += 1;
      const cur = winner.get(r.master_place_id);
      if (!cur || PHOTO_SOURCES.indexOf(src) < PHOTO_SOURCES.indexOf(cur.source)) {
        winner.set(r.master_place_id, { url, source: src });
      }
    }
    perSource[src] = { rows: withPhoto, linked };
    console.log(
      `  ${src.padEnd(12)} active source_records carrying a photo url: ${withPhoto} (linked to a master_place: ${linked})`,
    );
  }

  const split = new Map<string, number>();
  for (const v of winner.values()) split.set(v.source, (split.get(v.source) ?? 0) + 1);
  console.log(`\nmaster_place rows with a resolvable photo: ${winner.size}`);
  console.log(
    `  winning source split: ${[...split].sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`,
  );

  const alreadyPopulated = await scanPopulatedPhotoIds(db);
  console.log(`master_place rows currently carrying a photo_url: ${alreadyPopulated.length}`);

  // Union: rows to populate + rows to re-check (and clear if now unbacked).
  const ids = [...new Set([...winner.keys(), ...alreadyPopulated])];
  console.log(`ids to send to backfill_master_place_photo_url(): ${ids.length}`);

  if (opts.dryRun) {
    console.log("\n--dry-run: nothing written.");
    const sample = [...winner.entries()].slice(0, 5);
    for (const [id, v] of sample) console.log(`  e.g. ${id}  ${v.source}  ${v.url}`);
    return;
  }

  // ── Phase 2: write, chunked, server-side.
  let changed = 0;
  for (let i = 0; i < ids.length; i += RPC_CHUNK) {
    const chunk = ids.slice(i, i + RPC_CHUNK);
    const res = await db.rpc("backfill_master_place_photo_url", { p_ids: chunk });
    if (res.error || res.data == null) {
      logger.error({ response: res, offset: i }, "backfill_master_place_photo_url failed");
      throw new Error(`backfill RPC failed at offset ${i}`);
    }
    changed += res.data as number;
    if ((i / RPC_CHUNK) % 4 === 0) {
      process.stderr.write(`  ${Math.min(i + RPC_CHUNK, ids.length)}/${ids.length} (changed ${changed})\n`);
    }
  }
  console.log(`\nrows changed: ${changed}`);

  await report(db);
}

// Guard the entrypoint the same way backfill-nps-photo.ts does. Without it,
// backfill-master-place-enrichment.test.ts importing photoUrlOf() would RUN
// the backfill against whatever SUPABASE_URL the test env points at.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
