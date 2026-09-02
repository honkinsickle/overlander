/** READ-ONLY re-verification of the PROD photo promotion. Writes nothing. */
import { getDb } from "../ingestion/lib/db.ts";

async function main(): Promise<void> {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  console.log("target:", ref, ref === "nqzeywzcowujzyegxbsr" ? "** PROD **" : "(NOT PROD)");
  if (ref !== "nqzeywzcowujzyegxbsr") process.exit(1);

  // 1. candidate rows actually persisted
  const c = await db
    .from("master_place_photo_candidate")
    .select("place_name, image_url, match_status", { count: "exact" })
    .eq("pilot_run", "ca-campground-2026-09-01-fixed");
  if (c.error || c.count == null) { console.log("QUERY FAILED (candidates):", JSON.stringify(c)); process.exit(1); }
  console.log(`\n[1] PROD candidate rows (pilot_run fixed): count=${c.count}`);
  const byPlace: Record<string, number> = {};
  for (const r of c.data as any[]) byPlace[r.place_name] = (byPlace[r.place_name] ?? 0) + 1;
  console.log("    by place:", JSON.stringify(byPlace));

  // 2. wired source_records actually present + active
  const w = await db
    .from("source_record")
    .select("external_id, master_place_id, is_active, normalized_payload", { count: "exact" })
    .eq("source_id", "wikipedia")
    .like("external_id", "wikipedia:photo-pilot:%");
  if (w.error || w.count == null) { console.log("QUERY FAILED (wired):", JSON.stringify(w)); process.exit(1); }
  console.log(`\n[2] PROD wikipedia:photo-pilot:* source_records: count=${w.count}`);
  for (const r of w.data as any[]) {
    console.log(`    active=${r.is_active} mp=${r.master_place_id} url=${r.normalized_payload?.photo?.url?.slice(0, 55)} :: ${r.external_id.slice(0, 60)}`);
  }

  // 3. do Aikens Creek / Tolkan exist on PROD AT ALL (master_place, by name)?
  console.log("\n[3] existence of the 2 'unresolved' places on PROD (master_place by name):");
  for (const nm of ["Aikens Creek", "Tolkan"]) {
    const r = await db.from("master_place").select("id, canonical_name, primary_category").ilike("canonical_name", `%${nm}%`);
    if (r.error) { console.log(`    "${nm}" QUERY FAILED:`, JSON.stringify(r.error)); continue; }
    console.log(`    "${nm}": ${r.data?.length ?? 0} row(s) ${JSON.stringify((r.data as any[]).map((x) => x.canonical_name))}`);
  }

  // 4. re-confirm the 3 wired photos still surface via the production RPC
  console.log("\n[4] render-path re-check via pois_along_corridor:");
  const wired = [
    ["Bunny Flat", "a0e3bec0-50bf-48be-9d5b-e965613500a5"],
    ["Fort Miller", "576b9fd4-16af-41a0-abe1-6dd9cc45777f"],
    ["Sugarloaf", "041815ba-25ee-40cf-a4bd-bbffa9b07b37"],
  ];
  for (const [label, id] of wired) {
    const m = await db.from("master_place_search_export").select("lng, lat").eq("id", id).maybeSingle();
    if (!m.data) { console.log(`    ${label}: not in export`); continue; }
    const route = { type: "LineString", coordinates: [[(m.data as any).lng - 0.02, (m.data as any).lat], [(m.data as any).lng + 0.02, (m.data as any).lat]] };
    const r = await db.rpc("pois_along_corridor", { p_route: route, p_buffer_m: 3000, p_categories: null });
    const hit = (r.data || []).find((x: any) => x.id === id);
    console.log(`    ${label}: photo=${hit?.nps_photo_url ? "YES" : "NO"}`);
  }
}
main().catch((e) => { console.error("verify fatal:", e); process.exit(1); });
