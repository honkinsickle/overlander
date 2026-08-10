/** PROD Part 2, Step 2 — re-derive out-of-scope count. Read-only. */
import { getDb } from "../ingestion/lib/db.ts";
async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const readAt = new Date().toISOString();
  console.log(`[env] PROD ${ref}`);
  console.log(`[read_at_utc_wallclock] ${readAt}\n`);

  const c = await db.rpc("count_source_records_out_of_scope");
  if (c.error) { console.log("QUERY FAILED:", c); return; }
  const row = (c.data as any[])[0];
  console.log("═══ Out-of-scope re-derivation ═══");
  console.log(`  out_of_scope_count : ${row.out_of_scope_count}`);
  console.log(`  in_scope_count     : ${row.in_scope_count}`);
  console.log(`  active_total       : ${row.active_total}`);
  console.log(`  (sum check)        : ${Number(row.out_of_scope_count) + Number(row.in_scope_count)} == ${row.active_total} → ${Number(row.out_of_scope_count) + Number(row.in_scope_count) === Number(row.active_total) ? "OK" : "MISMATCH"}`);

  const cb = await db.rpc("count_cross_boundary_master_places");
  if (cb.error) { console.log("CROSS-BOUNDARY QUERY FAILED:", cb); return; }
  console.log(`\n═══ Cross-boundary MPs ═══`);
  console.log(`  count : ${cb.data} (predicted 0)`);

  console.log("\n═══ vs prior prediction ═══");
  console.log(`  prior session 2026-08-09: 8,064 out-of-scope of 20,384 active`);
  console.log(`  now                    : ${row.out_of_scope_count} out-of-scope of ${row.active_total} active`);
  console.log(`  delta                  : ${Number(row.out_of_scope_count) - 8064} rows`);
  console.log(`\n[method] ST_Intersects(source_record.geometry, six_state_scope()) — six_state_scope() is a Postgres function (migration 20260810180000) returning the UNION of state bboxes with WA's northern edge stepped to lat 48.40 west of -123° to exclude Vancouver Island. Other 5 states use ST_MakeEnvelope bboxes. No state polygon shapefile exists in the repo.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
