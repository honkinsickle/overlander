/**
 * Reactivate the NPS-sourced viewpoint source_records.
 *
 * The viewpoint category was deactivated wholesale in 47e00e4 on a sparseness
 * verdict that fits the OSM half only: measured 2026-08-19, nps viewpoint is
 * 231/231 described (100%) against osm viewpoint at 202/6,470 (3.1%). This
 * restores the NPS slice and leaves OSM viewpoint off.
 *
 * Scope guards, all enforced rather than assumed:
 *   - only source_id='nps' AND inferred_category='viewpoint' AND is_active=false;
 *   - osm viewpoint active count is captured before and after and MUST NOT move;
 *   - fire_pit / gas_station / public_land likewise must stay at 0 active.
 *
 * The unlinked NPS viewpoint rows are reactivated along with the rest (they are
 * part of the same source set) but restore nothing on their own — they carry no
 * master_place and would need materialization. Out of scope here, counted only.
 *
 * TEST-only. Snapshot + paired undo, timestamped, never writes an empty set.
 *
 *   (default)  dry run   --apply   --undo
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "nps-viewpoint-snapshots");
const MUST_NOT_MOVE = ["fire_pit", "gas_station", "public_land"] as const;

type Row = { id: string; external_id: string; is_active: boolean; master_place_id: string | null };

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  console.log(`[env] TEST ${ref}   mode: ${undo ? "UNDO" : apply ? "APPLY" : "DRY RUN"}\n`);

  async function activeCount(cat: string, source?: string): Promise<number> {
    let q = db.from("source_record").select("*", { count: "exact", head: true })
      .eq("inferred_category", cat).eq("is_active", true);
    if (source) q = q.eq("source_id", source);
    const r = await q;
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${cat}`); }
    return r.count;
  }

  // Guard baselines.
  const osmViewpointBefore = await activeCount("viewpoint", "osm");
  const guardBefore = new Map<string, number>();
  for (const c of MUST_NOT_MOVE) guardBefore.set(c, await activeCount(c));

  if (undo) {
    const files = existsSync(SNAPSHOT_DIR) ? readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json")).sort() : [];
    const newest = files.at(-1);
    if (!newest) throw new Error("No snapshot to undo from.");
    const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, newest), "utf8")) as {
      project_ref: string; rows: { id: string; prior_is_active: boolean }[]; affected_master_place_ids: string[];
    };
    if (snap.project_ref !== TEST_REF) throw new Error("Snapshot is not TEST.");
    const ids = snap.rows.filter((r) => r.prior_is_active === false).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const u = await db.from("source_record").update({ is_active: false }).in("id", ids.slice(i, i + 100));
      if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("undo write"); }
    }
    for (const mp of snap.affected_master_place_ids) {
      const r = await db.rpc("recompute_master_place", { p_master_place_id: mp });
      if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("undo recompute"); }
    }
    console.log(`restored ${ids.length} rows to inactive, recomputed ${snap.affected_master_place_ids.length} master_places (from ${newest})`);
    return;
  }

  // Target set.
  const target: Row[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record").select("id, external_id, is_active, master_place_id")
      .eq("source_id", "nps").eq("inferred_category", "viewpoint").eq("is_active", false)
      .order("id").range(from, from + 999);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan"); }
    target.push(...(r.data as unknown as Row[]));
    if (r.data.length < 1000) break;
    from += 1000;
  }

  const linked = target.filter((r) => r.master_place_id);
  const mpIds = [...new Set(linked.map((r) => r.master_place_id!))];

  console.log("TARGET SET (nps, viewpoint, is_active=false)");
  console.log(`  source_records to reactivate : ${target.length}`);
  console.log(`  linked to a master_place     : ${linked.length}`);
  console.log(`  distinct master_places       : ${mpIds.length}`);
  console.log(`  UNLINKED (restore nothing on their own; out of scope): ${target.length - linked.length}`);
  console.log(`\n  osm viewpoint active (must stay ${osmViewpointBefore}): ${osmViewpointBefore}`);

  const viewBefore = await db.from("master_place_search_export").select("*", { count: "exact", head: true });
  if (viewBefore.error || viewBefore.count == null) { console.log("QUERY FAILED:", JSON.stringify(viewBefore, null, 2)); throw new Error("view"); }
  console.log(`  master_place_search_export before: ${viewBefore.count}`);

  if (!apply) { console.log("\nDRY RUN — nothing written."); return; }
  if (target.length === 0) { console.log("\nNothing to reactivate; snapshot NOT written."); return; }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = join(SNAPSHOT_DIR, `reactivate-nps-viewpoint-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({
    taken_at: new Date().toISOString(), project_ref: TEST_REF,
    rows: target.map((r) => ({ id: r.id, external_id: r.external_id, prior_is_active: r.is_active })),
    affected_master_place_ids: mpIds,
  }, null, 2));
  console.log(`\nsnapshot: ${file} (${target.length} rows)`);

  let flipped = 0;
  const ids = target.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const u = await db.from("source_record").update({ is_active: true })
      .in("id", ids.slice(i, i + 100)).eq("is_active", false).select("id");
    if (u.error || u.data == null) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("write failed"); }
    flipped += u.data.length;
  }
  console.log(`  set is_active=true on ${flipped} source_records`);

  let recomputed = 0;
  for (const mp of mpIds) {
    const r = await db.rpc("recompute_master_place", { p_master_place_id: mp });
    if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("recompute failed"); }
    recomputed += 1;
  }
  console.log(`  recomputed ${recomputed} master_places`);

  console.log("\nGUARDS:");
  const osmAfter = await activeCount("viewpoint", "osm");
  console.log(`  osm viewpoint active ${osmViewpointBefore} -> ${osmAfter}   ${osmAfter === osmViewpointBefore ? "UNCHANGED" : "*** MOVED ***"}`);
  let ok = osmAfter === osmViewpointBefore;
  for (const c of MUST_NOT_MOVE) {
    const after = await activeCount(c);
    const before = guardBefore.get(c)!;
    if (after !== before) ok = false;
    console.log(`  ${c.padEnd(14)} active ${before} -> ${after}   ${after === before ? "UNCHANGED" : "*** MOVED ***"}`);
  }
  if (!ok) throw new Error("A guarded category moved — investigate.");

  const viewAfter = await db.from("master_place_search_export").select("*", { count: "exact", head: true });
  if (viewAfter.error || viewAfter.count == null) { console.log("QUERY FAILED:", JSON.stringify(viewAfter, null, 2)); throw new Error("view after"); }
  console.log(`\n  master_place_search_export ${viewBefore.count} -> ${viewAfter.count}  (delta ${viewAfter.count - viewBefore.count})`);
  console.log(`  nps viewpoint active now: ${await activeCount("viewpoint", "nps")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
