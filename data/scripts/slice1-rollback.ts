/**
 * Corridor-ingest ROLLBACK — delete exactly the rows a run added, identified by
 * set-difference against the pre-run snapshot's immutable ids. Immune to the
 * fetch_timestamp bump that re-upserting overlapping existing rows causes (see
 * docs/decisions/2026-07-23-corridor-rollback-by-id-snapshot.md).
 *
 * DRY-RUN BY DEFAULT (read-only). Pass --execute to delete.
 *
 * SELF-TEST: run this in dry-run IMMEDIATELY AFTER the snapshot, before the
 * ingest run. With zero new rows the diff must be empty ("SELF-TEST PASS"). If
 * it reports anything to delete, the snapshot/diff is wrong — STOP.
 *
 * Run:
 *   npm run -w data slice:rollback                      # dry-run (default path)
 *   npm run -w data slice:rollback -- <path>            # dry-run, custom snapshot
 *   npm run -w data slice:rollback -- --execute         # delete
 *
 * On --execute:
 *   1. Delete new source_records (id ∉ snapshot) — cascades their place_match.
 *   2. Recompute any EXISTING master_place that absorbed a deleted source_record
 *      (restores source_count / prominence / attribution).
 *   3. Delete new master_places (id ∉ snapshot) — cascades remaining place_match.
 *   4. Verify source_record / master_place / place_match counts vs the snapshot.
 *      A place_match mismatch means the FK cascade under-fired — surfaced, not hidden.
 *   5. Then run `npm run -w data search:sync` to prune deleted docs from Typesense.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

const TEST_REF = "znldzjdatkogdktymtvi";
const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const SNAP =
  args.find((a) => !a.startsWith("--")) ??
  path.join(os.homedir(), ".config/overlander/slice1-rollback-snapshot.json");

async function allIds(table: string): Promise<string[]> {
  const db = getDb();
  const ids: string[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await db.from(table).select("id").order("id").range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    ids.push(...(data as { id: string }[]).map((r) => r.id));
    if (data.length < page) break;
    from += page;
  }
  return ids;
}

async function count(table: string): Promise<number> {
  const db = getDb();
  const { count: c, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return c ?? -1;
}

async function chunkedDelete(table: string, ids: string[]): Promise<number> {
  const db = getDb();
  let n = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { error, count: c } = await db.from(table).delete({ count: "exact" }).in("id", chunk);
    if (error) throw new Error(`${table} delete: ${error.message}`);
    n += c ?? 0;
  }
  return n;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  if (!url.includes(TEST_REF)) throw new Error(`Refusing: expected TEST project (${TEST_REF}), got ${url}.`);
  if (!fs.existsSync(SNAP)) throw new Error(`Snapshot not found: ${SNAP} — run slice:snapshot BEFORE the ingest run.`);

  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8")) as {
    counts: { source_record: number; master_place: number; place_match: number };
    sourceRecordIds: string[];
    masterPlaceIds: string[];
    placeMatchIds: string[];
  };
  const snapSR = new Set(snap.sourceRecordIds);
  const snapMP = new Set(snap.masterPlaceIds);

  const curSR = await allIds("source_record");
  const curMP = await allIds("master_place");
  const newSR = curSR.filter((id) => !snapSR.has(id));
  const newMP = curMP.filter((id) => !snapMP.has(id));

  console.log("project:", url, EXECUTE ? "[EXECUTE]" : "[DRY-RUN]");
  console.log(`snapshot: ${snap.counts.source_record} SR / ${snap.counts.master_place} MP / ${snap.counts.place_match} PM`);
  console.log(`current:  ${curSR.length} SR / ${curMP.length} MP`);
  console.log(`to delete: ${newSR.length} source_records, ${newMP.length} master_places`);

  if (newSR.length === 0 && newMP.length === 0) {
    console.log("SELF-TEST PASS: snapshot round-trips, set-difference is empty, nothing to delete.");
    if (!EXECUTE) return;
  }

  // Existing (snapshot) master_places that absorbed a to-be-deleted source_record.
  const affected = new Set<string>();
  for (let i = 0; i < newSR.length; i += 200) {
    const chunk = newSR.slice(i, i + 200);
    const { data, error } = await getDb().from("source_record").select("master_place_id").in("id", chunk);
    if (error) throw new Error(error.message);
    for (const r of data as { master_place_id: string | null }[]) {
      if (r.master_place_id && snapMP.has(r.master_place_id)) affected.add(r.master_place_id);
    }
  }
  console.log(`existing master_places that absorbed a new record (will recompute): ${affected.size}`);

  if (!EXECUTE) {
    console.log("\nDRY-RUN — nothing changed. Re-run with --execute to apply.");
    return;
  }

  const dSR = await chunkedDelete("source_record", newSR);
  console.log("deleted source_records:", dSR);

  let recomputed = 0;
  for (const id of affected) {
    const { error } = await getDb().rpc("recompute_master_place", { p_master_place_id: id });
    if (error) console.warn("recompute failed", id, error.message);
    else recomputed++;
  }
  console.log("recomputed existing master_places:", recomputed);

  const dMP = await chunkedDelete("master_place", newMP);
  console.log("deleted master_places:", dMP);

  const finalSR = await count("source_record");
  const finalMP = await count("master_place");
  const finalPM = await count("place_match");
  const ok =
    finalSR === snap.counts.source_record &&
    finalMP === snap.counts.master_place &&
    finalPM === snap.counts.place_match;
  console.log(`\nFINAL vs snapshot:`);
  console.log(`  source_record ${finalSR} / ${snap.counts.source_record}`);
  console.log(`  master_place  ${finalMP} / ${snap.counts.master_place}`);
  console.log(`  place_match   ${finalPM} / ${snap.counts.place_match}  ${finalPM === snap.counts.place_match ? "" : "← MISMATCH: FK cascade under-fired"}`);
  console.log(ok ? "✓ baseline restored" : "✗ MISMATCH — investigate before proceeding");
  logger.info({ finalSR, finalMP, finalPM, ok }, "slice1-rollback: complete");
  console.log("Now run `npm run -w data search:sync` to prune deleted docs from Typesense.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
