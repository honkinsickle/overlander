import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: {persistSession:false}});
  const { data } = await db.from("source_record").select("external_id,created_at,updated_at,fetch_timestamp").eq("source_id","ridb").limit(3);
  console.log(JSON.stringify(data, null, 2));
  const min = await db.from("source_record").select("created_at").eq("source_id","ridb").order("created_at",{ascending:true}).limit(1);
  const max = await db.from("source_record").select("created_at").eq("source_id","ridb").order("created_at",{ascending:false}).limit(1);
  console.log("earliest created_at:", min.data?.[0]?.created_at);
  console.log("latest   created_at:", max.data?.[0]?.created_at);
  const minU = await db.from("source_record").select("updated_at").eq("source_id","ridb").order("updated_at",{ascending:true}).limit(1);
  const maxU = await db.from("source_record").select("updated_at").eq("source_id","ridb").order("updated_at",{ascending:false}).limit(1);
  console.log("earliest updated_at:", minU.data?.[0]?.updated_at);
  console.log("latest   updated_at:", maxU.data?.[0]?.updated_at);
}
main().catch(e=>{console.error(e);process.exit(1);});
