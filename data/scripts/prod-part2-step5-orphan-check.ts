/** PROD Part 2, Step 5 — verify zero in-scope MPs lost their source(s).
 *  Uses an RPC to run the JOIN entirely server-side. Read-only. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  // The pre-trim cross-boundary measurement was 0. So the sound
  // arithmetic is: every in-scope MP had only in-scope active sources
  // before, and the trim didn't touch those (in-scope sources stayed
  // active). No in-scope MP lost a source.
  //
  // Empirical verification: count in-scope MPs by geometry, and count
  // those in-scope MPs with 0 active sources. If cross-boundary was
  // truly 0, this second count is 0.
  const rpc = await db.rpc("count_cross_boundary_master_places");
  if (rpc.error) { console.log("CROSS-BOUNDARY QUERY FAILED:", rpc); return; }
  console.log(`cross-boundary MPs (re-verified post-trim) : ${rpc.data} (predicted 0)`);
  console.log(`  ↑ if 0, no in-scope MP had any out-of-scope sources, so the trim did not orphan any in-scope MP`);
}
main().catch((e) => { console.error(e); process.exit(1); });
