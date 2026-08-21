/**
 * Reactivate the toilet / water / dump_station source_records deactivated by
 * commit 47e00e4, now that templated descriptions exist for a subset of them.
 *
 * Scope guards (all enforced, not assumed):
 *   - source_id = 'osm' AND inferred_category IN (toilet, water, dump_station)
 *     AND is_active = false. Measured beforehand: every row in these three
 *     categories is osm-sourced, so this is exactly the set 47e00e4 turned off.
 *   - The other four categories 47e00e4 touched (viewpoint, fire_pit,
 *     gas_station, public_land) are counted before and after and must not move.
 *
 * Recomputes every affected master_place afterwards.
 *
 * TEST-only. Snapshot + paired undo. Snapshots are timestamped and an empty set
 * is never written.
 *
 *   (default)  dry run   --apply   --undo
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";
const REACTIVATE = ["toilet", "water", "dump_station"] as const;
const MUST_NOT_MOVE = ["viewpoint", "fire_pit", "gas_station", "public_land"] as const;
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "reactivation-snapshots");

type Row = { id: string; external_id: string; inferred_category: string; is_active: boolean; master_place_id: string | null };

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  console.log(`[env] TEST ${ref}   mode: ${undo ? "UNDO" : apply ? "APPLY" : "DRY RUN"}\n`);

  const page = 1000;
  async function activeCount(cat: string): Promise<number> {
    const r = await db.from("source_record").select("*", { count: "exact", head: true })
      .eq("inferred_category", cat).eq("is_active", true);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`count ${cat}`); }
    return r.count;
  }

  // Guard baseline: the four categories that must not move.
  const guardBefore = new Map<string, number>();
  for (const c of MUST_NOT_MOVE) guardBefore.set(c, await activeCount(c));

  if (undo) {
    const files = existsSync(SNAPSHOT_DIR) ? readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json")).sort() : [];
    const newest = files.at(-1);
    if (!newest) throw new Error("No reactivation snapshot to undo from.");
    const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, newest), "utf8")) as {
      project_ref: string; rows: { id: string; prior_is_active: boolean }[]; affected_master_place_ids: string[];
    };
    if (snap.project_ref !== TEST_REF) throw new Error("Snapshot is not TEST.");
    for (let i = 0; i < snap.rows.length; i += 100) {
      const batch = snap.rows.slice(i, i + 100).filter((r) => r.prior_is_active === false).map((r) => r.id);
      if (batch.length === 0) continue;
      const u = await db.from("source_record").update({ is_active: false }).in("id", batch);
      if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("undo write"); }
    }
    for (const mp of snap.affected_master_place_ids) {
      const r = await db.rpc("recompute_master_place", { p_master_place_id: mp });
      if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("undo recompute"); }
    }
    console.log(`restored ${snap.rows.length} rows, recomputed ${snap.affected_master_place_ids.length} master_places (from ${newest})`);
    return;
  }

  // Target set.
  const target: Row[] = [];
  for (const cat of REACTIVATE) {
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("id, external_id, inferred_category, is_active, master_place_id")
        .eq("source_id", "osm").eq("inferred_category", cat).eq("is_active", false)
        .order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan ${cat}`); }
      target.push(...(r.data as unknown as Row[]));
      if (r.data.length < page) break;
      from += page;
    }
  }

  // Guard: nothing outside osm in these categories should be left behind.
  const nonOsm = await db.from("source_record").select("*", { count: "exact", head: true })
    .in("inferred_category", REACTIVATE as unknown as string[]).neq("source_id", "osm");
  if (nonOsm.error || nonOsm.count == null) { console.log("QUERY FAILED:", JSON.stringify(nonOsm, null, 2)); throw new Error("non-osm count"); }

  const byCat = new Map<string, number>();
  for (const r of target) byCat.set(r.inferred_category, (byCat.get(r.inferred_category) ?? 0) + 1);
  const mpIds = [...new Set(target.map((r) => r.master_place_id).filter((x): x is string => !!x))];

  console.log("TARGET SET (osm, is_active=false, in the three categories)");
  for (const [c, n] of byCat) console.log(`  ${c.padEnd(14)} ${n}`);
  console.log(`  total: ${target.length}`);
  console.log(`  non-osm rows in these categories (left untouched by design): ${nonOsm.count}`);
  console.log(`  distinct master_places to recompute: ${mpIds.length}`);
  console.log(`  rows with no master_place link: ${target.filter((r) => !r.master_place_id).length}`);

  if (!apply) { console.log("\nDRY RUN — nothing written."); return; }
  if (target.length === 0) { console.log("\nNothing to reactivate; snapshot NOT written."); return; }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = join(SNAPSHOT_DIR, `reactivate-templated-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({
    taken_at: new Date().toISOString(), project_ref: TEST_REF,
    rows: target.map((r) => ({ id: r.id, external_id: r.external_id, inferred_category: r.inferred_category, prior_is_active: r.is_active })),
    affected_master_place_ids: mpIds,
  }, null, 2));
  console.log(`\nsnapshot: ${file} (${target.length} rows)`);

  console.log("reactivating...");
  let flipped = 0;
  const ids = target.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const u = await db.from("source_record").update({ is_active: true }).in("id", batch).select("id");
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

  console.log("\nGUARD — the four categories that must NOT move:");
  let guardOk = true;
  for (const c of MUST_NOT_MOVE) {
    const after = await activeCount(c);
    const before = guardBefore.get(c)!;
    const ok = after === before;
    if (!ok) guardOk = false;
    console.log(`  ${c.padEnd(14)} active before ${before} -> after ${after}   ${ok ? "UNCHANGED" : "*** MOVED ***"}`);
  }
  if (!guardOk) throw new Error("A category that must not move changed — investigate.");
}

main().catch((e) => { console.error(e); process.exit(1); });
