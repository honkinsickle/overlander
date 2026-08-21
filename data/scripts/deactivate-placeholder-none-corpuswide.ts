/**
 * Deactivate NONE-bucket master_place rows whose canonical_name is
 * placeholder-shaped (isPlaceholderName — null/empty/"unnamed …"/the small
 * generic-name allowlist), corpus-wide, any category. Extends today's
 * picnic_area/ev_charging deactivations (which used an exact-literal-string
 * match scoped to one category each) to the full pattern, per
 * docs/measurements/2026-08-21-none-bucket-reduction-strategy.md §3a.
 *
 * Deliberately does NOT include the "junk-code-like" pattern (bare numbers,
 * short alphanumeric site codes like "42"/"D10.62L") — that pattern had
 * confirmed false positives on real brand names ("7-Eleven", "Good2Go") in
 * the strategy report and needs manual review before any deactivation. See
 * dump-junkcode-review-list-2026-08-21.ts for that list. NOT deactivated
 * here, on purpose.
 *
 * Same three-step mechanism as deactivate-unnamed-picnic-area.ts /
 * deactivate-unnamed-ev-charging.ts / Phase 0 peak/spring:
 *   1. source_record.is_active = false on every active source_record
 *      attached to a target master_place.
 *   2. recompute_master_place() on every target master_place.
 *   3. Delete dangling PENDING place_match rows referencing the
 *      now-inactive source_records.
 *
 * Target set is restricted to NONE-bucket (computed fresh, not assumed) —
 * safe because every source attached to a NONE-bucket row already
 * contributes no eligibility signal, so nothing of value is destroyed.
 *
 * Dry-run by default. Pass --write to apply. TEST only — asserts project ref.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/deactivate-placeholder-none-corpuswide.ts          # dry-run
 *   cd data && npx tsx --env-file=.env scripts/deactivate-placeholder-none-corpuswide.ts --write   # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import {
  computeSignals, emptyAggregatedSignals, foldSignalsInto,
  isStrong as isStrongSignals, isWeak as isWeakSignals,
} from "./lib/eligibility.ts";

const CHUNK = 500;
const RECOMPUTE_CONCURRENCY = 15;
const PAGE = 1000;

const PLACEHOLDER_ALLOWLIST = new Set(["campsite", "designated campsite", "designated walk-in campsite"]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}
function isJunkCodeLike(name: string): boolean {
  const n = name.trim();
  if (n.includes(" ")) return false;
  if (!/\d/.test(n)) return false;
  if (n.length > 15) return false;
  return /^[A-Za-z0-9.\-]+$/.test(n);
}

function bucket(s: any): "STRONG" | "WEAK" | "NONE" {
  if (isStrongSignals(s)) return "STRONG";
  if (isWeakSignals(s)) return "WEAK";
  return "NONE";
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
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write)" : "DRY-RUN (pass --write to apply)"}`);

  // ── In-scope MPs ──
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, canonical_name, primary_category").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`\nIn-scope MPs: ${mps.length}`);
  const inScopeIds = new Set(mps.map(m => m.id));

  // ── Active source_records, scoped to in-scope MPs ──
  const allSR: any[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record").select("id, master_place_id, normalized_payload, raw_payload").eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    for (const s of r.data as any[]) if (s.master_place_id && inScopeIds.has(s.master_place_id)) allSR.push(s);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`In-scope active source_records: ${allSR.length}`);

  const sigByMp = new Map<string, any>();
  const srByMp = new Map<string, string[]>();
  for (const sr of allSR) {
    let s = sigByMp.get(sr.master_place_id);
    if (!s) { s = emptyAggregatedSignals(); sigByMp.set(sr.master_place_id, s); }
    foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
    let arr = srByMp.get(sr.master_place_id);
    if (!arr) { arr = []; srByMp.set(sr.master_place_id, arr); }
    arr.push(sr.id);
  }

  const targetMpIds: string[] = [];
  const targetSrIds: string[] = [];
  let junkCodeExcluded = 0, realExcluded = 0, strongOrWeakExcluded = 0;
  for (const m of mps) {
    const sig = sigByMp.get(m.id);
    if (!sig) continue; // no active source — not part of this population at all
    const b = bucket(sig);
    const name = m.canonical_name ?? "";
    if (b !== "NONE") { if (isPlaceholderName(name)) strongOrWeakExcluded++; continue; }
    if (!isPlaceholderName(name)) {
      if (isJunkCodeLike(name)) junkCodeExcluded++; else realExcluded++;
      continue;
    }
    targetMpIds.push(m.id);
    targetSrIds.push(...(srByMp.get(m.id) ?? []));
  }

  console.log(`\nNONE-bucket + placeholder-named target master_places: ${targetMpIds.length}`);
  console.log(`Active source_records attached to them: ${targetSrIds.length}`);
  console.log(`Excluded (NONE-bucket, junk-code-like — NOT deactivated, see review list): ${junkCodeExcluded}`);
  console.log(`Excluded (NONE-bucket, real-named): ${realExcluded}`);
  console.log(`Excluded (placeholder-named but STRONG/WEAK bucket — real signal preserved): ${strongOrWeakExcluded}`);

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
