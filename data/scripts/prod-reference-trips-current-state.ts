/** Read-only PROD: current is_active state of all reference_trips. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  console.log(`[env] PROD ${ref}\n`);
  const r = await db.from("reference_trips").select("id, title, is_active, updated_at").order("id");
  console.log("PROD reference_trips (all 3):");
  for (const row of (r.data ?? []) as { id: string; title: string; is_active: boolean; updated_at: string }[]) {
    console.log(`  ${row.is_active ? "✓" : "✗"} ${row.id.padEnd(28)} updated_at=${row.updated_at}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
