/**
 * Deactivate peak + spring categories from the corpus. Product decision, not
 * a data-quality fix — population size was independently verified real
 * (live Overpass cross-check, near-exact match) in a prior investigation.
 *
 * Mirrors the bbq/fire_pit deactivation pattern (docs/LOG.md /
 * docs/STATE.md, 2026-08-11) and its confirmed TEST precedent script,
 * deactivate-legacy-usfs-recopp-rows.ts:
 *   1. source_record.is_active = false on the target rows (never a hard
 *      delete — raw_payload history stays intact for audit).
 *   2. recompute_master_place() on every affected master_place — drops
 *      source_count to 0 for rows whose only sources were just deactivated.
 *      master_place rows are NOT deleted and is_searchable is untouched
 *      (recompute never flips it except the land_status rule, which
 *      doesn't apply here) — this exactly mirrors "the 138 fire_pit
 *      master_places were NOT deleted... persist at source_count=0 and
 *      is_searchable=true."
 *   3. Delete dangling PENDING place_match rows referencing the
 *      now-inactive source_records (mirrors "the 85 dangling pending
 *      place_match rows... cleared").
 *
 * Discovery pass (read-only, run before this) confirmed:
 *   - 33,924 active osm peak source_records, 31,465 active osm spring
 *     (65,389 total) — more than the 64,305 peak+spring master_place count
 *     because 975 are unlinked, sitting in place_match as pending (the
 *     same shape as fire_pit's 223 total = 138 linked-solo + 85 pending).
 *   - 108 master_places are multi-sourced (source_count 2 or 3) but EVERY
 *     ONE of those 108 has only osm peak/spring active sources — so ALL
 *     64,305 peak/spring master_places will drop to source_count=0, zero
 *     partial survivors.
 *   - Zero orphaned trip references: neither `trips` (6 rows) nor
 *     `reference_trips` (9 rows) on TEST contain any peak/spring
 *     master_place id anywhere in their payload.
 *
 * KNOWN GAP, not fixed here (out of scope — would mean editing the shared
 * pois_along_corridor RPC, a bigger change than this task authorizes):
 * pois_along_corridor's WHERE clause checks `mp.is_searchable = true AND
 * mp.primary_category <> 'land_status'` — it does NOT check
 * `source_count > 0`, and it reads geometry from `master_place.geometry`
 * directly, not through the search-export view (whose `source_count > 0`
 * filter is what makes deactivation "work" for browse/search). So a
 * zeroed-out peak/spring master_place will still be offered by generation
 * as a trip stop even after this runs — deactivation propagates to
 * browse/Typesense but NOT to generation. This is an inherited gap in the
 * fire_pit-established pattern itself, not something new introduced here.
 *
 * Dry-run by default. Pass --write to apply. TEST only — asserts project ref.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/deactivate-peak-spring.ts          # dry-run
 *   cd data && npx tsx --env-file=.env scripts/deactivate-peak-spring.ts --write  # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";

const CATEGORIES = ["peak", "spring"] as const;
const CHUNK = 500;
const RECOMPUTE_CONCURRENCY = 15;

async function fetchAllIds(
  db: SupabaseClient,
  table: string,
  build: (q: any) => any,
  select = "id",
): Promise<string[]> {
  const PAGE = 1000;
  const ids: string[] = [];
  let from = 0;
  while (true) {
    const r = await build(db.from(table).select(select).order("id").range(from, from + PAGE - 1));
    if (r.error || r.data == null) { console.error(`QUERY FAILED (${table}):`, r); throw new Error(""); }
    ids.push(...(r.data as any[]).map((row) => row.id));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  return ids;
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") {
    console.error(`Refusing non-TEST: ${ref}`);
    process.exit(2);
  }
  const write = process.argv.includes("--write");
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write)" : "DRY-RUN (pass --write to apply)"}`);

  // ── Discover ──
  const srIds = await fetchAllIds(db, "source_record", (q) =>
    q.eq("source_id", "osm").in("inferred_category", CATEGORIES).eq("is_active", true),
  );
  const mpIds = await fetchAllIds(db, "master_place", (q) =>
    q.in("primary_category", CATEGORIES),
  );
  console.log(`\nosm peak+spring active source_records: ${srIds.length}`);
  console.log(`peak+spring master_place rows: ${mpIds.length}`);

  if (!write) {
    console.log("\nDRY-RUN — no writes made. Pass --write to apply.");
    process.exit(0);
  }

  // ── Step 1: deactivate source_records ──
  console.log("\nStep 1: deactivating source_records...");
  let deactivated = 0;
  for (let i = 0; i < srIds.length; i += CHUNK) {
    const chunk = srIds.slice(i, i + CHUNK);
    const upd = await db.from("source_record").update({ is_active: false }).in("id", chunk).select("id");
    if (upd.error || upd.data == null) { console.error("UPDATE FAILED:", upd); throw new Error(""); }
    deactivated += upd.data.length;
    if ((i + CHUNK) % 5000 < CHUNK) console.log(`  ...${deactivated}/${srIds.length}`);
  }
  console.log(`  deactivated ${deactivated} source_records`);

  // ── Step 2: recompute affected master_places (parallelized) ──
  console.log("\nStep 2: recomputing master_places...");
  const limit = pLimit(RECOMPUTE_CONCURRENCY);
  let ok = 0;
  let failed = 0;
  const errors: { id: string; message: string }[] = [];
  let done = 0;
  await Promise.all(
    mpIds.map((id) =>
      limit(async () => {
        const { error } = await db.rpc("recompute_master_place", { p_master_place_id: id });
        done++;
        if (error) { failed++; errors.push({ id, message: error.message }); } else ok++;
        if (done % 2000 === 0) console.log(`  ...${done}/${mpIds.length} (ok=${ok} failed=${failed})`);
      }),
    ),
  );
  console.log(`  recompute done. ok=${ok} failed=${failed}`);
  if (errors.length > 0) {
    console.log("  first 10 errors:");
    for (const e of errors.slice(0, 10)) console.log(`    ${e.id}: ${e.message}`);
  }

  // ── Step 3: clear dangling pending place_match rows ──
  console.log("\nStep 3: clearing dangling pending place_match rows...");
  let pmDeleted = 0;
  for (let i = 0; i < srIds.length; i += 200) {
    const chunk = srIds.slice(i, i + 200);
    const del = await db.from("place_match").delete({ count: "exact" }).in("source_record_id", chunk).eq("status", "pending");
    if (del.error) { console.error("DELETE FAILED:", del); throw new Error(""); }
    pmDeleted += del.count ?? 0;
  }
  console.log(`  cleared ${pmDeleted} dangling pending place_match rows`);

  console.log("\nDone.");
  console.log(JSON.stringify({ deactivated, recompute: { ok, failed }, pmDeleted }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
