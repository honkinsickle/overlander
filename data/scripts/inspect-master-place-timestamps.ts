import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false}});
  // Get 5 newest MPs
  const {data} = await db.from("master_place").select("id, canonical_name, created_at, updated_at").order("created_at",{ascending:false}).limit(5);
  console.log("newest master_place rows:");
  console.log(JSON.stringify(data, null, 2));
  const {data: byUpd} = await db.from("master_place").select("id, canonical_name, created_at, updated_at").order("updated_at",{ascending:false}).limit(5);
  console.log("\nnewest by updated_at:");
  console.log(JSON.stringify(byUpd, null, 2));
}
main().catch(e=>{console.error(e);process.exit(1);});
