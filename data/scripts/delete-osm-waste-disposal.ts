/**
 * Hard-delete the stale `amenity=waste_disposal` osm source_records from TEST.
 *
 * WHY DELETE (supersedes the reclassify-to-NULL in commit 80bf0a1). These rows
 * were ingested under the pre-#202 mapping `amenity=waste_disposal ->
 * dump_station`. Under the current adapter they are neither fetched nor
 * categorized (`osm.test.ts` asserts `inferCategory` returns null and that the
 * Overpass query never contains the tag), so the row would not exist at all if
 * the corpus were rebuilt today. `docs/BACKLOG.md` preferred delete from the
 * start; 80bf0a1 chose the reversible NULL step first. This completes it.
 *
 * IDENTIFYING THE SET. The prior turn's snapshot at
 * `~/.config/overlander/reclassify-snapshots/` was CLOBBERED to 0 rows by a
 * later dry run (that script wrote its snapshot unconditionally — fixed in the
 * same commit as this file). The set is nonetheless exactly recoverable:
 * before 80bf0a1 **zero** osm source_records had a NULL `inferred_category`
 * (measured, `corpus-baseline-snapshot.ts` before/after), and 80bf0a1 set
 * exactly 123 to NULL. So `source_id='osm' AND inferred_category IS NULL`
 * identifies precisely those rows. This script additionally requires the raw
 * tag `amenity=waste_disposal` on every row and refuses if the count is not
 * the expected 123 — three independent guards, not one.
 *
 * REVERSIBILITY. A full-row backup (every column, plus each row's `place_match`
 * rows, which cascade on delete) is written to a TIMESTAMPED file before any
 * delete. `raw_payload` carries the original OSM element including its
 * coordinates, so a row is reconstructible through `upsert_source_record`.
 *
 * TEST-only. Never touches PROD's 1,723 equivalent rows.
 *
 * Modes:
 *   (default)  dry run — measure + write the backup, delete nothing
 *   --apply    backup, delete, recompute affected master_places, verify
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";
const EXPECTED_COUNT = 123;
const BACKUP_DIR = join(homedir(), ".config", "overlander", "deletion-backups");

type SrRow = {
  id: string;
  source_id: string;
  external_id: string;
  master_place_id: string | null;
  name: string;
  inferred_category: string | null;
  raw_payload: { element?: { tags?: Record<string, string>; lat?: number; lon?: number } } | null;
  normalized_payload: unknown;
  source_quality_score: number;
  fetch_timestamp: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}). This script never runs against PROD.`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const apply = process.argv.includes("--apply");
  console.log(`[env] TEST ${ref}   mode: ${apply ? "APPLY (hard delete)" : "DRY RUN"}\n`);

  const page = 1000;
  async function pageAll<T>(build: (from: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    const out: T[] = [];
    let from = 0;
    while (true) {
      const r = await build(from);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("query failed"); }
      const rows = r.data as T[];
      out.push(...rows);
      if (rows.length < page) break;
      from += page;
    }
    return out;
  }

  // ── Identify the set, with three independent guards ─────────────────────
  const candidates = await pageAll<SrRow>((from) =>
    db.from("source_record")
      .select("id, source_id, external_id, master_place_id, name, inferred_category, raw_payload, normalized_payload, source_quality_score, fetch_timestamp, is_active, created_at, updated_at")
      .eq("source_id", "osm").is("inferred_category", null)
      .order("id").range(from, from + page - 1),
  );

  const tagOf = (r: SrRow) => r.raw_payload?.element?.tags?.amenity ?? "(no amenity tag)";
  const target = candidates.filter((r) => tagOf(r) === "waste_disposal");
  const nonTarget = candidates.filter((r) => tagOf(r) !== "waste_disposal");

  console.log("GUARD 1 — osm source_records with inferred_category IS NULL:", candidates.length);
  console.log("GUARD 2 — of those, raw amenity=waste_disposal:", target.length);
  if (nonTarget.length > 0) {
    console.log(`  !! ${nonTarget.length} NULL-category osm rows are NOT waste_disposal — they will NOT be deleted:`);
    for (const r of nonTarget.slice(0, 10)) console.log(`     ${r.external_id}  amenity=${tagOf(r)}`);
  }
  console.log(`GUARD 3 — expected count ${EXPECTED_COUNT}: ${target.length === EXPECTED_COUNT ? "MATCH" : "MISMATCH"}`);
  if (target.length !== EXPECTED_COUNT) throw new Error(`Refusing: expected ${EXPECTED_COUNT} rows, found ${target.length}.`);

  const allInactive = target.every((r) => !r.is_active);
  console.log(`GUARD 4 — every target row is_active=false: ${allInactive ? "YES" : "NO"}`);
  if (!allInactive) throw new Error("Refusing: some target rows are active.");

  const linked = target.filter((r) => r.master_place_id);
  const mpIds = [...new Set(linked.map((r) => r.master_place_id!))];
  console.log(`\n  linked source_records: ${linked.length}   distinct master_places: ${mpIds.length}`);

  // ── place_match rows that will cascade ──────────────────────────────────
  const srIds = target.map((r) => r.id);
  const pms: unknown[] = [];
  for (let i = 0; i < srIds.length; i += 100) {
    const r = await db.from("place_match").select("*").in("source_record_id", srIds.slice(i, i + 100));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("place_match read failed"); }
    pms.push(...r.data);
  }
  console.log(`  place_match rows that will CASCADE-delete: ${pms.length}`);

  // ── Full-row backup, TIMESTAMPED (never clobbers) ───────────────────────
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = join(BACKUP_DIR, `osm-waste-disposal-${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify({
    taken_at: new Date().toISOString(),
    project_ref: TEST_REF,
    note: "Full-row backup prior to hard delete. raw_payload carries the original OSM element (coords included), so rows are reconstructible via upsert_source_record.",
    source_records: target,
    place_matches: pms,
    affected_master_place_ids: mpIds,
  }, null, 2));
  console.log(`\n  backup written: ${backupFile}`);
  console.log(`    ${target.length} source_records + ${pms.length} place_match rows (full column set)`);

  if (!apply) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply.");
    return;
  }

  // ── DELETE ──────────────────────────────────────────────────────────────
  console.log("\ndeleting...");
  let deleted = 0;
  for (let i = 0; i < srIds.length; i += 100) {
    const batch = srIds.slice(i, i + 100);
    const d = await db.from("source_record").delete().in("id", batch).select("id");
    if (d.error || d.data == null) { console.log("DELETE FAILED:", JSON.stringify(d, null, 2)); throw new Error("delete failed"); }
    deleted += d.data.length;
  }
  console.log(`  deleted ${deleted} source_records`);

  // ── RECOMPUTE ───────────────────────────────────────────────────────────
  let recomputed = 0;
  const missingMps: string[] = [];
  for (const mpId of mpIds) {
    const r = await db.rpc("recompute_master_place", { p_master_place_id: mpId });
    if (r.error) {
      // A master_place may legitimately be gone/unreferenced; record, don't crash.
      console.log(`  recompute error on ${mpId}:`, JSON.stringify(r.error));
      missingMps.push(mpId);
      continue;
    }
    recomputed += 1;
  }
  console.log(`  recomputed ${recomputed}/${mpIds.length} master_places${missingMps.length ? ` (${missingMps.length} errored)` : ""}`);

  // ── VERIFY ──────────────────────────────────────────────────────────────
  const remaining = await pageAll<SrRow>((from) =>
    db.from("source_record").select("id, external_id, inferred_category, raw_payload")
      .eq("source_id", "osm").is("inferred_category", null)
      .order("id").range(from, from + page - 1),
  );
  const stillWaste = remaining.filter((r) => tagOf(r) === "waste_disposal").length;
  console.log(`\nAFTER:`);
  console.log(`  osm rows with NULL inferred_category: ${remaining.length}`);
  console.log(`  osm rows with amenity=waste_disposal (any category): ${stillWaste} (expected 0)`);

  const dump = await pageAll<SrRow>((from) =>
    db.from("source_record").select("id, external_id, is_active, raw_payload")
      .eq("source_id", "osm").eq("inferred_category", "dump_station")
      .order("id").range(from, from + page - 1),
  );
  console.log(`  genuine osm dump_station rows: ${dump.length} (expected 26), all sanitary_dump_station: ${dump.every((r) => tagOf(r) === "sanitary_dump_station")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
