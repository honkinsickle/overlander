/**
 * Reactivate the OSM viewpoint rows whose description is real content, per
 * "filter C" (`data/ingestion/lib/osm-viewpoint-content-filter.ts`).
 *
 * Scope — three disjoint groups, only the first moves:
 *   1. described AND passes filter C   -> REACTIVATED here
 *   2. described BUT junk              -> stays deactivated
 *   3. no description at all           -> stays deactivated, untouched
 *
 * Guards, all enforced rather than assumed: groups 2 and 3 are counted before
 * and after and must not move, as are fire_pit / gas_station / public_land /
 * peak / spring and the NPS viewpoint slice reactivated in 16738b6.
 *
 * TEST-only. Snapshot + paired undo, timestamped, never writes an empty set.
 *
 *   (default)  dry run   --apply   --undo
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  classifyViewpointDescription,
  passesViewpointContentFilter,
  type JunkReason,
} from "../ingestion/lib/osm-viewpoint-content-filter.ts";

const TEST_REF = "znldzjdatkogdktymtvi";
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "osm-viewpoint-snapshots");
const MUST_NOT_MOVE = ["fire_pit", "gas_station", "public_land", "peak", "spring"] as const;

type Row = {
  id: string;
  external_id: string;
  name: string;
  is_active: boolean;
  master_place_id: string | null;
  normalized_payload: { description?: unknown } | null;
};

const descOf = (r: Row): string | null => {
  const d = r.normalized_payload?.description;
  return typeof d === "string" && d.trim().length > 0 ? d.trim() : null;
};

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

  const guardBefore = new Map<string, number>();
  for (const c of MUST_NOT_MOVE) guardBefore.set(c, await activeCount(c));
  const npsViewpointBefore = await activeCount("viewpoint", "nps");

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

  // ── Partition the whole osm viewpoint population ──────────────────────
  const all: Row[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, external_id, name, is_active, master_place_id, normalized_payload")
      .eq("source_id", "osm").eq("inferred_category", "viewpoint").order("id").range(from, from + 999);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan"); }
    all.push(...(r.data as unknown as Row[]));
    if (r.data.length < 1000) break;
    from += 1000;
  }

  const described = all.filter((r) => descOf(r) !== null);
  const noDescription = all.filter((r) => descOf(r) === null);
  const survivors = described.filter((r) => passesViewpointContentFilter(descOf(r), r.name));
  const junk = described.filter((r) => !passesViewpointContentFilter(descOf(r), r.name));

  const byReason = new Map<JunkReason, number>();
  for (const r of junk) {
    const why = classifyViewpointDescription(descOf(r), r.name)!;
    byReason.set(why, (byReason.get(why) ?? 0) + 1);
  }

  console.log("OSM VIEWPOINT POPULATION — partitioned by filter C (re-derived now)");
  console.log(`  total osm viewpoint source_records : ${all.length}`);
  console.log(`  with a description                 : ${described.length}`);
  console.log(`    -> PASSES filter C (reactivate)  : ${survivors.length}`);
  console.log(`    -> junk (stays off)              : ${junk.length}   ${[...byReason.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  no description at all (stays off)  : ${noDescription.length}`);
  console.log(`  [partition check] ${survivors.length} + ${junk.length} + ${noDescription.length} = ${survivors.length + junk.length + noDescription.length} (must equal ${all.length}: ${survivors.length + junk.length + noDescription.length === all.length})`);

  const target = survivors.filter((r) => !r.is_active);
  const mpIds = [...new Set(target.map((r) => r.master_place_id).filter((x): x is string => !!x))];
  console.log(`\n  of the survivors, currently inactive (the write set): ${target.length}`);
  console.log(`  distinct master_places to recompute : ${mpIds.length}`);
  console.log(`  survivors with no master_place link : ${survivors.filter((r) => !r.master_place_id).length}`);

  const viewBefore = await db.from("master_place_search_export").select("*", { count: "exact", head: true });
  if (viewBefore.error || viewBefore.count == null) { console.log("QUERY FAILED:", JSON.stringify(viewBefore, null, 2)); throw new Error("view"); }
  console.log(`  master_place_search_export before   : ${viewBefore.count}`);

  if (!apply) { console.log("\nDRY RUN — nothing written."); return; }
  if (target.length === 0) { console.log("\nNothing to reactivate; snapshot NOT written."); return; }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = join(SNAPSHOT_DIR, `reactivate-osm-viewpoint-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
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

  // ── GUARDS ────────────────────────────────────────────────────────────
  console.log("\nGUARDS");
  let ok = true;
  const reread: Row[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, external_id, name, is_active, master_place_id, normalized_payload")
      .eq("source_id", "osm").eq("inferred_category", "viewpoint").order("id").range(from, from + 999);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("reread"); }
    reread.push(...(r.data as unknown as Row[]));
    if (r.data.length < 1000) break;
    from += 1000;
  }
  const junkIds = new Set(junk.map((r) => r.id));
  const noDescIds = new Set(noDescription.map((r) => r.id));
  const junkActiveAfter = reread.filter((r) => junkIds.has(r.id) && r.is_active).length;
  const noDescActiveAfter = reread.filter((r) => noDescIds.has(r.id) && r.is_active).length;
  const survivorsActiveAfter = reread.filter((r) => !junkIds.has(r.id) && !noDescIds.has(r.id) && r.is_active).length;
  console.log(`  osm viewpoint JUNK subset active      : ${junkActiveAfter}  (must be 0)`);
  console.log(`  osm viewpoint NO-DESCRIPTION active   : ${noDescActiveAfter}  (must be 0)`);
  console.log(`  osm viewpoint filter-C subset active  : ${survivorsActiveAfter} / ${survivors.length}`);
  if (junkActiveAfter !== 0 || noDescActiveAfter !== 0) ok = false;

  const npsAfter = await activeCount("viewpoint", "nps");
  console.log(`  nps viewpoint active ${npsViewpointBefore} -> ${npsAfter}   ${npsAfter === npsViewpointBefore ? "UNCHANGED" : "*** MOVED ***"}`);
  if (npsAfter !== npsViewpointBefore) ok = false;
  for (const c of MUST_NOT_MOVE) {
    const after = await activeCount(c);
    const before = guardBefore.get(c)!;
    if (after !== before) ok = false;
    console.log(`  ${c.padEnd(14)} active ${before} -> ${after}   ${after === before ? "UNCHANGED" : "*** MOVED ***"}`);
  }
  if (!ok) throw new Error("A guarded group moved — investigate.");

  const viewAfter = await db.from("master_place_search_export").select("*", { count: "exact", head: true });
  if (viewAfter.error || viewAfter.count == null) { console.log("QUERY FAILED:", JSON.stringify(viewAfter, null, 2)); throw new Error("view after"); }
  console.log(`\n  master_place_search_export ${viewBefore.count} -> ${viewAfter.count}  (delta ${viewAfter.count - viewBefore.count})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
