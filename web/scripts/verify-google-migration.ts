/** Post-migration verify (read-only): run against whatever env-file you pass.
 *  Confirms the RPC returns google_place_id + non-null coverage, and that
 *  browse/search-style RPC reads still work. */
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const ref = url.match(/https:\/\/([a-z0-9]+)\./)?.[1];
  console.log("target:", ref, ref === "nqzeywzcowujzyegxbsr" ? "[PROD]" : ref === "znldzjdatkogdktymtvi" ? "[TEST]" : "[?]");
  const { data, error } = await sb.rpc("pois_along_corridor", { p_route: { type: "LineString", coordinates: [[-118.24,34.05],[-116.5,34.5]] }, p_buffer_m: 16000, p_categories: null });
  if (error) { console.log("✗ RPC error (browse/search would also break):", error.message); process.exit(1); }
  const rows = data as any[];
  const hasCol = rows.length > 0 && "google_place_id" in rows[0];
  const nonNull = rows.filter(r => r.google_place_id).length;
  console.log(`RPC rows: ${rows.length} | google_place_id column: ${hasCol ? "✓ present" : "✗ MISSING (migration not applied)"} | non-null place_ids: ${nonNull} (${rows.length?Math.round(100*nonNull/rows.length):0}%)`);
  console.log(hasCol && nonNull > 0 ? "✓ PASS — migration live, place_ids flowing; browse/search RPC OK" : "✗ CHECK — column missing or 0 place_ids");
})().catch(e => { console.error(e); process.exit(1); });
