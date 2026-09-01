/**
 * Google-verified auto-adjudication of the CA-campground photo pilot.
 *
 * For every stored candidate (all statuses, including already-accepted), fetch
 * a LIVE Google reference photo of the same place, compare it against the
 * stored candidate photo with a vision model, and store the verdict.
 *
 *   match      → match_status = 'accepted'
 *   no_match   → match_status = 'rejected'
 *   ambiguous  → match_status = 'rejected'   (conservative default, per instruction)
 *   no Google result → google_verdict='no_google_result', match_status UNCHANGED (couldn't verify)
 *   API/vision error after retries → google_verdict='unverified', match_status UNCHANGED
 *
 * ⚠️ COMPLIANCE: the Google reference image is fetched live, held in memory for
 * the comparison, and discarded. NO Google image bytes / URL / photo id are
 * written to the DB or any file — only the verdict/confidence/reasoning.
 *
 * NOT wired into rendering. Auth: TEST Supabase from data/.env; ANTHROPIC_API_KEY
 * borrowed into the environment before running (see the npm script note).
 *
 * Run (TEST):
 *   export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' ../web/.env.local | cut -d= -f2-)
 *   npm run -w data backfill:photo-verify -- --dry-run --limit 5
 *   npm run -w data backfill:photo-verify
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { fetchGoogleReference } from "../photo-backfill/google-reference.ts";
import { compareToGoogle, type Verdict } from "../photo-backfill/vision-compare.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const CONCURRENCY = 4;
const UA = "overlander-data-photo-pilot/0.1 (adam@acwcreative.com)";

function targetRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}
const chunk = <T>(a: T[], n: number): T[][] => {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
};

type Row = {
  id: string;
  master_place_id: string;
  place_name: string;
  source: string;
  image_url: string;
  thumb_url: string | null;
  match_status: string;
};

async function pageAll<T>(build: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const r = await build(f, f + 999);
    if (r.error || r.data == null) { logger.error({ resp: r }, "query failed"); throw new Error("query failed"); }
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return out;
}

async function fetchImageBase64(url: string): Promise<{ base64: string; mediaType: string }> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw Object.assign(new Error(`candidate image ${r.status}`), { status: r.status });
  const mediaType = r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return { base64: buf.toString("base64"), mediaType };
}

type Outcome = {
  google_verdict: string;
  google_confidence: string | null;
  google_reasoning: string;
  new_status: string | null; // null → leave match_status unchanged
};

async function verifyRow(row: Row, coords: Map<string, { lng: number; lat: number }>): Promise<Outcome> {
  const c = coords.get(row.master_place_id);
  if (!c) return { google_verdict: "unverified", google_confidence: null, google_reasoning: "no coordinate on record; cannot geo-search Google", new_status: null };

  // Live Google reference (in memory only). A throw here = couldn't verify.
  const ref = await fetchGoogleReference(row.place_name, c.lat, c.lng);
  if (ref.status === "no_result") {
    return { google_verdict: "no_google_result", google_confidence: null, google_reasoning: "Google returned no matching place/photo for this name+location", new_status: null };
  }

  const candidate = await fetchImageBase64(row.thumb_url || row.image_url);
  const v: Verdict = await compareToGoogle({
    placeName: row.place_name,
    candidateSource: row.source,
    candidate,
    google: { base64: ref.imageBase64, mediaType: ref.mediaType },
  });
  // ref.imageBase64 goes out of scope here and is never persisted.

  const new_status = v.verdict === "match" ? "accepted" : "rejected"; // no_match & ambiguous → rejected
  return { google_verdict: v.verdict, google_confidence: v.confidence, google_reasoning: v.reasoning, new_status };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--dry-run", "Preview only; no writes.")
    .option("--limit <n>", "Max rows to process.", parseInt)
    .option("--pilot-run <label>", "Which pilot_run to verify.")
    .option("--confirm", "Required for PRODUCTION.")
    .parse(process.argv);
  const opts = program.opts<{ dryRun?: boolean; limit?: number; pilotRun?: string; confirm?: boolean }>();

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error({}, "ANTHROPIC_API_KEY not set — export it from web/.env.local before running (see header)");
    process.exitCode = 1;
    return;
  }

  const db: SupabaseClient = getDb();
  const ref = targetRef();
  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) {
    logger.error({ target: ref }, "refusing PRODUCTION without --confirm");
    process.exitCode = 1;
    return;
  }
  const apply = !opts.dryRun;
  const pilotRun = opts.pilotRun ?? "ca-campground-2026-09-01-fixed";
  console.log(`Target: ${ref}${ref === PROD_REF ? " ** PROD **" : " (test)"} | apply=${apply} | pilot_run=${pilotRun}`);

  let rows = await pageAll<Row>((f, t) =>
    db.from("master_place_photo_candidate")
      .select("id,master_place_id,place_name,source,image_url,thumb_url,match_status")
      .eq("pilot_run", pilotRun).order("id").range(f, t),
  );
  if (opts.limit) rows = rows.slice(0, opts.limit);
  console.log(`Rows to verify: ${rows.length}`);
  if (rows.length === 0) return;

  // coords for the distinct places (from the search export; in-memory join)
  const exp = await pageAll<{ id: string; lng: number | null; lat: number | null }>((f, t) =>
    db.from("master_place_search_export").select("id,lng,lat").eq("primary_category", "campground").order("id").range(f, t),
  );
  const coords = new Map<string, { lng: number; lat: number }>();
  for (const e of exp) if (e.lng != null && e.lat != null) coords.set(e.id, { lng: e.lng, lat: e.lat });

  const stat = { processed: 0, match: 0, noMatch: 0, ambiguous: 0, noGoogle: 0, unverified: 0, errors: 0 };
  const samples: Array<{ place: string; source: string; verdict: string; conf: string | null; reason: string }> = [];

  for (const batch of chunk(rows, CONCURRENCY)) {
    await Promise.all(batch.map(async (row) => {
      stat.processed++;
      let outcome: Outcome;
      try {
        outcome = await verifyRow(row, coords);
      } catch (err) {
        stat.errors++;
        outcome = { google_verdict: "unverified", google_confidence: null, google_reasoning: `error: ${String((err as Error)?.message ?? err).slice(0, 300)}`, new_status: null };
        logger.warn({ err, place: row.place_name }, "verify error → unverified");
      }
      if (outcome.google_verdict === "match") stat.match++;
      else if (outcome.google_verdict === "no_match") stat.noMatch++;
      else if (outcome.google_verdict === "ambiguous") stat.ambiguous++;
      else if (outcome.google_verdict === "no_google_result") stat.noGoogle++;
      else if (outcome.google_verdict === "unverified" && !outcome.google_reasoning.startsWith("error:")) stat.unverified++;

      if (samples.length < 16) samples.push({ place: row.place_name, source: row.source, verdict: outcome.google_verdict, conf: outcome.google_confidence, reason: outcome.google_reasoning });

      if (apply) {
        const patch: Record<string, unknown> = {
          google_verdict: outcome.google_verdict,
          google_confidence: outcome.google_confidence,
          google_reasoning: outcome.google_reasoning,
          google_ref_source: "google_places_text_search",
          google_checked_at: new Date().toISOString(),
        };
        if (outcome.new_status) patch.match_status = outcome.new_status;
        const { error } = await db.from("master_place_photo_candidate").update(patch).eq("id", row.id);
        if (error) { stat.errors++; logger.error({ err: error, id: row.id }, "update failed"); }
      }
    }));
    process.stderr.write(`  ${stat.processed}/${rows.length} match=${stat.match} noMatch=${stat.noMatch} amb=${stat.ambiguous} noGoogle=${stat.noGoogle} unver=${stat.unverified} err=${stat.errors}\n`);
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("\n=== VERIFY RESULT ===");
  console.log(JSON.stringify({ target: ref, pilotRun, apply, ...stat }, null, 2));
  console.log("\n=== SAMPLES (verdict | place | source) ===");
  for (const s of samples) console.log(`  [${s.verdict}${s.conf ? "/" + s.conf : ""}] "${s.place}" (${s.source})\n      ${s.reason.slice(0, 200)}`);
  if (!apply) console.log("\n(dry-run: no rows written; no Google image persisted in any mode)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { logger.error({ err }, "photo-verify-google: fatal"); process.exit(1); });
}
