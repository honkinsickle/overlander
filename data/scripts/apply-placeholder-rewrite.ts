/** TEST-only: apply the placeholder-name fix to the 521 rows classified
 *  `new_master_place` in /tmp/dryrun-classification.json. Idempotent —
 *  proceeds only when source_record.master_place_id IS NULL and the
 *  original pending place_match still exists. Writes a mapping file so
 *  the undo script can find the newly-created master_places.
 *
 *  Modes:
 *    --dry-run   : run idempotency guard on every row, report planned
 *                  action, write no data. No mapping file.
 *    (default)   : apply. Deletes pending place_match rows in bulk, then
 *                  calls apply_match_outcomes with synthesized
 *                  new_master_place outcomes (RPC handles insert of
 *                  master_place + update of source_record + confirmed
 *                  place_match + recompute_master_place).
 *
 *  Rewrite mapping written to /tmp/rewrite-mapping.json:
 *    [{ source_record_id, old_place_match_id, old_master_place_id,
 *       old_score_components, new_master_place_id, seed_name, seed_category }]
 */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

interface DryRunRow {
  place_match_id: string;
  source_record_id: string;
  master_place_id: string;
  distance_meters: number;
  name_similarity_old: number;
  name_similarity_new: number;
  combined_confidence_old: number;
  combined_confidence_new: number;
  new_classification: string;
  flip_reason: string | null;
  sr_name: string;
  mp_canonical_name: string;
}

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[env] TEST ${ref}  ${dryRun ? "(DRY RUN)" : "(APPLY)"}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  // 1. Load the dry-run classification and filter to flip candidates.
  const all = JSON.parse(readFileSync("/tmp/dryrun-classification.json", "utf8")) as DryRunRow[];
  const flips = all.filter((r) => r.new_classification === "new_master_place");
  const keeps = all.filter((r) => r.new_classification !== "new_master_place");
  console.log(`Loaded ${all.length} classification rows: ${flips.length} flips, ${keeps.length} keeps`);
  if (flips.length !== 521) console.log(`  (WARNING: expected 521 flips, got ${flips.length})`);
  if (keeps.length !== 424) console.log(`  (WARNING: expected 424 keeps, got ${keeps.length})`);

  // 2. Batch-load source_record state (master_place_id, name, inferred_category, geometry).
  //    Chunk to 100 ids to keep PostgREST URL under limits.
  const srIds = flips.map((f) => f.source_record_id);
  const srMap = new Map<string, any>();
  for (let i = 0; i < srIds.length; i += 100) {
    const p = await db
      .from("source_record")
      .select("id, name, inferred_category, geometry, master_place_id")
      .in("id", srIds.slice(i, i + 100));
    if (p.error) { console.log("SR QUERY FAILED:", p); return; }
    for (const r of p.data ?? []) srMap.set((r as any).id, r);
  }

  // 3. Batch-load pending place_match state.
  const pmIds = flips.map((f) => f.place_match_id);
  const pmMap = new Map<string, any>();
  for (let i = 0; i < pmIds.length; i += 100) {
    const p = await db
      .from("place_match")
      .select("id, source_record_id, master_place_id, status")
      .in("id", pmIds.slice(i, i + 100));
    if (p.error) { console.log("PM QUERY FAILED:", p); return; }
    for (const r of p.data ?? []) pmMap.set((r as any).id, r);
  }

  // 4. Idempotency guard per row.
  interface PlanRow {
    dry: DryRunRow;
    sr: any;
    pm: any;
    new_mp_id: string;
  }
  const planned: PlanRow[] = [];
  const skipped: { row: DryRunRow; reason: string }[] = [];
  for (const dry of flips) {
    const sr = srMap.get(dry.source_record_id);
    const pm = pmMap.get(dry.place_match_id);
    if (!sr) { skipped.push({ row: dry, reason: "source_record not found" }); continue; }
    if (sr.master_place_id !== null) {
      skipped.push({ row: dry, reason: `SR already linked to ${sr.master_place_id}` });
      continue;
    }
    if (!pm) { skipped.push({ row: dry, reason: "place_match not found" }); continue; }
    if (pm.status !== "pending") {
      skipped.push({ row: dry, reason: `place_match status=${pm.status} (expected pending)` });
      continue;
    }
    if (!sr.name || !sr.inferred_category || !sr.geometry) {
      skipped.push({ row: dry, reason: "SR missing name/category/geometry" });
      continue;
    }
    planned.push({ dry, sr, pm, new_mp_id: randomUUID() });
  }

  console.log(`\n═══ Idempotency guard ═══`);
  console.log(`  planned    : ${planned.length}`);
  console.log(`  skipped    : ${skipped.length}`);
  if (skipped.length > 0) {
    const byReason: Record<string, number> = {};
    for (const s of skipped) byReason[s.reason.replace(/[a-f0-9-]{36}/, "<uuid>")] = (byReason[s.reason.replace(/[a-f0-9-]{36}/, "<uuid>")] ?? 0) + 1;
    console.log(`  by reason  :`, byReason);
  }

  if (dryRun) {
    console.log(`\n(DRY RUN — no writes performed)`);
    return;
  }

  if (planned.length === 0) {
    console.log(`\nNothing to apply.`);
    return;
  }

  // 5. Delete the pending place_match rows for planned SRs. Chunk to 100
  //    to keep DELETE ... IN (...) below PostgREST URL limits.
  console.log(`\n═══ Deleting ${planned.length} pending place_match rows ═══`);
  const plannedPmIds = planned.map((p) => p.pm.id);
  let deleteCount = 0;
  for (let i = 0; i < plannedPmIds.length; i += 100) {
    const chunk = plannedPmIds.slice(i, i + 100);
    const d = await db.from("place_match").delete({ count: "exact" }).in("id", chunk);
    if (d.error) { console.log("DELETE FAILED:", d); return; }
    deleteCount += d.count ?? 0;
  }
  console.log(`  deleted: ${deleteCount}`);

  // 6. Synthesize new_master_place outcomes and call apply_match_outcomes
  //    in one RPC call. The RPC inserts master_place, updates source_record,
  //    inserts confirmed place_match at (0, 1.0, 1.0, 1.0), and calls
  //    recompute_master_place per MP.
  console.log(`\n═══ Applying ${planned.length} new_master_place outcomes via apply_match_outcomes RPC ═══`);
  const outcomes = planned.map((p) => {
    // geometry is a GeoJSON point object on TEST reads
    const geom = p.sr.geometry;
    const coords: [number, number] =
      typeof geom === "object" && geom?.coordinates ? geom.coordinates :
      typeof geom === "string" ? JSON.parse(geom).coordinates :
      [0, 0];
    return {
      kind: "new_master_place",
      source_record_id: p.sr.id,
      target: p.new_mp_id,
      seed_category: p.sr.inferred_category,
      seed_geometry: coords,
      seed_name: p.sr.name,
    };
  });
  // Chunk RPC calls: apply_match_outcomes takes jsonb array; keep chunks
  // moderate for statement_timeout headroom.
  const CHUNK = 250;
  let totalApplied = 0;
  const errors: any[] = [];
  for (let i = 0; i < outcomes.length; i += CHUNK) {
    const chunk = outcomes.slice(i, i + CHUNK);
    const r = await db.rpc("apply_match_outcomes", { p_outcomes: chunk });
    if (r.error) { console.log(`RPC FAILED (chunk ${i}-${i+chunk.length}):`, r.error); return; }
    const summary = r.data as any;
    console.log(`  chunk ${i / CHUNK + 1}: new_master_places=${summary?.new_master_places} errors=${JSON.stringify(summary?.errors ?? []).slice(0, 200)}`);
    totalApplied += summary?.new_master_places ?? 0;
    for (const err of summary?.errors ?? []) errors.push(err);
  }
  console.log(`\n═══ Totals ═══`);
  console.log(`  master_places created : ${totalApplied}`);
  console.log(`  errors                : ${errors.length}`);
  if (errors.length > 0) console.log(JSON.stringify(errors, null, 2));

  // 7. Write mapping file for the undo script.
  const mapping = planned.map((p) => ({
    source_record_id: p.sr.id,
    old_place_match_id: p.pm.id,
    old_master_place_id: p.pm.master_place_id,
    old_score_components: {
      distance_meters: p.dry.distance_meters,
      name_similarity: p.dry.name_similarity_old,
      category_compatibility: null, // recoverable from re-scoring if needed
      combined_confidence: p.dry.combined_confidence_old,
    },
    new_master_place_id: p.new_mp_id,
    seed_name: p.sr.name,
    seed_category: p.sr.inferred_category,
  }));
  writeFileSync("/tmp/rewrite-mapping.json", JSON.stringify(mapping, null, 2));
  console.log(`\nWrote mapping (${mapping.length} rows) to /tmp/rewrite-mapping.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
