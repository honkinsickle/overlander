/**
 * Bare-invocation dry-run analysis: what would `npm run -w data materialize`
 * do to TEST right now? No writes. Ships the same query logic materialize.ts
 * uses (findTrulyUnresolvedIds + matchAll) then reports:
 *
 *   1. Outcome breakdown by (kind × source_id).
 *      Answers: of the 380 unlinked RIDB and 122 unlinked google_resolved
 *      source_records, how many fall into each outcome.
 *
 *   2. Distinct existing master_place rows that would be touched by
 *      recompute_master_place() — i.e., targets of auto_link + amenity_rollup
 *      outcomes.
 *
 *   3. For 10 sample "touched" master_place rows, predict which fields would
 *      flip owner after recompute using resolve_field logic replicated in JS:
 *        min priority (from field_precedence) among linked source_records
 *        that have a non-null value for that field wins.
 *
 * TEST-guarded, READ-only.
 */
import { matchAll, type MatchOutcome } from "../entity-resolution/matcher.ts";
import { getDb } from "../ingestion/lib/db.ts";

// Replicated from pipeline/materialize.ts (kept local to avoid pulling the
// search/sync-typesense.ts transitive import into this script's compile scope
// — that file is intentionally outside data/tsconfig.json's include).
function computeTrulyUnresolvedIds(
  srRows: ReadonlyArray<{ id: string; inferred_category?: string | null }>,
  placeMatchRows: ReadonlyArray<{ source_record_id: string }>,
  onlyCategories: readonly string[] = [],
): string[] {
  const seenInPlaceMatch = new Set<string>(placeMatchRows.map((r) => r.source_record_id));
  const allowed = new Set<string>(onlyCategories);
  return srRows
    .filter((r) => !seenInPlaceMatch.has(r.id))
    .filter((r) => allowed.size === 0 || allowed.has(r.inferred_category ?? ""))
    .map((r) => r.id);
}

