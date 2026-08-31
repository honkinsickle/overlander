/**
 * One-time backfill: populate master_place.operational_status from USFS
 * source_record.raw_payload.props.seasonal_operational_status.
 *
 * Only writes non-OPEN values (CLOSED, TEMPORARILY CLOSED, OPEN WITH
 * REDUCED SERVICES, UNREACHABLE). OPEN maps to NULL per decision #6.
 *
 * Dry-run by default. Pass --confirm to write.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-operational-status.ts
 *   npx tsx --env-file=.env scripts/backfill-operational-status.ts --confirm
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");

const confirm = process.argv.includes("--confirm");
const supabase = createClient(url, key);

async function run() {
  console.log(`Mode: ${confirm ? "WRITE" : "DRY-RUN (pass --confirm to write)"}\n`);

  const PAGE = 1000;
  let offset = 0;
  let totalScanned = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  const statusCounts: Record<string, number> = {};

  while (true) {
    const { data, error } = await supabase
      .from("source_record")
      .select("master_place_id,raw_payload")
      .eq("source_id", "usfs")
      .not("master_place_id", "is", null)
      .range(offset, offset + PAGE - 1);

    if (error) { console.error("Query error:", error); return; }
    if (!data || data.length === 0) break;

    for (const row of data) {
      totalScanned++;
      const props = (row.raw_payload as Record<string, unknown>)?.props as Record<string, unknown> | undefined;
      const raw = props?.seasonal_operational_status ?? props?.openstatus;
      if (raw == null) { totalSkipped++; continue; }

      const status = String(raw).toUpperCase().trim();
      if (status === "OPEN" || status === "") { totalSkipped++; continue; }

      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      if (confirm) {
        const { error: updateError } = await supabase
          .from("master_place")
          .update({ operational_status: status })
          .eq("id", row.master_place_id);
        if (updateError) {
          console.error(`  Update failed for ${row.master_place_id}:`, updateError.message);
        } else {
          totalUpdated++;
        }
      } else {
        totalUpdated++;
      }
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`Scanned: ${totalScanned} linked USFS source_records`);
  console.log(`Skipped (OPEN or no status): ${totalSkipped}`);
  console.log(`${confirm ? "Updated" : "Would update"}: ${totalUpdated} master_place rows`);
  console.log(`\nStatus distribution of updates:`);
  for (const [s, n] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
}

run();
