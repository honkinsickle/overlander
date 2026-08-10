/** Read-only PROD baseline for reference_trips before Part 1 step 6.
 *  Guards: refuses if not PROD (fail-closed). Zero writes. */
import { getDb } from "../ingestion/lib/db.ts";
import { createHash } from "node:crypto";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  console.log(`[env] PROD ${ref}\n`);

  const all = await db.from("reference_trips").select("id, title, source_version, updated_at, payload").order("id");
  const rows = (all.data ?? []) as { id: string; title: string; source_version: string; updated_at: string; payload: unknown }[];

  console.log(`row_count: ${rows.length}`);
  for (const r of rows) {
    const s = JSON.stringify(r.payload);
    const sha = createHash("sha256").update(s).digest("hex");
    console.log(`  id=${r.id}`);
    console.log(`    title=${r.title}`);
    console.log(`    source_version=${r.source_version}`);
    console.log(`    updated_at=${r.updated_at}`);
    console.log(`    payload_bytes=${s.length}`);
    console.log(`    payload_sha256=${sha}`);
  }

  // Prove is_active column does NOT exist (expected pre-migration)
  const probe = await db.from("reference_trips").select("id, is_active").limit(1);
  if (probe.error) {
    console.log(`\nis_active column probe → error: ${probe.error.code} ${probe.error.message}`);
  } else {
    console.log(`\nis_active column probe → returned ${probe.data?.length ?? 0} rows: ${JSON.stringify(probe.data)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