async function findTrulyUnresolvedIds(): Promise<string[]> {
  const db = getDb();
  async function pageAll<T>(fn: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
    const out: T[] = [];
    const size = 1000;
    let from = 0;
    while (true) {
      const p = await fn(from, from + size - 1);
      out.push(...p);
      if (p.length < size) break;
      from += size;
    }
    return out;
  }
  const [srRows, pmRows] = await Promise.all([
    pageAll<{ id: string; inferred_category: string | null }>(async (from, to) => {
      const { data, error } = await db
        .from("source_record")
        .select("id, inferred_category")
        .is("master_place_id", null)
        .order("id")
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
    pageAll<{ source_record_id: string }>(async (from, to) => {
      const { data, error } = await db
        .from("place_match")
        .select("source_record_id")
        .order("source_record_id")
        .range(from, to);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
  ]);
  return computeTrulyUnresolvedIds(srRows, pmRows, []);
}

// The 11 jsonb-resolved fields from recompute_master_place, per migration
// 20260527130000. (canonical_name / primary_category / geometry are the top
// three that also go through resolve_field.)
const RESOLVED_FIELDS = [
  "canonical_name",
  "primary_category",
  "geometry",
  "description",
  "amenities",
  "hours",
  "contact",
  "access",
  "services",
  "capacity",
  "seasonality",
] as const;

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (got ${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // ─── 1. Match the truly-unresolved set ───────────────────────────────
  console.log("finding truly-unresolved source_records…");
  const ids = await findTrulyUnresolvedIds();
  console.log(`  truly-unresolved count: ${ids.length}`);

  // Look up source_id per unresolved id (chunked to stay under URL limits)
  const sourceById = new Map<string, string>();
  {
    const chunk = 200;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const { data, error } = await db
        .from("source_record")
        .select("id, source_id")
        .in("id", slice);
      if (error) throw error;
      for (const r of data ?? []) sourceById.set(r.id, r.source_id);
    }
  }
  const bySource: Record<string, number> = {};
  for (const id of ids) {
    const s = sourceById.get(id) ?? "unknown";
    bySource[s] = (bySource[s] ?? 0) + 1;
  }
  console.log(`\ntruly-unresolved by source_id:`);
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} ${n}`);
  }

  // ─── 2. matchAll(ids) — no writes ────────────────────────────────────
  console.log(`\nrunning matchAll(${ids.length}) — no writes…`);
  const t0 = Date.now();
  const outcomes: MatchOutcome[] = await matchAll(ids);
  console.log(`  matchAll returned ${outcomes.length} outcomes in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Bucket by (kind × source_id)
  const grid = new Map<string, Map<string, number>>();
  for (const o of outcomes) {
    const src = sourceById.get(o.source_record_id) ?? "unknown";
    const bucket = grid.get(o.kind) ?? new Map<string, number>();
    bucket.set(src, (bucket.get(src) ?? 0) + 1);
    grid.set(o.kind, bucket);
  }
  console.log(`\nOutcome breakdown (kind × source_id):`);
  const allSources = new Set<string>();
  for (const b of grid.values()) for (const k of b.keys()) allSources.add(k);
  const kinds = ["new_master_place", "auto_link", "amenity_rollup", "manual_review"] as const;
  console.log(`  ${"kind".padEnd(20)}  ${[...allSources].map((s) => s.padStart(12)).join("")}   TOTAL`);
  for (const k of kinds) {
    const b = grid.get(k) ?? new Map();
    let total = 0;
    let line = "  " + k.padEnd(20);
    for (const s of allSources) {
      const n = b.get(s) ?? 0;
      line += String(n).padStart(12);
      total += n;
    }
    line += "   " + String(total).padStart(5);
    console.log(line);
  }
  console.log(`\n  ridb            : ${(grid.get("new_master_place")?.get("ridb") ?? 0) + (grid.get("auto_link")?.get("ridb") ?? 0) + (grid.get("amenity_rollup")?.get("ridb") ?? 0) + (grid.get("manual_review")?.get("ridb") ?? 0)} / ${bySource["ridb"] ?? 0} unresolved`);
  console.log(`  google_resolved : ${(grid.get("new_master_place")?.get("google_resolved") ?? 0) + (grid.get("auto_link")?.get("google_resolved") ?? 0) + (grid.get("amenity_rollup")?.get("google_resolved") ?? 0) + (grid.get("manual_review")?.get("google_resolved") ?? 0)} / ${bySource["google_resolved"] ?? 0} unresolved`);

  // ─── 3. Which existing master_place rows would recompute touch? ──────
  // auto_link + amenity_rollup outcomes carry `target` = master_place_id.
  // new_master_place outcomes CREATE new — no pre-existing MP touched.
  const touchedMpIds = new Set<string>();
  const outcomesByTarget = new Map<string, MatchOutcome[]>();
  for (const o of outcomes) {
    if (o.kind === "auto_link" || o.kind === "amenity_rollup") {
      touchedMpIds.add(o.target);
      const arr = outcomesByTarget.get(o.target) ?? [];
      arr.push(o);
      outcomesByTarget.set(o.target, arr);
    }
  }
  // Some auto_link outcomes carry `target` = a UUID of a master_place that
  // will be CREATED by an earlier new_master_place outcome in the same batch.
  // Those aren't pre-existing — filter them out for the "would touch existing"
  // count.
  const allTargets = [...touchedMpIds];
  const preExistingTargets = new Set<string>();
  const chunk = 200;
  for (let i = 0; i < allTargets.length; i += chunk) {
    const slice = allTargets.slice(i, i + chunk);
    const { data, error } = await db.from("master_place").select("id").in("id", slice);
    if (error) throw error;
    for (const r of data ?? []) preExistingTargets.add(r.id);
  }
  const inBatchTargets = allTargets.length - preExistingTargets.size;
  console.log(`\n\nauto_link + amenity_rollup targets: ${touchedMpIds.size} distinct`);
  console.log(`  of which PRE-EXISTING master_place (recomputed) : ${preExistingTargets.size}`);
  console.log(`  of which IN-BATCH new_master_place UUIDs        : ${inBatchTargets}`);

  // ─── 4. Predict field flips for 10 samples ──────────────────────────
  const samples = [...preExistingTargets].slice(0, 10);
  if (samples.length === 0) {
    console.log("  (no pre-existing master_places touched — nothing to sample)");
    return;
  }

  // Load field_precedence (one small query) into a Map<field, Map<source, priority>>
  const { data: fpRows, error: fpErr } = await db
    .from("field_precedence")
    .select("field_name, source_id, priority");
  if (fpErr) throw fpErr;
  const fpMap = new Map<string, Map<string, number>>();
  for (const r of (fpRows ?? []) as Array<{ field_name: string; source_id: string; priority: number }>) {
    if (!fpMap.has(r.field_name)) fpMap.set(r.field_name, new Map());
    fpMap.get(r.field_name)!.set(r.source_id, r.priority);
  }

  console.log(`\n─── Sample of 10 touched master_places — predicted field flips ───`);
  for (const mpId of samples) {
    // Existing linked source_records
    const { data: existingSrs, error: e1 } = await db
      .from("source_record")
      .select("id, source_id, normalized_payload, is_active")
      .eq("master_place_id", mpId)
      .eq("is_active", true);
    if (e1) throw e1;

    // Incoming source_records (per this dry-run)
    const incomingIds = outcomesByTarget.get(mpId)!.map((o) => o.source_record_id);
    const { data: incomingSrs, error: e2 } = await db
      .from("source_record")
      .select("id, source_id, normalized_payload")
      .in("id", incomingIds);
    if (e2) throw e2;

    // Current master_place row
    const { data: mpRow, error: e3 } = await db.from("master_place").select("*").eq("id", mpId).single();
    if (e3) throw e3;

    console.log(`\n  ${mpId}  (${mpRow.canonical_name ?? "(unnamed)"})`);
    console.log(`    existing sources: ${(existingSrs ?? []).map((s) => s.source_id).join(", ")}`);
    console.log(`    incoming sources: ${(incomingSrs ?? []).map((s) => s.source_id).join(", ")}  [${incomingIds.length} row(s)]`);

    // Simulate resolve_field per RESOLVED_FIELDS
    const combined = [...(existingSrs ?? []), ...(incomingSrs ?? [])] as Array<{
      id: string;
      source_id: string;
      normalized_payload: Record<string, unknown> | null;
    }>;
    const beforeCombined = existingSrs as typeof combined;
    let flips = 0;
    for (const field of RESOLVED_FIELDS) {
      const priorityFor = fpMap.get(field) ?? new Map<string, number>();
      const winnerFor = (rows: typeof combined): { src: string | null; value: unknown } => {
        let best: { src: string; value: unknown; pri: number } | null = null;
        for (const r of rows) {
          const v = r.normalized_payload?.[field];
          if (v == null || v === "null") continue;
          const pri = priorityFor.get(r.source_id);
          if (pri == null) continue; // this source has no precedence for this field
          if (best == null || pri < best.pri) best = { src: r.source_id, value: v, pri };
        }
        return best ? { src: best.src, value: best.value } : { src: null, value: null };
      };
      const before = winnerFor(beforeCombined);
      const after = winnerFor(combined);
      // JSON-stringify comparison — good enough to detect any change.
      const changed = JSON.stringify(before.value) !== JSON.stringify(after.value);
      const flippedOwner = before.src !== after.src;
      if (changed || flippedOwner) {
        flips++;
        const beforeStr = before.src ? `${before.src}(${JSON.stringify(before.value)?.slice(0, 40)})` : "—";
        const afterStr = after.src ? `${after.src}(${JSON.stringify(after.value)?.slice(0, 40)})` : "—";
        const flipMark = flippedOwner ? " ⇐ OWNER FLIP" : " (value change, same owner)";
        console.log(`      ${field.padEnd(18)} : ${beforeStr}  →  ${afterStr}${flipMark}`);
      }
    }
    if (flips === 0) console.log(`      (no field changes — all winners unchanged)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
