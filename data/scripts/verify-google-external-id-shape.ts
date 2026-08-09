import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false}});
  const g = await db.from("source_record").select("external_id").eq("source_id","google").limit(5);
  const gr = await db.from("source_record").select("external_id").eq("source_id","google_resolved").limit(5);
  console.log("google samples     :", g.data?.map(r=>r.external_id));
  console.log("google_resolved sam:", gr.data?.map(r=>r.external_id));
  // Count that don't start with 'google:'
  const gMis = await db.from("source_record").select("id",{count:"exact",head:true}).eq("source_id","google").not("external_id","like","google:%");
  const grMis = await db.from("source_record").select("id",{count:"exact",head:true}).eq("source_id","google_resolved").not("external_id","like","google:%");
  console.log("google rows NOT starting 'google:':", gMis.count);
  console.log("google_resolved rows NOT starting 'google:':", grMis.count);
}
main().catch(e=>{console.error(e);process.exit(1);});
