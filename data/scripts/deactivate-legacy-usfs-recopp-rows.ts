/**
 * Deactivate the 6 legacy usfs source_records keyed by the old RecOpp
 * external_id shape (`usfs:recarea:<recareaid>`), replaced by the INFRA
 * ingester's `usfs:site:<site_cn>` shape.
 *
 * Rationale: the 2026-08-15 rewrite of `data/ingestion/sources/usfs.ts`
 * moves the source of record from EDW_RecreationOpportunities_01 to
 * EDW_RecInfraRecreationSites_02 layer 0. Under the new external_id
 * scheme, the 6 pre-existing rows would never dedupe naturally — they
 * carry a different external_id shape and would sit alongside their
 * replacements. Rather than deleting, we set `is_active=false` so:
 *   - the source_record row + its raw_payload history stay intact
 *     for audit
 *   - the `source_record_view` (WHERE is_active=true) hides them
 *   - `recompute_master_place()` on the linked MPs will drop
 *     source_count for those MPs, mirroring the bbq/fire_pit
 *     deactivation pattern from 2026-08-11.
 *
 * Read-only by default (dry-run). Pass `--write` to flip.
 *
 * TEST only — asserts project ref. Never touches PROD.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/deactivate-legacy-usfs-recopp-rows.ts        # dry-run
 *   cd data && npx tsx --env-file=.env scripts/deactivate-legacy-usfs-recopp-rows.ts --write # apply
 */
import { createClient } from "@supabase/supabase-js";

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

// Fetch all active usfs SRs whose external_id starts with the legacy prefix.
const legacy = await db.from("source_record")
  .select("id, external_id, name, master_place_id, is_active")
  .eq("source_id", "usfs")
  .eq("is_active", true)
  .like("external_id", "usfs:recarea:%");

if (legacy.error || legacy.data == null) {
  console.error("QUERY FAILED:", legacy);
  process.exit(1);
}
console.log(`\nFound ${legacy.data.length} legacy row(s):`);
for (const r of legacy.data as any[]) {
  console.log(`  ${r.id.slice(0, 8)}  ${r.external_id.padEnd(36)}  mp=${r.master_place_id?.slice(0,8) ?? "null"}  name=${r.name}`);
}

if (legacy.data.length === 0) {
  console.log("\nNothing to do. Exiting cleanly.");
  process.exit(0);
}

if (!write) {
  console.log("\nDRY-RUN — no writes made. Pass --write to apply.");
  process.exit(0);
}

// Apply: flip is_active=false. Keep master_place_id (recompute_master_place
// will observe the flip via source_count on its next call).
console.log("\nApplying is_active=false…");
const ids = (legacy.data as any[]).map(r => r.id);
const upd = await db.from("source_record")
  .update({ is_active: false })
  .in("id", ids)
  .select("id, external_id, is_active");
if (upd.error || upd.data == null) {
  console.error("UPDATE FAILED:", upd);
  process.exit(1);
}
console.log(`Updated ${upd.data.length} row(s):`);
for (const r of upd.data as any[]) {
  console.log(`  ${r.id.slice(0, 8)}  ${r.external_id}  is_active=${r.is_active}`);
}
console.log("\nDone. Next step: recompute_master_place on the affected MPs (via a materialize run) to drop source_count.");
