/** Live RPC probe: after applying the RPC migrations, does pois_along_corridor
 *  actually return nps_photo_url values? Small corridor sample. READ-only. */
import { createClient } from "@supabase/supabase-js";
async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  const allowProd = process.argv.includes("--allow-prod");
  if (ref !== "znldzjdatkogdktymtvi" && !allowProd) throw new Error("Refusing: not TEST, pass --allow-prod");
  console.log(`[env] ${ref === "nqzeywzcowujzyegxbsr" ? "PROD" : "TEST"} ${ref}`);

  const route = { type: "LineString", coordinates: [[-125, 30], [-100, 50]] };
  const { data, error } = await db.rpc("pois_along_corridor", {
    p_route: route,
    p_buffer_m: 1_000_000,
    p_categories: null,
  });
  if (error) throw error;
  const rows = data as Array<{ id: string; canonical_name: string; nps_photo_url: string | null; google_place_id: string | null }>;
  console.log(`\nRPC returned rows: ${rows.length}`);
  const withPhoto = rows.filter((r) => r.nps_photo_url && r.nps_photo_url.length > 0);
  const withPlace = rows.filter((r) => r.google_place_id && r.google_place_id.length > 0);
  console.log(`  with nps_photo_url populated : ${withPhoto.length}`);
  console.log(`  with google_place_id populated: ${withPlace.length}`);
  console.log(`\n[sample first 3 photo urls]`);
  for (const r of withPhoto.slice(0, 3)) {
    console.log(`  ${r.canonical_name} → ${r.nps_photo_url}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
