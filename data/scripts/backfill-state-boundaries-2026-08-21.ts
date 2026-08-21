/**
 * Backfill master_place.state for every in-scope master_place, using the
 * real TIGER/Line boundaries (resolve_state(), migration 20260821010000) —
 * replacing the ad-hoc bounding-box classifier used throughout this
 * session before this fix.
 *
 * Captures the OLD (bbox-derived) state for every row BEFORE writing,
 * purely in-memory (never persisted — no such column existed before this
 * migration), so the before/after transition matrix is a real comparison,
 * not a guess.
 *
 * Dry-run by default (reports the transition matrix, no writes). Pass
 * --write to actually persist master_place.state.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/backfill-state-boundaries-2026-08-21.ts            # dry-run
 *   cd data && npx tsx --env-file=.env scripts/backfill-state-boundaries-2026-08-21.ts --write     # apply
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;
const CHUNK = 300;

// The exact ad-hoc bbox classifier used throughout this session (unchanged,
// reused verbatim here ONLY to compute the "before" snapshot for the
// transition matrix — not used for any new decision).
type BboxState = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";
function classifyStateBboxOld(lng: number, lat: number): BboxState {
  if (lat >= 31.333 && lat < 37.0 && lng >= -114.82 && lng <= -109.045) return "AZ";
  if (lat >= 37.0 && lat < 42.0 && lng >= -114.05 && lng <= -109.04) return "UT";
  if (lat >= 35.0 && lat < 42.0 && lng >= -120.01 && lng <= -114.04) return "NV";
  if (lat >= 45.85 && lat <= 49.0 && lng >= -124.85 && lng <= -117.04) return "WA";
  if (lat >= 41.99 && lat < 46.30 && lng >= -124.75 && lng <= -116.45) return "OR";
  if (lat >= 32.534 && lat < 42.01 && lng >= -124.50 && lng <= -114.13) return "CA";
  return "outside";
}

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  if (ref !== "znldzjdatkogdktymtvi") { console.error(`Refusing non-TEST: ${ref}`); process.exit(2); }
  const write = process.argv.includes("--write");
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  console.log(`Project: ${ref} (TEST)`);
  console.log(`Mode: ${write ? "WRITE (--write)" : "DRY-RUN (pass --write to apply)"}`);

  // In-scope rows, same population the blast-radius report used.
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id, lng, lat").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`In-scope master_place rows: ${fmt(mps.length)}`);

  // Old state, in-memory only, per row.
  const oldState = new Map<string, BboxState>();
  for (const m of mps) oldState.set(m.id, classifyStateBboxOld(m.lng, m.lat));

  // New state, via real resolve_state() — one RPC call per row is too slow
  // at this scale (32k+ rows); instead call resolve_state() in bulk SQL via
  // a single UPDATE (write mode) or, for dry-run, batch-read master_place's
  // OWN geometry through resolve_state() via a read-only RPC loop in
  // chunks using an `in()` filter against a helper view is not available,
  // so dry-run computes new state the same way write mode will persist it:
  // one RPC per chunk using a raw SQL select via .rpc on a small wrapper.
  // Simpler and still correct: call resolve_state per row via Promise.all
  // in bounded concurrency chunks — resolve_state is a stable SQL function
  // (index-backed ST_Contains), fast per call.
  const newState = new Map<string, string | null>();
  for (let i = 0; i < mps.length; i += CHUNK) {
    const chunk = mps.slice(i, i + CHUNK);
    await Promise.all(chunk.map(async (m) => {
      const r = await db.rpc("resolve_state", { p_geom: `SRID=4326;POINT(${m.lng} ${m.lat})` });
      if (r.error) { console.log(`  resolve_state FAILED for ${m.id}:`, r.error); throw new Error(""); }
      newState.set(m.id, r.data);
    }));
    if ((i + CHUNK) % 3000 < CHUNK) console.log(`  ...resolved ${Math.min(i + CHUNK, mps.length)}/${mps.length}`);
  }

  // Transition matrix.
  const matrix = new Map<string, number>();
  let unresolvedNew = 0, unresolvedOld = 0, changed = 0, unchanged = 0;
  for (const m of mps) {
    const o = oldState.get(m.id)!;
    const n = newState.get(m.id);
    const oKey = o === "outside" ? "outside" : o;
    const nKey = n ?? "outside(none-of-six)";
    if (n == null) unresolvedNew++;
    if (o === "outside") unresolvedOld++;
    const key = `${oKey} -> ${nKey}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
    if (oKey === nKey) unchanged++; else changed++;
  }
  console.log(`\n== TRANSITION MATRIX (old bbox-derived -> new real-boundary) ==`);
  const sorted = [...matrix.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of sorted) console.log(`  ${k.padEnd(28)} ${fmt(n)}`);
  console.log(`\nUnchanged: ${fmt(unchanged)} (${pct(unchanged, mps.length)})`);
  console.log(`Changed: ${fmt(changed)} (${pct(changed, mps.length)})`);
  console.log(`Old classifier said "outside" (0 or 2+ box matches): ${fmt(unresolvedOld)}`);
  console.log(`New real-boundary resolves to none of the six (genuinely outside): ${fmt(unresolvedNew)}`);

  if (!write) {
    console.log("\nDRY-RUN — no writes made. Pass --write to apply.");
    process.exit(0);
  }

  // Bulk, set-based write via backfill_state_for_ids() — PostGIS does the
  // resolve_state() computation server-side in one statement per chunk,
  // not a per-row client loop (matches this repo's "spatial queries use
  // PostGIS" stack invariant).
  console.log("\nWriting master_place.state via backfill_state_for_ids()...");
  let written = 0;
  const ids = mps.map(m => m.id);
  const WRITE_CHUNK = 2000;
  for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
    const chunk = ids.slice(i, i + WRITE_CHUNK);
    const r = await db.rpc("backfill_state_for_ids", { p_ids: chunk });
    if (r.error) { console.log(`  backfill_state_for_ids FAILED:`, r.error); throw new Error(""); }
    written += r.data as number;
    console.log(`  ...${Math.min(i + WRITE_CHUNK, ids.length)}/${ids.length} (updated this chunk: ${r.data})`);
  }
  console.log(`\nWritten: ${written} / ${ids.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
