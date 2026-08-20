/**
 * Final-pass reject: 6 explicit pm-ids Adam picked as different-entity from
 * the 3.C/3.E dump (5 in shape C, 1 in shape E). Uses
 * reject_place_match_to_new_master_place, verifies each SR lands on its
 * newly-minted MP by pm-id lookup (Eagle Rock lesson).
 */
import { getDb } from "../ingestion/lib/db.ts";

const RESOLVED_BY = "triage:3CE-reject:v1";

const REJECTS: Array<{ pm_id: string; expected_ao: string }> = [
  { pm_id: "e18502a1-7750-46e4-a010-7068ba20e8e7", expected_ao: "Grapevine Canyon Petroglyphs" },
  { pm_id: "d4aadc40-2963-4df3-a92f-2693666d34c7", expected_ao: "Woodstock Mystery Hole" },
  { pm_id: "c8d7a59b-fa99-4758-b1a7-9076d02e7496", expected_ao: "Malakoff Diggins" },
  { pm_id: "c12f628c-e0e8-40c0-9c2e-6605d957eab0", expected_ao: "Hotaling Whiskey Warehouse" },
  { pm_id: "aeae190e-dadb-4f73-b2f0-902b78c12175", expected_ao: "John Muir's Giant Sequoia" },
  { pm_id: "bd54135b-9d19-4129-b6de-26c0a479eba3", expected_ao: "Lick Observatory" },
];

async function countAtlasByStatus(status: "pending" | "confirmed" | "rejected"): Promise<number> {
  const db = getDb();
  const r = await db
    .from("place_match")
    .select("id, source_record!inner(source_id)", { count: "exact", head: true })
    .eq("status", status)
    .eq("source_record.source_id", "atlas_oddities");
  if (r.error || r.count == null) {
    console.error(`QUERY FAILED atlas ${status}:`, r);
    process.exit(1);
  }
  return r.count;
}

async function totalMasterPlaces(): Promise<number> {
  const db = getDb();
  const r = await db.from("master_place").select("id", { count: "exact", head: true });
  if (r.error || r.count == null) {
    console.error("QUERY FAILED mp total:", r);
    process.exit(1);
  }
  return r.count;
}

async function main() {
  const db = getDb();

  const pendingBefore = await countAtlasByStatus("pending");
  const confirmedBefore = await countAtlasByStatus("confirmed");
  const rejectedBefore = await countAtlasByStatus("rejected");
  const mpBefore = await totalMasterPlaces();
  console.log(`BEFORE: pending=${pendingBefore}  confirmed=${confirmedBefore}  rejected=${rejectedBefore}  master_place=${mpBefore}`);

  const results: Array<{ pm_id: string; sr_id: string; original_target: string; new_mp: string | null; err: string | null }> = [];
  for (const r of REJECTS) {
    const cur = await db
      .from("place_match")
      .select(`
        id, status, source_record_id, master_place_id,
        source_record!inner (id, name),
        master_place!inner (id, canonical_name, primary_category)
      `)
      .eq("id", r.pm_id)
      .maybeSingle();
    if (cur.error || !cur.data) {
      console.log(`  SKIP ${r.expected_ao}: ${cur.error?.message ?? "row missing"}`);
      results.push({ pm_id: r.pm_id, sr_id: "", original_target: "", new_mp: null, err: cur.error?.message ?? "row missing" });
      continue;
    }
    const pm: any = cur.data;
    // Guard: the SR name at pm should match Adam's list — surface any drift.
    if (pm.source_record.name !== r.expected_ao) {
      console.log(`  WARN pm=${r.pm_id}: expected ao='${r.expected_ao}' but SR is '${pm.source_record.name}'`);
    }
    if (pm.status !== "pending") {
      console.log(`  SKIP already ${pm.status}: pm=${r.pm_id}  ao='${pm.source_record.name}'`);
      results.push({ pm_id: r.pm_id, sr_id: pm.source_record_id, original_target: pm.master_place_id, new_mp: null, err: `not pending: ${pm.status}` });
      continue;
    }
    console.log(`  REJECTING pm=${r.pm_id}  ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}' (${pm.master_place.primary_category})`);
    const rpc = await db.rpc("reject_place_match_to_new_master_place", {
      p_place_match_id: r.pm_id,
      p_resolved_by: RESOLVED_BY,
    });
    if (rpc.error) {
      console.log(`    ERROR: ${rpc.error.message}`);
      results.push({ pm_id: r.pm_id, sr_id: pm.source_record_id, original_target: pm.master_place_id, new_mp: null, err: rpc.error.message });
    } else {
      const newMp = (rpc.data as any)?.new_master_place_id ?? null;
      console.log(`    new_mp=${newMp}`);
      results.push({ pm_id: r.pm_id, sr_id: pm.source_record_id, original_target: pm.master_place_id, new_mp: newMp, err: null });
    }
  }

  const pendingAfter = await countAtlasByStatus("pending");
  const confirmedAfter = await countAtlasByStatus("confirmed");
  const rejectedAfter = await countAtlasByStatus("rejected");
  const mpAfter = await totalMasterPlaces();
  console.log(`\nAFTER:  pending=${pendingAfter}  confirmed=${confirmedAfter}  rejected=${rejectedAfter}  master_place=${mpAfter}`);
  console.log(`DELTA:  pending ${pendingBefore - pendingAfter}  |  confirmed +${confirmedAfter - confirmedBefore}  |  rejected +${rejectedAfter - rejectedBefore}  |  master_place +${mpAfter - mpBefore}`);

  console.log(`\nVerify SR.master_place_id by pm-id:`);
  const okRows = results.filter((r) => r.err === null);
  const srIds = okRows.map((r) => r.sr_id);
  const q = await db.from("source_record").select("id, master_place_id").in("id", srIds);
  if (q.error) {
    console.error("verify failed:", q.error);
    process.exit(1);
  }
  const byId = new Map<string, string | null>();
  for (const row of q.data ?? []) byId.set(row.id, row.master_place_id);
  for (const r of okRows) {
    const actual = byId.get(r.sr_id) ?? null;
    const ok = actual === r.new_mp;
    const regressed = actual === r.original_target;
    console.log(`  ${ok ? "OK " : "!! "} pm=${r.pm_id}  sr.mp=${actual}  new_mp=${r.new_mp}  ${regressed ? "STILL LINKED TO ORIGINAL TARGET" : ""}`);
  }

  const errs = results.filter((r) => r.err !== null);
  if (errs.length > 0) {
    console.log(`\nFAILURES:`);
    for (const e of errs) console.log(`  pm=${e.pm_id}: ${e.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("final-rejects: fatal", err);
  process.exit(1);
});
