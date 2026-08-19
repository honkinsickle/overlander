/**
 * Deactivate the second batch of genuinely-sparse categories: viewpoint,
 * fire_pit, dump_station, gas_station, water, toilet, public_land. Same
 * product decision and same mechanism as peak/spring (609fcec /
 * deactivate-peak-spring.ts) — source_record.is_active = false (never a
 * hard delete) -> recompute_master_place() on every affected master_place
 * -> clear dangling PENDING place_match rows.
 *
 * Unlike peak/spring (100% single-source osm), this batch is NOT uniformly
 * osm: public_land is padus-sourced, and viewpoint has a small (146-record)
 * nps component alongside its osm majority. So this script targets EVERY
 * active source_record whose inferred_category is in the target set,
 * regardless of source_id — not source_id='osm' specifically.
 *
 * Pre-flight findings (discovery pass, read-only, run before this):
 *   - fire_pit confirmed CLEAN on TEST: 3,521 active osm fire_pit
 *     source_records, 0 inactive. The 2026-08-11 fire_pit deactivation
 *     (223 rows) was PROD-only, per the generation-pipeline scoping
 *     report's own finding, and this re-confirms it directly rather than
 *     assuming the prior finding still holds.
 *   - public_land (padus) behaves identically under this pattern — same
 *     source_record.is_active flag, same recompute_master_place cascade.
 *     No padus-specific handling needed.
 *   - 92 multi-source master_places (source_count 2 or 3) in this batch,
 *     same as peak/spring's 108 — ALL 92 have every active source in the
 *     target category set, so none survive with a different category.
 *   - viewpoint has 146 active NPS-sourced records that are NOT sparse
 *     (confirmed in the eligibility-bucketing work: 0% NONE, 100%
 *     hasDesc) — these get deactivated anyway, since the product decision
 *     is category-level ("viewpoint isn't a category we curate"), not
 *     data-quality-level. Real content is being discarded as a
 *     consequence of this scope decision, not a mistake — flagged, not
 *     silently done.
 *   - ORPHAN REFERENCE FOUND (unlike peak/spring, which had zero): one
 *     master_place, 3dabef74-c471-4e79-8bf0-2544ab6fc6c9 ("City Hall
 *     Observation Deck", a real named LA viewpoint, not generic junk),
 *     appears in a live `trips` row's corridorCities.placeIds AND in two
 *     `reference_trips` rows (expedition-ms28y793 and la-to-portland — the
 *     latter is the CURRENTLY ACTIVE reference trip). Per the task's
 *     explicit instruction (mirroring the peak/spring precedent): flagged
 *     here and in the commit/report, not resolved — proceeding with the
 *     uniform deactivation as instructed.
 *
 * Dry-run by default. Pass --write to apply. TEST only — asserts project ref.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/deactivate-sparse-categories-batch2.ts          # dry-run
 *   cd data && npx tsx --env-file=.env scripts/deactivate-sparse-categories-batch2.ts --write  # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";

const CATEGORIES = ["viewpoint", "fire_pit", "dump_station", "gas_station", "water", "toilet", "public_land"] as const;
const CHUNK = 500;
const RECOMPUTE_CONCURRENCY = 15;

async function fetchAllIds(
  db: SupabaseClient,
  table: string,
  build: (q: any) => any,
): Promise<string[]> {
  const PAGE = 1000;
  const ids: string[] = [];
  let from = 0;
  while (true) {
    const r = await build(db.from(table).select("id").order("id").range(from, from + PAGE - 1));
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
  console.log(`Categories: ${CATEGORIES.join(", ")}`);

  // ── Discover — every active source_record in the target categories,
  //    regardless of source_id (unlike peak/spring's osm-only filter). ──
  const srIds = await fetchAllIds(db, "source_record", (q) =>
    q.in("inferred_category", CATEGORIES).eq("is_active", true),
  );
  const mpIds = await fetchAllIds(db, "master_place", (q) =>
    q.in("primary_category", CATEGORIES),
  );
  console.log(`\nactive source_records in target categories (any source_id): ${srIds.length}`);
  console.log(`master_place rows in target categories: ${mpIds.length}`);

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
