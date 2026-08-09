/** READ-ONLY inspect: are google_resolved rows on TEST linked to any master_place? */
import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db
    .from("source_record")
    .select("external_id, fetch_timestamp, master_place_id, updated_at")
    .eq("source_id", "google_resolved")
    .order("fetch_timestamp", { ascending: false })
    .limit(5);
  if (error) throw error;
  console.log("--- newest 5 google_resolved rows on TEST ---");
  console.log(JSON.stringify(data, null, 2));

  const linked = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", "google_resolved")
    .not("master_place_id", "is", null);
  const unlinked = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", "google_resolved")
    .is("master_place_id", null);
  console.log("\ngoogle_resolved linked  :", linked.count);
  console.log("google_resolved unlinked:", unlinked.count);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
