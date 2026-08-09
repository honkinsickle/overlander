/** How many post-STEP-2 RIDB source_records are actually linked to a
 *  master_place vs still awaiting entity resolution? */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (got ${ref})`);

  const total = await db.from("source_record").select("id", { count: "exact", head: true }).eq("source_id", "ridb");
  const linked = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", "ridb")
    .not("master_place_id", "is", null);
  const unlinked = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", "ridb")
    .is("master_place_id", null);
  console.log("ridb source_records total   :", total.count);
  console.log("ridb linked to master_place :", linked.count);
  console.log("ridb UNLINKED (ER pending)  :", unlinked.count);

  // Sample a few linked + unlinked rows for context
  const { data: sampleLinked } = await db
    .from("source_record")
    .select("external_id, master_place_id")
    .eq("source_id", "ridb")
    .not("master_place_id", "is", null)
    .limit(5);
  console.log("\nsample linked:", JSON.stringify(sampleLinked, null, 2));
  const { data: sampleUnlinked } = await db
    .from("source_record")
    .select("external_id")
    .eq("source_id", "ridb")
    .is("master_place_id", null)
    .limit(5);
  console.log("\nsample unlinked:", JSON.stringify(sampleUnlinked, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
