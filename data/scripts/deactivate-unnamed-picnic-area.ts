/**
 * Deactivate NONE-bucket master_place rows whose canonical_name is the exact
 * literal "Unnamed picnic area" and primary_category = 'picnic_area'.
 *
 * Same mechanism as deactivate-peak-spring.ts (Phase 0):
 *   1. source_record.is_active = false on every active source_record
 *      attached to a target master_place (never a hard delete).
 *   2. recompute_master_place() on every target master_place — drops
 *      source_count to 0.
 *   3. Delete dangling PENDING place_match rows referencing the
 *      now-inactive source_records.
 *
 * Scope, deliberately narrower than the literal "canonical_name is the exact
 * literal 'Unnamed picnic area'" instruction, per explicit user direction
 * after two findings surfaced during re-verification:
 *   - The exact string also appears on 22 primary_category='campground'
 *     rows (excluded — user chose 'picnic_area' only).
 *   - 60 STRONG-bucket + 3 WEAK-bucket rows carry this placeholder name
 *     alongside real signal from another source (source_count up to 8).
 *     Deactivating those would destroy real corpus signal and break the
 *     Phase 0 precedent's "verify zero valuable exceptions before writing"
 *     standard (excluded — user chose NONE-bucket only).
 *
 * Unlike peak/spring (which deactivated specific SOURCE records filtered by
 * source_id+inferred_category, independent of which master_place they
 * belonged to), this scoped set is defined at the MASTER_PLACE level
 * (canonical_name + primary_category + current bucket), so "deactivate the
 * target rows" means: deactivate ALL active source_records attached to each
 * target master_place. This is safe specifically because the target set is
 * restricted to NONE-bucket — by definition every source attached to those
 * rows already contributes no meaningful signal.
 *
 * Dry-run by default. Pass --write to apply. TEST only — asserts project ref.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/deactivate-unnamed-picnic-area.ts          # dry-run
 *   cd data && npx tsx --env-file=.env scripts/deactivate-unnamed-picnic-area.ts --write   # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import {
  computeSignals, emptyAggregatedSignals, foldSignalsInto,
  isStrong as isStrongSignals, isWeak as isWeakSignals,
} from "./lib/eligibility.ts";

const TARGET_NAME = "Unnamed picnic area";
const TARGET_CATEGORY = "picnic_area";
const CHUNK = 500;
const RECOMPUTE_CONCURRENCY = 15;
const PAGE = 1000;

function bucket(s: any): "STRONG" | "WEAK" | "NONE" {
  if (isStrongSignals(s)) return "STRONG";
  if (isWeakSignals(s)) return "WEAK";
  return "NONE";
}

async function fetchAll<T = any>(
  db: SupabaseClient,
  table: string,
  build: (q: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const r = await build(db.from(table)).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    rows.push(...(r.data as T[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") {
    console.error(`Refusing non-TEST: ${ref}`);
    process.exit(2);
  }
  const write = process.argv.includes("--write");
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write)" : "DRY-RUN (pass --write to apply)"}`);

  // ── Discover target master_places: exact name + category ──
  const mpRows = await fetchAll<{ id: string; source_count: number }>(db, "master_place", (q) =>
    q.select("id, source_count").eq("canonical_name", TARGET_NAME).eq("primary_category", TARGET_CATEGORY),
  );
  console.log(`\nExact-match master_places (canonical_name="${TARGET_NAME}", primary_category="${TARGET_CATEGORY}"): ${mpRows.length}`);

  // ── Bucket every one fresh, restrict to NONE ──
  const mpIdSet = new Set(mpRows.map((m) => m.id));
  const allSR = await fetchAll<{ id: string; master_place_id: string | null; normalized_payload: any; raw_payload: any }>(
    db, "source_record", (q) =>
      q.select("id, master_place_id, normalized_payload, raw_payload").eq("is_active", true),
  );
  const sigByMp = new Map<string, any>();
  const srByMp = new Map<string, string[]>();
  for (const sr of allSR) {
    if (!sr.master_place_id || !mpIdSet.has(sr.master_place_id)) continue;
    let s = sigByMp.get(sr.master_place_id);
    if (!s) { s = emptyAggregatedSignals(); sigByMp.set(sr.master_place_id, s); }
    foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
    let arr = srByMp.get(sr.master_place_id);
    if (!arr) { arr = []; srByMp.set(sr.master_place_id, arr); }
    arr.push(sr.id);
  }

  const targetMpIds: string[] = [];
  const targetSrIds: string[] = [];
  let strongExcluded = 0, weakExcluded = 0, noSigExcluded = 0;
  for (const m of mpRows) {
    const sig = sigByMp.get(m.id);
    if (!sig) { noSigExcluded++; continue; } // no active source at all — nothing to deactivate
    const b = bucket(sig);
    if (b === "STRONG") { strongExcluded++; continue; }
    if (b === "WEAK") { weakExcluded++; continue; }
    targetMpIds.push(m.id);
    targetSrIds.push(...(srByMp.get(m.id) ?? []));
  }

  console.log(`\nNONE-bucket target master_places: ${targetMpIds.length}`);
  console.log(`Active source_records attached to them: ${targetSrIds.length}`);
  console.log(`Excluded (STRONG bucket): ${strongExcluded}`);
  console.log(`Excluded (WEAK bucket): ${weakExcluded}`);
  console.log(`Excluded (no active source_record): ${noSigExcluded}`);

  if (!write) {
    console.log("\nDRY-RUN — no writes made. Pass --write to apply.");
    process.exit(0);
  }

  // ── Step 1: deactivate source_records ──
  console.log("\nStep 1: deactivating source_records...");
  let deactivated = 0;
  for (let i = 0; i < targetSrIds.length; i += CHUNK) {
    const chunk = targetSrIds.slice(i, i + CHUNK);
    const upd = await db.from("source_record").update({ is_active: false }).in("id", chunk).select("id");
    if (upd.error || upd.data == null) { console.log("UPDATE FAILED:", upd); throw new Error(""); }
    deactivated += upd.data.length;
    if ((i + CHUNK) % 2000 < CHUNK) console.log(`  ...${deactivated}/${targetSrIds.length}`);
  }
  console.log(`  deactivated ${deactivated} source_records`);

  // ── Step 2: recompute affected master_places (parallelized) ──
  console.log("\nStep 2: recomputing master_places...");
  const limit = pLimit(RECOMPUTE_CONCURRENCY);
  let ok = 0, failed = 0, done = 0;
  const errors: { id: string; message: string }[] = [];
  await Promise.all(
    targetMpIds.map((id) =>
      limit(async () => {
        const { error } = await db.rpc("recompute_master_place", { p_master_place_id: id });
        done++;
        if (error) { failed++; errors.push({ id, message: error.message }); } else ok++;
        if (done % 1000 === 0) console.log(`  ...${done}/${targetMpIds.length} (ok=${ok} failed=${failed})`);
      }),
    ),
  );
  console.log(`  recompute done. ok=${ok} failed=${failed}`);
  if (errors.length > 0) {
    console.log("  first 10 errors:");
    for (const e of errors.slice(0, 10)) console.log(`    ${e.id}: ${e.message}`);
  }

  // ── Step 3: clear dangling pending place_match rows ──
  console.log("\nStep 3: clearing dangling pending place_match rows...");
  let pmDeleted = 0;
  for (let i = 0; i < targetSrIds.length; i += 200) {
    const chunk = targetSrIds.slice(i, i + 200);
    const del = await db.from("place_match").delete({ count: "exact" }).in("source_record_id", chunk).eq("status", "pending");
    if (del.error) { console.log("DELETE FAILED:", del); throw new Error(""); }
    pmDeleted += del.count ?? 0;
  }
  console.log(`  cleared ${pmDeleted} dangling pending place_match rows`);

  console.log("\nDone.");
  console.log(JSON.stringify({ deactivated, recompute: { ok, failed }, pmDeleted }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
