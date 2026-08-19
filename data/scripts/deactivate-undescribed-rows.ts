/**
 * Partial deactivation: within toilet / water / dump_station, keep ONLY the rows
 * that actually carry a description live. Deactivate the description-less
 * remainder.
 *
 * "Has a description" = `normalized_payload.description` is a non-empty string.
 * That covers BOTH a real original OSM `description`/`note` tag and a generated
 * template sentence — either counts, per the decision.
 *
 * This is a TARGETED partial deactivation, not a category toggle: rows WITH a
 * description are never touched, and the three categories keep a live subset.
 *
 * Guards, all enforced rather than assumed:
 *   - only source_id='osm' AND inferred_category IN the three AND is_active=true
 *     AND description empty/absent are eligible;
 *   - the described subset's active count is captured before and re-checked
 *     after, and must be unchanged;
 *   - the four categories from 47e00e4 that must stay at 0 active
 *     (viewpoint, fire_pit, gas_station, public_land) are counted before and
 *     after and must not move.
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
const TARGET = ["toilet", "water", "dump_station"] as const;
const MUST_NOT_MOVE = ["viewpoint", "fire_pit", "gas_station", "public_land"] as const;
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "partial-deactivation-snapshots");

type Row = {
  id: string;
  external_id: string;
  inferred_category: string;
  is_active: boolean;
  master_place_id: string | null;
  normalized_payload: { description?: unknown } | null;
};

const described = (r: Row) =>
  typeof r.normalized_payload?.description === "string" &&
  (r.normalized_payload.description as string).trim().length > 0;

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
  async function scan(cat: string): Promise<Row[]> {
    const out: Row[] = [];
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("id, external_id, inferred_category, is_active, master_place_id, normalized_payload")
        .eq("source_id", "osm").eq("inferred_category", cat).order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan ${cat}`); }
      out.push(...(r.data as unknown as Row[]));
      if (r.data.length < page) break;
      from += page;
    }
    return out;
  }

  const guardBefore = new Map<string, number>();
  for (const c of MUST_NOT_MOVE) guardBefore.set(c, await activeCount(c));

  // ── UNDO ──────────────────────────────────────────────────────────────
  if (undo) {
    const files = existsSync(SNAPSHOT_DIR) ? readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json")).sort() : [];
    const newest = files.at(-1);
    if (!newest) throw new Error("No snapshot to undo from.");
    const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, newest), "utf8")) as {
      project_ref: string; rows: { id: string; prior_is_active: boolean }[]; affected_master_place_ids: string[];
    };
    if (snap.project_ref !== TEST_REF) throw new Error("Snapshot is not TEST.");
    const ids = snap.rows.filter((r) => r.prior_is_active === true).map((r) => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const u = await db.from("source_record").update({ is_active: true }).in("id", ids.slice(i, i + 100));
      if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("undo write"); }
    }
    for (const mp of snap.affected_master_place_ids) {
      const r = await db.rpc("recompute_master_place", { p_master_place_id: mp });
      if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("undo recompute"); }
    }
    console.log(`restored ${ids.length} rows to active, recomputed ${snap.affected_master_place_ids.length} master_places (from ${newest})`);
    return;
  }

  // ── MEASURE ───────────────────────────────────────────────────────────
  const all = new Map<string, Row[]>();
  for (const cat of TARGET) all.set(cat, await scan(cat));

  console.log("FRESH SPLIT — measured now, per category\n");
  console.log("  category        total   active   WITH desc   WITHOUT desc (-> deactivate)");
  const target: Row[] = [];
  const describedActiveBefore = new Map<string, number>();
  for (const cat of TARGET) {
    const rows = all.get(cat)!;
    const active = rows.filter((r) => r.is_active);
    const withD = active.filter(described);
    const withoutD = active.filter((r) => !described(r));
    describedActiveBefore.set(cat, withD.length);
    target.push(...withoutD);
    console.log(`  ${cat.padEnd(14)} ${String(rows.length).padStart(6)} ${String(active.length).padStart(8)} ${String(withD.length).padStart(11)} ${String(withoutD.length).padStart(15)}`);
  }
  console.log(`\n  TOTAL to deactivate: ${target.length}`);
  console.log(`  TOTAL staying live : ${[...describedActiveBefore.values()].reduce((a, b) => a + b, 0)}`);

  const mpIds = [...new Set(target.map((r) => r.master_place_id).filter((x): x is string => !!x))];
  console.log(`  distinct master_places to recompute: ${mpIds.length}`);
  console.log(`  target rows with no master_place link: ${target.filter((r) => !r.master_place_id).length}`);

  // View count of the three categories before.
  let viewBefore = 0;
  for (const cat of TARGET) {
    const r = await db.from("master_place_search_export").select("*", { count: "exact", head: true }).eq("primary_category", cat);
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("view before"); }
    viewBefore += r.count;
    console.log(`  view rows ${cat.padEnd(14)} before: ${r.count}`);
  }
  const totalViewBefore = await db.from("master_place_search_export").select("*", { count: "exact", head: true });
  if (totalViewBefore.error || totalViewBefore.count == null) { console.log("QUERY FAILED:", JSON.stringify(totalViewBefore, null, 2)); throw new Error("view total"); }
  console.log(`  master_place_search_export TOTAL before: ${totalViewBefore.count}`);

  if (!apply) { console.log("\nDRY RUN — nothing written."); return; }
  if (target.length === 0) { console.log("\nNothing to deactivate; snapshot NOT written."); return; }

  // ── APPLY ─────────────────────────────────────────────────────────────
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = join(SNAPSHOT_DIR, `deactivate-undescribed-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({
    taken_at: new Date().toISOString(), project_ref: TEST_REF,
    rows: target.map((r) => ({ id: r.id, external_id: r.external_id, inferred_category: r.inferred_category, prior_is_active: r.is_active })),
    affected_master_place_ids: mpIds,
  }, null, 2));
  console.log(`\nsnapshot: ${file} (${target.length} rows)`);

  let flipped = 0;
  const ids = target.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    // Re-assert the predicate at write time so the set cannot drift.
    const u = await db.from("source_record").update({ is_active: false })
      .in("id", ids.slice(i, i + 100)).eq("is_active", true).select("id");
    if (u.error || u.data == null) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("write failed"); }
    flipped += u.data.length;
  }
  console.log(`  set is_active=false on ${flipped} source_records`);

  let recomputed = 0;
  for (const mp of mpIds) {
    const r = await db.rpc("recompute_master_place", { p_master_place_id: mp });
    if (r.error) { console.log("RECOMPUTE FAILED:", JSON.stringify(r, null, 2)); throw new Error("recompute failed"); }
    recomputed += 1;
  }
  console.log(`  recomputed ${recomputed} master_places`);

  // ── VERIFY ────────────────────────────────────────────────────────────
  console.log("\nAFTER:");
  for (const cat of TARGET) {
    const rows = await scan(cat);
    const active = rows.filter((r) => r.is_active);
    const activeDescribed = active.filter(described).length;
    const activeUndescribed = active.filter((r) => !described(r)).length;
    const ok = activeDescribed === describedActiveBefore.get(cat) && activeUndescribed === 0;
    console.log(`  ${cat.padEnd(14)} active ${String(active.length).padStart(5)}  (described ${activeDescribed}, undescribed ${activeUndescribed})  described-count unchanged: ${ok ? "YES" : "*** NO ***"}`);
    if (!ok) throw new Error(`${cat}: described subset changed or undescribed rows remain active`);
  }

  console.log("\nGUARD — categories that must NOT move:");
  let guardOk = true;
  for (const c of MUST_NOT_MOVE) {
    const after = await activeCount(c);
    const before = guardBefore.get(c)!;
    if (after !== before) guardOk = false;
    console.log(`  ${c.padEnd(14)} active ${before} -> ${after}   ${after === before ? "UNCHANGED" : "*** MOVED ***"}`);
  }
  if (!guardOk) throw new Error("A category that must not move changed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
