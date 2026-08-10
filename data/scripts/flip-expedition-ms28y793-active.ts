/** TEST-only: correction of an earlier over-flip. expedition-ms28y793 is
 *  LA → Moab, UT — inside the six-state footprint — and was wrongly grouped
 *  with the Canada/Alaska dev-era set. Flip it back to is_active=true. */
import { getDb } from "../ingestion/lib/db.ts";

const TARGET = "expedition-ms28y793";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  const before = await db.from("reference_trips").select("id, title, is_active").eq("id", TARGET).maybeSingle();
  console.log("BEFORE:", JSON.stringify(before.data));

  const upd = await db.from("reference_trips").update({ is_active: true }).eq("id", TARGET).select("id, title, is_active");
  console.log("UPDATE:", JSON.stringify(upd.data));

  console.log("\nAFTER — full active list on TEST:");
  const all = await db.from("reference_trips").select("id, title, is_active").order("id");
  for (const r of (all.data ?? []) as { id: string; title: string; is_active: boolean }[]) {
    console.log(`  ${r.is_active ? "✓" : "✗"} ${r.id.padEnd(32)} ${r.title}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
