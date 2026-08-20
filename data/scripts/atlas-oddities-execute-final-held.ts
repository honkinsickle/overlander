/**
 * Final-pass held rows: General Grant → reject, Buck Rock → approve.
 * Verifies by pm-id (Eagle Rock lesson).
 */
import { getDb } from "../ingestion/lib/db.ts";

const OPS: Array<{ pm_id: string; expected_ao: string; action: "reject" | "approve"; resolved_by: string }> = [
  {
    pm_id: "8b843bf2-8cfc-4495-af38-25a64674ab0f",
    expected_ao: "General Grant",
    action: "reject",
    resolved_by: "triage:3A-held:v1",
  },
  {
    pm_id: "d655a17d-f058-413b-a5d6-e560823bc499",
    expected_ao: "Buck Rock",
    action: "approve",
    resolved_by: "triage:3A-held:v1",
  },
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

  const results: Array<{ op: typeof OPS[number]; sr_id: string; original_target: string; expected_final: string | null; err: string | null }> = [];

  for (const op of OPS) {
    const cur = await db
      .from("place_match")
      .select(`
        id, status, source_record_id, master_place_id,
        source_record!inner (id, name),
        master_place!inner (id, canonical_name, primary_category)
      `)
      .eq("id", op.pm_id)
      .maybeSingle();
    if (cur.error || !cur.data) {
      console.log(`  SKIP ${op.expected_ao}: ${cur.error?.message ?? "row missing"}`);
      results.push({ op, sr_id: "", original_target: "", expected_final: null, err: cur.error?.message ?? "row missing" });
      continue;
    }
    const pm: any = cur.data;
    if (pm.source_record.name !== op.expected_ao) {
      console.log(`  WARN pm=${op.pm_id}: expected ao='${op.expected_ao}' but SR is '${pm.source_record.name}'`);
    }
    if (pm.status !== "pending") {
      console.log(`  SKIP already ${pm.status}: pm=${op.pm_id}`);
      results.push({ op, sr_id: pm.source_record_id, original_target: pm.master_place_id, expected_final: null, err: `not pending: ${pm.status}` });
      continue;
    }
    const label = `pm=${op.pm_id}  ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}' (${pm.master_place.primary_category})`;
    if (op.action === "approve") {
      console.log(`  APPROVING ${label}`);
      const rpc = await db.rpc("resolve_place_match", { p_place_match_id: op.pm_id, p_resolved_by: op.resolved_by });
      if (rpc.error) {
        console.log(`    ERROR: ${rpc.error.message}`);
        results.push({ op, sr_id: pm.source_record_id, original_target: pm.master_place_id, expected_final: null, err: rpc.error.message });
      } else {
        results.push({ op, sr_id: pm.source_record_id, original_target: pm.master_place_id, expected_final: pm.master_place_id, err: null });
      }
    } else {
      console.log(`  REJECTING ${label}`);
      const rpc = await db.rpc("reject_place_match_to_new_master_place", { p_place_match_id: op.pm_id, p_resolved_by: op.resolved_by });
      if (rpc.error) {
        console.log(`    ERROR: ${rpc.error.message}`);
        results.push({ op, sr_id: pm.source_record_id, original_target: pm.master_place_id, expected_final: null, err: rpc.error.message });
      } else {
        const newMp = (rpc.data as any)?.new_master_place_id ?? null;
        console.log(`    new_mp=${newMp}`);
        results.push({ op, sr_id: pm.source_record_id, original_target: pm.master_place_id, expected_final: newMp, err: null });
      }
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
  const q = await db.from("source_record").select("id, master_place_id").in("id", okRows.map((r) => r.sr_id));
  const byId = new Map<string, string | null>();
  for (const row of q.data ?? []) byId.set(row.id, row.master_place_id);
  for (const r of okRows) {
    const actual = byId.get(r.sr_id) ?? null;
    const ok = actual === r.expected_final;
    const regressed = r.op.action === "reject" && actual === r.original_target;
    console.log(`  ${ok ? "OK " : "!! "} pm=${r.op.pm_id}  ao='${r.op.expected_ao}'  sr.mp=${actual}  expected=${r.expected_final}  ${regressed ? "STILL LINKED TO ORIGINAL TARGET" : ""}`);
  }

  const errs = results.filter((r) => r.err !== null);
  if (errs.length > 0) {
    console.log(`\nFAILURES:`);
    for (const e of errs) console.log(`  pm=${e.op.pm_id}: ${e.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("final-held: fatal", err);
  process.exit(1);
});
