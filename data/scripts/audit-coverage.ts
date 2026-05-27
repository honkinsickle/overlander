/**
 * Coverage audit: per-source counts and basic spatial distribution.
 *
 * Stub for Phase 1 week 1. Will report:
 *   - source_record count by source_id
 *   - active vs inactive
 *   - geographic bbox of records
 *   - newest / oldest fetch_timestamp per source
 */

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

async function main(): Promise<void> {
  const db = getDb();
  const { data, error, count } = await db
    .from("source_record")
    .select("source_id", { count: "exact", head: false });
  if (error) throw error;

  const bySource = new Map<string, number>();
  for (const row of data ?? []) {
    const sid = (row as { source_id: string }).source_id;
    bySource.set(sid, (bySource.get(sid) ?? 0) + 1);
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ total: count, bySource: Object.fromEntries(bySource) }, null, 2));
}

main().catch((err) => {
  logger.error({ err }, "audit-coverage: fatal");
  process.exit(1);
});
