/**
 * Bucket-3 executor: applies a decided action (approve | reject) to a set
 * of rows selected from /tmp/ao-classified-ambiguous.jsonl by (shape,
 * ao_name-exclusion-list). Same verification discipline as the bucket-1/2
 * executors — re-fetches each row's current DB state before acting, prints
 * ao=… → mp='<name>' (<cat>) BEFORE writing, and verifies the final
 * source_record linkage by place_match_id lookup (not by name — Eagle Rock
 * lesson from bucket 1).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/atlas-oddities-execute-bucket3.ts \
 *     --shape A_parent_facility --action reject --exclude "General Grant,Buck Rock" \
 *     --resolved-by triage:3A:v1
 *
 * TEST-only, no --prod flag exists.
 */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

type Action = "approve" | "reject";

interface Args {
  shape: string;
  action: Action;
  exclude: Set<string>;
  resolvedBy: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const shape = get("--shape");
  const action = get("--action") as Action | undefined;
  const exclude = new Set((get("--exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const resolvedBy = get("--resolved-by");
  if (!shape || !action || !resolvedBy) {
    throw new Error("required: --shape <name> --action <approve|reject> --resolved-by <tag> [--exclude 'name1,name2']");
  }
  if (action !== "approve" && action !== "reject") {
    throw new Error(`--action must be approve|reject, got ${action}`);
  }
  return { shape, action, exclude, resolvedBy };
}

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
  const args = parseArgs();
  const db = getDb();

  const path = "/tmp/ao-classified-ambiguous.jsonl";
  const all = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  const shapeRows = all.filter((r: any) => r.shape === args.shape);
  const rows = shapeRows.filter((r: any) => !args.exclude.has(r.ao_name));
  const excludedRows = shapeRows.filter((r: any) => args.exclude.has(r.ao_name));

  console.log(`shape=${args.shape}  action=${args.action}  resolved-by='${args.resolvedBy}'`);
  console.log(`  shape total: ${shapeRows.length}`);
  console.log(`  excluded (${excludedRows.length}): ${excludedRows.map((r: any) => `'${r.ao_name}'`).join(", ") || "(none)"}`);
  console.log(`  to process: ${rows.length}`);

  const pendingBefore = await countAtlasByStatus("pending");
  const confirmedBefore = await countAtlasByStatus("confirmed");
  const rejectedBefore = await countAtlasByStatus("rejected");
  const mpBefore = await totalMasterPlaces();
  console.log(`\nBEFORE: pending=${pendingBefore}  confirmed=${confirmedBefore}  rejected=${rejectedBefore}  master_place=${mpBefore}`);

  const results: Array<{
    place_match_id: string;
    source_record_id: string;
    ao_name: string;
    original_target: string;
    new_mp: string | null;
    err: string | null;
  }> = [];

  for (const r of rows) {
    const cur = await db
      .from("place_match")
      .select(`
        id, status, source_record_id, master_place_id,
        source_record!inner (id, external_id, name),
        master_place!inner (id, canonical_name, primary_category)
      `)
      .eq("id", r.place_match_id)
      .maybeSingle();
    if (cur.error || !cur.data) {
      const msg = cur.error?.message ?? "row missing";
      console.log(`  SKIP ${r.ao_name}: ${msg}`);
      results.push({
        place_match_id: r.place_match_id,
        source_record_id: r.source_record_id,
        ao_name: r.ao_name,
        original_target: r.master_place_id,
        new_mp: null,
        err: msg,
      });
      continue;
    }
    const pm: any = cur.data;
    if (pm.status !== "pending") {
      console.log(`  SKIP already ${pm.status}: ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}'`);
      results.push({
        place_match_id: r.place_match_id,
        source_record_id: pm.source_record_id,
        ao_name: r.ao_name,
        original_target: pm.master_place_id,
        new_mp: null,
        err: `not pending: ${pm.status}`,
      });
      continue;
    }
    const label = `pm=${r.place_match_id}  ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}' (${pm.master_place.primary_category})`;
    if (args.action === "approve") {
      console.log(`  APPROVING ${label}`);
      const rpc = await db.rpc("resolve_place_match", {
        p_place_match_id: r.place_match_id,
        p_resolved_by: args.resolvedBy,
      });
      if (rpc.error) {
        console.log(`    ERROR: ${rpc.error.message}`);
        results.push({
          place_match_id: r.place_match_id,
          source_record_id: pm.source_record_id,
          ao_name: r.ao_name,
          original_target: pm.master_place_id,
          new_mp: null,
          err: rpc.error.message,
        });
      } else {
        results.push({
          place_match_id: r.place_match_id,
          source_record_id: pm.source_record_id,
          ao_name: r.ao_name,
          original_target: pm.master_place_id,
          new_mp: pm.master_place_id, // approve links to the SAME MP
          err: null,
        });
      }
    } else {
      console.log(`  REJECTING ${label}`);
      const rpc = await db.rpc("reject_place_match_to_new_master_place", {
        p_place_match_id: r.place_match_id,
        p_resolved_by: args.resolvedBy,
      });
      if (rpc.error) {
        console.log(`    ERROR: ${rpc.error.message}`);
        results.push({
          place_match_id: r.place_match_id,
          source_record_id: pm.source_record_id,
          ao_name: r.ao_name,
          original_target: pm.master_place_id,
          new_mp: null,
          err: rpc.error.message,
        });
      } else {
        const newMp = (rpc.data as any)?.new_master_place_id ?? null;
        console.log(`    new_mp=${newMp}`);
        results.push({
          place_match_id: r.place_match_id,
          source_record_id: pm.source_record_id,
          ao_name: r.ao_name,
          original_target: pm.master_place_id,
          new_mp: newMp,
          err: null,
        });
      }
    }
  }

  const pendingAfter = await countAtlasByStatus("pending");
  const confirmedAfter = await countAtlasByStatus("confirmed");
  const rejectedAfter = await countAtlasByStatus("rejected");
  const mpAfter = await totalMasterPlaces();
  console.log(`\nAFTER:  pending=${pendingAfter}  confirmed=${confirmedAfter}  rejected=${rejectedAfter}  master_place=${mpAfter}`);
  console.log(`DELTA:  pending ${pendingBefore - pendingAfter}  |  confirmed +${confirmedAfter - confirmedBefore}  |  rejected +${rejectedAfter - rejectedBefore}  |  master_place +${mpAfter - mpBefore}`);

  // Verify by place_match_id (Eagle Rock lesson — do NOT lookup by name).
  console.log(`\nVerifying each processed row by place_match_id → SR's current master_place_id:`);
  const successRows = results.filter((r) => r.err === null);
  const CHUNK = 100;
  for (let i = 0; i < successRows.length; i += CHUNK) {
    const chunk = successRows.slice(i, i + CHUNK);
    const srIds = chunk.map((r) => r.source_record_id);
    const q = await db.from("source_record").select("id, master_place_id").in("id", srIds);
    if (q.error) {
      console.error("verify query failed:", q.error);
      process.exit(1);
    }
    const byId = new Map<string, string | null>();
    for (const row of q.data ?? []) byId.set(row.id, row.master_place_id);
    for (const r of chunk) {
      const actual = byId.get(r.source_record_id) ?? null;
      const expected = r.new_mp; // approve: original target; reject: newly-minted
      const ok = actual === expected;
      const stillOriginal = actual === r.original_target;
      const flag = ok ? "OK " : "!! ";
      // For reject: also flag if actual === original_target (shouldn't be).
      const rejectRegressed = args.action === "reject" && stillOriginal;
      console.log(
        `  ${flag}${r.ao_name}  sr.mp=${actual}  expected=${expected}  ${rejectRegressed ? "STILL LINKED TO ORIGINAL TARGET" : ""}`,
      );
    }
  }

  const errs = results.filter((r) => r.err !== null);
  if (errs.length > 0) {
    console.log(`\nFAILURES (${errs.length}):`);
    for (const e of errs) console.log(`  ${e.ao_name}: ${e.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("bucket3-execute: fatal", err);
  process.exit(1);
});
