/**
 * Reclassify the stale `amenity=waste_disposal` rows out of `dump_station`.
 *
 * WHY. Pre-#202 the OSM adapter mapped `amenity=waste_disposal` (a municipal
 * trash bin) to `dump_station` (an RV sanitary station). #202 removed both the
 * mapping and the fetch predicate: today `inferCategory({amenity:
 * "waste_disposal"})` returns **null** and the row is skipped at ingest
 * (`data/ingestion/sources/osm.test.ts` asserts both). So the CODE is already
 * correct — what remains is stale rows ingested under the old mapping.
 *
 * WHAT THIS DOES. Re-derives `inferred_category` for the affected rows through
 * the CURRENT normalizer. For `amenity=waste_disposal` that derivation is
 * `null`, so the fix sets `inferred_category = null` — it does NOT invent a
 * substitute category and does NOT delete corpus rows. `inferred_category` is
 * nullable (`20260527120200_phase1_source_record.sql`) and
 * `recompute_aggregated_fields` already skips nulls, so this is a state the
 * schema and the recompute path both expect.
 *
 * Scope guard: only rows that are simultaneously `source_id='osm'`,
 * `inferred_category='dump_station'`, AND carry raw tag
 * `amenity=waste_disposal` are touched. Genuine `sanitary_dump_station` rows
 * are never in the update set.
 *
 * Every affected master_place is recomputed afterwards.
 *
 * TEST-only, and every write is paired with an undo that restores the exact
 * prior `inferred_category` from the snapshot.
 *
 * Modes:
 *   (default)  dry run — measure and snapshot, write nothing
 *   --apply    perform the update + recompute
 *   --undo     restore inferred_category from the snapshot file + recompute
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "reclassify-snapshots");
const SNAPSHOT_FILE = join(SNAPSHOT_DIR, "osm-waste-disposal-dump-station.json");

type SrRow = {
  id: string;
  external_id: string;
  inferred_category: string | null;
  is_active: boolean;
  master_place_id: string | null;
  raw_payload: { element?: { tags?: Record<string, string> } } | null;
};

type Snapshot = {
  taken_at: string;
  project_ref: string;
  rows: { id: string; external_id: string; prior_inferred_category: string | null; master_place_id: string | null }[];
  affected_master_place_ids: string[];
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}). This script is TEST-only.`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  if (apply && undo) throw new Error("--apply and --undo are mutually exclusive");
  const mode = undo ? "UNDO" : apply ? "APPLY" : "DRY RUN";
  console.log(`[env] TEST ${ref}   mode: ${mode}\n`);

  const page = 1000;
  async function pageAll<T>(build: (from: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
    const out: T[] = [];
    let from = 0;
    while (true) {
      const r = await build(from);
      if (r.error || r.data == null) {
        console.log("QUERY FAILED:", JSON.stringify(r, null, 2));
        throw new Error("query failed");
      }
      const rows = r.data as T[];
      out.push(...rows);
      if (rows.length < page) break;
      from += page;
    }
    return out;
  }

  // ── UNDO ────────────────────────────────────────────────────────────────
  if (undo) {
    if (!existsSync(SNAPSHOT_FILE)) throw new Error(`No snapshot at ${SNAPSHOT_FILE} — nothing to undo.`);
    const snap = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Snapshot;
    if (snap.project_ref !== TEST_REF) throw new Error(`Snapshot is for ${snap.project_ref}, not TEST.`);
    console.log(`restoring ${snap.rows.length} rows from snapshot taken ${snap.taken_at}`);
    let restored = 0;
    for (const row of snap.rows) {
      const r = await db.from("source_record").update({ inferred_category: row.prior_inferred_category }).eq("id", row.id);
      if (r.error) { console.log("UPDATE FAILED:", JSON.stringify(r, null, 2)); throw new Error("undo failed"); }
      restored += 1;
    }
    console.log(`restored ${restored}`);
    for (const mpId of snap.affected_master_place_ids) {
      const r = await db.rpc("recompute_master_place", { p_master_place_id: mpId });
      if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("recompute failed"); }
    }
    console.log(`recomputed ${snap.affected_master_place_ids.length} master_places`);
    return;
  }

  // ── BASELINE ────────────────────────────────────────────────────────────
  const all = await pageAll<SrRow>((from) =>
    db.from("source_record")
      .select("id, external_id, inferred_category, is_active, master_place_id, raw_payload")
      .eq("source_id", "osm").eq("inferred_category", "dump_station")
      .order("id").range(from, from + page - 1),
  );

  const tagOf = (r: SrRow) => r.raw_payload?.element?.tags?.amenity ?? "(no amenity tag)";
  const byTag = new Map<string, SrRow[]>();
  for (const r of all) {
    const t = tagOf(r);
    byTag.set(t, [...(byTag.get(t) ?? []), r]);
  }

  console.log("BEFORE — osm source_records with inferred_category='dump_station'");
  console.log(`  total: ${all.length}   (is_active true ${all.filter((r) => r.is_active).length} / false ${all.filter((r) => !r.is_active).length})`);
  for (const [t, rows] of [...byTag.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    amenity=${t.padEnd(24)} ${String(rows.length).padStart(4)}   linked to an MP: ${rows.filter((r) => r.master_place_id).length}`);
  }

  const target = byTag.get("waste_disposal") ?? [];
  const genuine = all.length - target.length;
  console.log(`\n  → to reclassify (amenity=waste_disposal): ${target.length}`);
  console.log(`  → genuine dump_station remaining after fix: ${genuine}`);

  const mpIds = [...new Set(target.map((r) => r.master_place_id).filter((x): x is string => !!x))];
  console.log(`  → distinct master_places to recompute: ${mpIds.length}`);

  // Snapshot BEFORE any write.
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapshot: Snapshot = {
    taken_at: new Date().toISOString(),
    project_ref: TEST_REF,
    rows: target.map((r) => ({ id: r.id, external_id: r.external_id, prior_inferred_category: r.inferred_category, master_place_id: r.master_place_id })),
    affected_master_place_ids: mpIds,
  };
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`\n  snapshot written: ${SNAPSHOT_FILE} (${snapshot.rows.length} rows)`);

  if (!apply) {
    console.log("\nDRY RUN — no writes performed. Re-run with --apply.");
    return;
  }

  // ── APPLY ───────────────────────────────────────────────────────────────
  console.log("\napplying...");
  let updated = 0;
  for (const r of target) {
    // Belt-and-braces: re-assert the raw tag at write time so the update set
    // cannot drift from the measured set.
    if (tagOf(r) !== "waste_disposal") throw new Error(`refusing: ${r.external_id} is not waste_disposal`);
    const u = await db.from("source_record").update({ inferred_category: null }).eq("id", r.id).eq("inferred_category", "dump_station");
    if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("update failed"); }
    updated += 1;
  }
  console.log(`  updated ${updated} source_records → inferred_category = null`);

  let recomputed = 0;
  for (const mpId of mpIds) {
    const r = await db.rpc("recompute_master_place", { p_master_place_id: mpId });
    if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("recompute failed"); }
    recomputed += 1;
  }
  console.log(`  recomputed ${recomputed} master_places`);

  // ── AFTER ───────────────────────────────────────────────────────────────
  const after = await pageAll<SrRow>((from) =>
    db.from("source_record")
      .select("id, external_id, inferred_category, is_active, master_place_id, raw_payload")
      .eq("source_id", "osm").eq("inferred_category", "dump_station")
      .order("id").range(from, from + page - 1),
  );
  const stillContaminated = after.filter((r) => tagOf(r) === "waste_disposal").length;
  console.log(`\nAFTER — osm dump_station source_records: ${after.length}`);
  console.log(`  still carrying amenity=waste_disposal: ${stillContaminated} (expected 0)`);
  console.log(`  is_active true ${after.filter((r) => r.is_active).length} / false ${after.filter((r) => !r.is_active).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
