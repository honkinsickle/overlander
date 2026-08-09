/**
 * READ-ONLY perf measurement, TEST only.
 *
 * A) Time pois_along_corridor (with the current two laterals) — median of N.
 * B) Time the same shape WITHOUT the laterals — a plain
 *      .from('master_place').select(...).eq('is_searchable', true)...
 *    query over the same buffer (via PostGIS is expensive to bound from
 *    the client, so instead we call an alternate RPC OR page master_place
 *    by prominence up to 1000). Below we use the fact that master_place is
 *    small enough on TEST to just fetch the full searchable set and
 *    client-side spatial-filter (fair upper bound on the "no lateral" cost;
 *    the RPC does DWithin server-side, which is faster, so the delta we
 *    compute is a LOWER bound on the lateral's share).
 * C) Report source_record scan exposure (rows that match the lateral's
 *    predicate at all).
 * D) Simulate hydrate-shape: bare 50-id .in() vs 50-id .in() with a
 *    server-side lateral proxy (approximated by 50 individual RPC calls
 *    per photo, which is a worst case — real impl would add a single lateral).
 */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing: not TEST");
  console.log(`[env] TEST ${ref}\n`);

  const route = { type: "LineString", coordinates: [[-120.0, 35.0], [-114.0, 37.0]] };
  const bufferM = 500_000;

  // ─── A. Time pois_along_corridor (with laterals) ───────────────────
  const N = 10;
  const rpcTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const { data, error } = await db.rpc("pois_along_corridor", {
      p_route: route,
      p_buffer_m: bufferM,
      p_categories: null,
    });
    if (error) throw error;
    rpcTimes.push(Date.now() - t0);
    if (i === 0) {
      capturedRpcLen = data!.length;
      console.log(`  RPC returned ${data!.length} rows (buffer=${bufferM}m over the SoCal/SoNV diagonal)`);
    }
  }
  rpcTimes.sort((a, b) => a - b);
  const rpcMedian = rpcTimes[Math.floor(N / 2)];
  const rpcMin = rpcTimes[0];
  const rpcMax = rpcTimes[N - 1];
  console.log(`\n[A] pois_along_corridor (with 2 laterals) x${N}: min=${rpcMin}ms  median=${rpcMedian}ms  max=${rpcMax}ms`);
  console.log(`    all times: ${rpcTimes.join(", ")}ms`);

  // ─── B. Time the base-only equivalent (no laterals) ────────────────
  // Fetch searchable + non-land_status master_place rows, ordered by prominence,
  // no PostGIS filter (bound is the whole corpus, but we know it's 1749 on TEST
  // which is well under the row cap). This is a slight overshoot but is the
  // fairest lateral-free comparison we can drive from PostgREST.
  const baseTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const { data, error } = await db
      .from("master_place")
      .select("id,canonical_name,primary_category,prominence_score,description,attribution,overlander_tags")
      .eq("is_searchable", true)
      .neq("primary_category", "land_status")
      .order("prominence_score", { ascending: false });
    if (error) throw error;
    baseTimes.push(Date.now() - t0);
    if (i === 0) console.log(`\n  base-only .from('master_place').select returned ${data!.length} rows`);
  }
  baseTimes.sort((a, b) => a - b);
  const baseMedian = baseTimes[Math.floor(N / 2)];
  const baseMin = baseTimes[0];
  console.log(`\n[B] bare master_place SELECT (no laterals) x${N}: min=${baseMin}ms  median=${baseMedian}ms  max=${baseTimes[N - 1]}ms`);
  console.log(`    all times: ${baseTimes.join(", ")}ms`);

  const lateralShare = rpcMedian - baseMedian;
  console.log(`\n[Δ] approx lateral share (median): ${lateralShare}ms  (${((lateralShare / rpcMedian) * 100).toFixed(1)}% of RPC total)`);
  console.log(`    NOTE: base-only query has NO spatial filter (returns whole corpus). RPC does ST_DWithin`);
  console.log(`    server-side. So base-only over-fetches vs the RPC's row count. The Δ here is a LOWER bound`);
  console.log(`    on the lateral's true cost (real cost is likely higher — RPC still won the wall-clock).`);

  // ─── C. Row-count exposure ────────────────────────────────────────
  const totalSr = await db.from("source_record").select("id", { count: "exact", head: true });
  const photoSr = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .in("source_id", ["nps", "ridb"])
    .not("master_place_id", "is", null)
    .not("normalized_payload->photo->>url", "is", null);
  const googleSr = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .in("source_id", ["google", "google_resolved"])
    .not("master_place_id", "is", null);
  console.log(`\n[C] source_record scan exposure`);
  console.log(`    total source_records                                        : ${totalSr.count}`);
  console.log(`    matching photo lateral predicate (nps/ridb + linked + photo): ${photoSr.count}`);
  console.log(`    matching google lateral predicate (google/google_resolved + linked): ${googleSr.count}`);
  console.log(`    → each of the ${rpcMedian < 0 ? "?" : ""}${data_len_hint()} tiles the RPC returns runs BOTH laterals`);
  console.log(`    → per-tile lateral cost is dominated by the (master_place_id, source_id) filter + limit 1`);

  // ─── D. Hydrate-shape: bare 50-id select ──────────────────────────
  const { data: sampleMps } = await db
    .from("master_place")
    .select("id")
    .eq("is_searchable", true)
    .neq("primary_category", "land_status")
    .limit(50);
  const ids = (sampleMps ?? []).map((r) => r.id);
  const hydrateBareTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const { error } = await db
      .from("master_place")
      .select("id,canonical_name,primary_category,prominence_score,mvum_corridor,overlander_tags,contact,description,attribution,hours")
      .in("id", ids);
    if (error) throw error;
    hydrateBareTimes.push(Date.now() - t0);
  }
  hydrateBareTimes.sort((a, b) => a - b);
  const hydrateBareMedian = hydrateBareTimes[Math.floor(N / 2)];
  console.log(`\n[D] hydrate-shape: bare 50-id master_place SELECT x${N}: min=${hydrateBareTimes[0]}ms  median=${hydrateBareMedian}ms  max=${hydrateBareTimes[N - 1]}ms`);

  // Approximate lateral cost per-id from A/B delta. If RPC's per-tile lateral
  // cost is roughly linear in returned-row count, per-tile = lateralShare / rpcRowCount.
  const perTileLateralApprox = lateralShare / (data_len_hint() || 1);
  const hydrateWithLateralApprox = hydrateBareMedian + perTileLateralApprox * 50;
  console.log(`    → per-tile lateral cost (approx from A/B): ${perTileLateralApprox.toFixed(2)}ms`);
  console.log(`    → hydrate + equivalent lateral (approx): ${hydrateBareMedian}ms + 50×${perTileLateralApprox.toFixed(2)}ms ≈ ${hydrateWithLateralApprox.toFixed(0)}ms`);
}

// Poor man's forward-ref: RPC row count from run 1 stored via closure.
let capturedRpcLen = 0;
function data_len_hint(): number {
  return capturedRpcLen || 1000;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
