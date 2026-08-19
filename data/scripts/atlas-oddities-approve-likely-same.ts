/**
 * Bucket 1 executor: batch-approve the 38 likely_same rows (37 original +
 * Mark Twain Stump moved from likely_distinct) via `resolve_place_match`.
 *
 * Per Adam's note: prints the actual target (place_match_id, ao_name,
 * mp_name, mp_source_ids) BEFORE resolving each — so the target is visible
 * in the log rather than inferred from earlier bucketed samples.
 *
 * Idempotent-ish: resolve_place_match refuses to act on a non-pending row,
 * so a partial re-run either completes the remaining ones or errors on each
 * already-confirmed one (visible in the summary). No silent double-writes.
 *
 * Snapshot before/after: total pending atlas_oddities place_matches, and
 * total confirmed atlas_oddities place_matches. Adam sees the delta.
 */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

const RESOLVED_BY = "triage:likely_same:v1";

async function countAtlasByStatus(status: "pending" | "confirmed"): Promise<number> {
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

async function main() {
  const db = getDb();

  // 1. Load bucket 1 rows from the triage JSONL.
  const path = "/tmp/ao-triage-149.jsonl";
  const all = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
  const likelySame = all.filter((r) => r.bucket === "likely_same");
  const moved = all.filter(
    (r) => r.bucket === "likely_distinct" && r.ao_name === "Mark Twain Stump",
  );
  if (moved.length !== 1) {
    throw new Error(`expected exactly 1 Mark Twain Stump in likely_distinct, got ${moved.length}`);
  }
  const rows = [...likelySame, ...moved];
  console.log(`Loaded ${rows.length} rows to approve (${likelySame.length} likely_same + ${moved.length} moved).`);

  // 2. Snapshot before.
  const pendingBefore = await countAtlasByStatus("pending");
  const confirmedBefore = await countAtlasByStatus("confirmed");
  console.log(`\nBEFORE: atlas_oddities pending=${pendingBefore}  confirmed=${confirmedBefore}`);

  // 3. For each row: re-fetch the pending place_match's current state directly
  //    from the DB (not the JSONL — schedule could have drifted). Verify it's
  //    still pending. Print the visible target. Resolve.
  const stats = { attempted: 0, ok: 0, already_confirmed: 0, error: 0 };
  const failures: Array<{ ao: string; err: string }> = [];
  for (const r of rows) {
    stats.attempted += 1;
    // Re-fetch current state, and print ACTUAL mp_name from the DB rather
    // than trust the JSONL — target may have been recomputed since triage.
    const cur = await db
      .from("place_match")
      .select(`
        id, status,
        source_record!inner (external_id, name),
        master_place!inner (id, canonical_name, primary_category, source_count)
      `)
      .eq("id", r.place_match_id)
      .maybeSingle();
    if (cur.error || !cur.data) {
      const msg = cur.error?.message ?? "row missing";
      console.log(`  SKIP ${r.ao_name}: ${msg}`);
      failures.push({ ao: r.ao_name, err: msg });
      stats.error += 1;
      continue;
    }
    const pm: any = cur.data;
    const label = `ao='${pm.source_record.name}' → mp='${pm.master_place.canonical_name}' (${pm.master_place.primary_category}, sc=${pm.master_place.source_count})`;
    if (pm.status !== "pending") {
      console.log(`  SKIP already ${pm.status}: ${label}`);
      stats.already_confirmed += 1;
      continue;
    }
    // Print target BEFORE resolving.
    console.log(`  RESOLVING pm=${r.place_match_id}  ${label}`);
    const rpc = await db.rpc("resolve_place_match", {
      p_place_match_id: r.place_match_id,
      p_resolved_by: RESOLVED_BY,
    });
    if (rpc.error) {
      console.log(`    ERROR: ${rpc.error.message}`);
      failures.push({ ao: r.ao_name, err: rpc.error.message });
      stats.error += 1;
    } else {
      stats.ok += 1;
    }
  }

  // 4. Snapshot after.
  const pendingAfter = await countAtlasByStatus("pending");
  const confirmedAfter = await countAtlasByStatus("confirmed");
  console.log(`\nAFTER:  atlas_oddities pending=${pendingAfter}  confirmed=${confirmedAfter}`);
  console.log(`DELTA:  pending ${pendingBefore - pendingAfter} removed  |  confirmed +${confirmedAfter - confirmedBefore}`);

  console.log(`\nSTATS: attempted=${stats.attempted}  ok=${stats.ok}  already_confirmed=${stats.already_confirmed}  error=${stats.error}`);
  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  ${f.ao}: ${f.err}`);
  }
}

main().catch((err) => {
  console.error("approve: fatal", err);
  process.exit(1);
});
