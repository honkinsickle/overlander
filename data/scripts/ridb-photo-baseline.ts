import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }});
  const total = await db.from("source_record").select("id",{count:"exact",head:true}).eq("source_id","ridb");
  const withPhoto = await db.from("source_record").select("id",{count:"exact",head:true}).eq("source_id","ridb").not("normalized_payload->photo","is",null);
  const nps = await db.from("source_record").select("id",{count:"exact",head:true}).eq("source_id","nps");
  const npsWithPhoto = await db.from("source_record").select("id",{count:"exact",head:true}).eq("source_id","nps").not("normalized_payload->photo","is",null);
  console.log(JSON.stringify({
    ridb_total: total.count, ridb_with_photo: withPhoto.count,
    nps_total: nps.count, nps_with_photo: npsWithPhoto.count,
  }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
