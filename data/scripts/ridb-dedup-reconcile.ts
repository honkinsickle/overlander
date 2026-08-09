/** Reconcile "915 inserted stat vs 388 distinct rows" for the STEP-2 RIDB
 *  ingest on TEST. Uses created_at / updated_at semantics:
 *    - INSERT via upsert_source_record: sets both to now()
 *    - UPDATE via ON CONFLICT DO UPDATE: sets fetch_timestamp + updated_at
 *      to now(); created_at stays.
 *
 *  Complication: I ran backfill:ridb-photo (apply) AFTER the STEP-2 ingest;
 *  that hits `.from('source_record').update(...)` which fires the same
 *  set_updated_at trigger. So `updated_at` on backfilled rows reflects
 *  backfill time, not ingest-time re-hits.
 *
 *  Approach: I know STEP 2 window (~20:21-20:23 UTC on 2026-08-09) and the
 *  backfill window (~20:29-20:30 UTC). Bucket rows accordingly.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Not TEST");

  const { data, error } = await db
    .from("source_record")
    .select("external_id, created_at, updated_at, fetch_timestamp")
    .eq("source_id", "ridb");
  if (error) throw error;
  const rows = data as { external_id: string; created_at: string; updated_at: string; fetch_timestamp: string }[];
  console.log(`ridb rows total: ${rows.length}`);

  // Windows (UTC) — logs showed local 20:21 but DB writes 19:21 UTC (machine is UTC+1).
  const STEP2_START = new Date("2026-08-09T19:21:00Z").getTime();
  const STEP2_END = new Date("2026-08-09T19:23:00Z").getTime();
  const BACKFILL_START = new Date("2026-08-09T19:29:00Z").getTime();
  const BACKFILL_END = new Date("2026-08-09T19:35:00Z").getTime();

  let preExistingUntouched = 0;
  let preExistingReHitInStep2 = 0;
  let newInStep2SingleHit = 0;
  let newInStep2ReHitInStep2 = 0;
  let backfillOnly = 0;
  let backfillAndStep2Rehit = 0;
  const other: string[] = [];

  for (const r of rows) {
    const createdTs = new Date(r.created_at).getTime();
    const updatedTs = new Date(r.updated_at).getTime();
    const fetchTs = new Date(r.fetch_timestamp).getTime();
    const createdInStep2 = createdTs >= STEP2_START && createdTs <= STEP2_END;
    const fetchInStep2 = fetchTs >= STEP2_START && fetchTs <= STEP2_END;
    const updatedInBackfill = updatedTs >= BACKFILL_START && updatedTs <= BACKFILL_END;

    if (!createdInStep2 && !fetchInStep2) {
      // Pre-existing row, STEP 2 did NOT touch it (fetch_timestamp is bumped
      // on every upsert). Untouched pre-existing.
      preExistingUntouched += 1;
    } else if (!createdInStep2 && fetchInStep2) {
      // Pre-existing row (older created_at) that STEP 2 re-hit (fetch bumped).
      preExistingReHitInStep2 += 1;
    } else if (createdInStep2 && !updatedInBackfill) {
      // New row from STEP 2, updated_at not touched by later backfill.
      // Compare created_at vs updated_at directly.
      const rehit = Math.abs(updatedTs - createdTs) > 5; // >5ms tolerance for microsecond drift
      if (rehit) newInStep2ReHitInStep2 += 1;
      else newInStep2SingleHit += 1;
    } else if (createdInStep2 && updatedInBackfill) {
      // New row from STEP 2, updated later by backfill. Can we tell if it was
      // also re-hit within STEP 2? fetch_timestamp reflects the LAST upsert
      // call. If fetch_timestamp is in STEP 2 window (backfill uses a plain
      // UPDATE, not upsert, so fetch_timestamp is NOT bumped by backfill)
      // then it was upserted at least once. We can compare fetch_timestamp
      // to created_at.
      const rehit = fetchInStep2 && Math.abs(fetchTs - createdTs) > 5;
      if (rehit) backfillAndStep2Rehit += 1;
      else backfillOnly += 1;
    } else {
      other.push(`${r.external_id}  created=${r.created_at}  updated=${r.updated_at}  fetch=${r.fetch_timestamp}`);
    }
  }

  console.log(`
Buckets (388 total):
  pre-existing, untouched by STEP 2         : ${preExistingUntouched}
  pre-existing, RE-HIT by STEP 2 (UPDATE)   : ${preExistingReHitInStep2}
  NEW in STEP 2, single upsert (INSERT)     : ${newInStep2SingleHit}
  NEW in STEP 2, re-hit within STEP 2       : ${newInStep2ReHitInStep2}
  NEW in STEP 2, later touched by backfill only    : ${backfillOnly}
  NEW in STEP 2, re-hit in STEP 2 + backfill later : ${backfillAndStep2Rehit}
  other/uncategorized                        : ${other.length}
`);
  if (other.length > 0) {
    console.log("uncategorized rows:");
    other.slice(0, 10).forEach((s) => console.log("  " + s));
  }

  const newRowsInStep2 = newInStep2SingleHit + newInStep2ReHitInStep2 + backfillOnly + backfillAndStep2Rehit;
  const rehitsInStep2 = newInStep2ReHitInStep2 + backfillAndStep2Rehit + preExistingReHitInStep2;
  const distinctRowsTouchedByStep2 = newRowsInStep2 + preExistingReHitInStep2;

  console.log(`Derived:`);
  console.log(`  distinct rows touched by STEP 2       : ${distinctRowsTouchedByStep2}`);
  console.log(`  rows STEP 2 hit MORE than once (measurable): ${rehitsInStep2}`);
  console.log(`  ⇒ lower bound on within-STEP-2 duplicate upserts : ${rehitsInStep2}`);
  console.log(`\n  ingest reported "inserted: 915" (per persistX success count).`);
  console.log(`  distinct rows post-STEP2: 388.`);
  console.log(`  gap 915 - 388 = 527 excess upsert calls.`);
  console.log(`  measured lower bound on within-STEP-2 re-hits: ${rehitsInStep2}`);
  console.log(`  NOTE: measured value is a LOWER BOUND — updated_at only reflects the LAST touch,`);
  console.log(`        so a row re-hit N times in STEP 2 counts as ONE re-hit here.`);
  console.log(`        True re-hits ≥ 527 (per accounting identity) if all 915 stat points`);
  console.log(`        correspond to real upsert calls (they do — persistFacility returns 'inserted'`);
  console.log(`        on every successful RPC call, not per distinct row).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
