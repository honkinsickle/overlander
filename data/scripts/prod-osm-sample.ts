import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await db.from("source_record").select("id, raw_payload, inferred_category, name").eq("source_id", "osm").limit(3);
  console.log(JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
