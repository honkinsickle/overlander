/**
 * Bucket 2 executor: reject the 8 likely_distinct pending place_match rows
 * (original 9 minus Mark Twain Stump, moved to likely_same). Each AO
 * source_record becomes its own new_master_place via
 * `reject_place_match_to_new_master_place`.
 *
 * Snapshot before/after:
 *   - atlas_oddities pending place_match count (drops by 8)
 *   - atlas_oddities rejected place_match count (rises by 8)
 *   - master_place total (rises by 8 — one new MP per row)
 *   - each of the 8 SR ends up linked to a NEW mp (verified: not the
 *     original target, no re-linkage to any other existing MP)
 */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

const RESOLVED_BY = "triage:likely_distinct:v1";

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

  // Load bucket 2 rows from the triage JSONL, EXCLUDING Mark Twain Stump (moved to bucket 1).
  const path = "/tmp/ao-triage-149.jsonl";
  const all = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  const rows = all.filter((r) => r.bucket === "likely_distinct" && r.ao_name !== "Mark Twain Stump");
  if (rows.length !== 8) {
    throw new Error(`expected 8 likely_distinct rows after MTS exclusion, got ${rows.length}`);
  }
  console.log(`Loaded ${rows.length} rows to reject.`);

  const pendingBefore = await countAtlasByStatus("pending");
  const rejectedBefore = await countAtlasByStatus("rejected");
  const confirmedBefore = await countAtlasByStatus("confirmed");
  const mpBefore = await totalMasterPlaces();
  console.log(`\nBEFORE: atlas pending=${pendingBefore}  confirmed=${confirmedBefore}  rejected=${rejectedBefore}  master_place=${mpBefore}`);

  // For each row: re-fetch current state, print visible target, then call
  // the reject RPC. Capture the returned new_master_place_id so we can
  // verify the SR ends up linked to it (not to something else).
  const results: Array<{ ao: string; target_mp: string; new_mp: string | null; err: string | null }> = [];
  for (const r of rows) {
    const cur = await db
      .from("place_match")
      .select(`
        id, status,
        source_record!inner (id, external_id, name),
        master_place!inner (id, canonical_name, primary_category)
      `)
      .eq("id", r.place_match_id)
      .maybeSingle();
    if (cur.error || !cur.data) {
      const msg = cur.error?.message ?? "row missing";
      console.log(`  SKIP ${r.ao_name}: ${msg}`);
      results.push({ ao: r.ao_name, target_mp: r.master_place_id, new_mp: null, err: msg });
      continue;
    }
    const pm: any = cur.data;
    if (pm.status !== "pending") {
      console.log(`  SKIP already ${pm.status}: ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}'`);
      results.push({ ao: r.ao_name, target_mp: r.master_place_id, new_mp: null, err: `not pending: ${pm.status}` });
      continue;
    }
    console.log(`  REJECTING pm=${r.place_match_id}  ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}' (${pm.master_place.primary_category})`);
    const rpc = await db.rpc("reject_place_match_to_new_master_place", {
      p_place_match_id: r.place_match_id,
      p_resolved_by: RESOLVED_BY,
    });
    if (rpc.error) {
      console.log(`    ERROR: ${rpc.error.message}`);
      results.push({ ao: r.ao_name, target_mp: r.master_place_id, new_mp: null, err: rpc.error.message });
    } else {
      const newMp = (rpc.data as any)?.new_master_place_id ?? null;
      console.log(`    new_mp=${newMp}`);
      results.push({ ao: r.ao_name, target_mp: r.master_place_id, new_mp: newMp, err: null });
    }
  }

  const pendingAfter = await countAtlasByStatus("pending");
  const rejectedAfter = await countAtlasByStatus("rejected");
  const confirmedAfter = await countAtlasByStatus("confirmed");
  const mpAfter = await totalMasterPlaces();
  console.log(`\nAFTER:  atlas pending=${pendingAfter}  confirmed=${confirmedAfter}  rejected=${rejectedAfter}  master_place=${mpAfter}`);
  console.log(`DELTA:  pending ${pendingBefore - pendingAfter}  |  rejected +${rejectedAfter - rejectedBefore}  |  confirmed +${confirmedAfter - confirmedBefore}  |  master_place +${mpAfter - mpBefore}`);

  // Verify each: SR is linked to the new MP, NOT to the original target, and not to any other pre-existing MP.
  console.log(`\nVerifying each row's final state:`);
  for (const r of results) {
    if (r.err) continue;
    const sr = await db.from("source_record").select("id, external_id, master_place_id").eq("source_id", "atlas_oddities").eq("name", r.ao).limit(1).maybeSingle();
    const mpNow = sr.data?.master_place_id ?? null;
    const linksNew = mpNow === r.new_mp;
    const stillTarget = mpNow === r.target_mp;
    console.log(`  ${linksNew ? "OK " : "!! "} ao='${r.ao}'  sr.mp=${mpNow}  new_mp=${r.new_mp}  original_target=${r.target_mp}  ${stillTarget ? "STILL LINKED TO TARGET" : ""}`);
  }

  const errs = results.filter((r) => r.err);
  if (errs.length > 0) {
    console.log(`\nFAILURES (${errs.length}):`);
    for (const e of errs) console.log(`  ${e.ao}: ${e.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("reject: fatal", err);
  process.exit(1);
});
