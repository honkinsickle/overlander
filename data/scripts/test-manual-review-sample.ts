/** TEST-only: sample 30 pending place_match rows from the UT camping run.
 *  Report: source_record name, target master_place name, all 4 score
 *  components. Read-only. */
import { getDb } from "../ingestion/lib/db.ts";

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}\n`);

  // Most recent 30 pending place_match rows (this run's manual_reviews).
  const pm = await db
    .from("place_match")
    .select("id, source_record_id, master_place_id, distance_meters, name_similarity, category_compatibility, combined_confidence, match_method, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(30);
  if (pm.error || !pm.data) { console.log("QUERY FAILED:", pm); return; }
  const rows = pm.data as any[];
  console.log(`Sampled ${rows.length} pending place_match rows.\n`);

  const srIds = rows.map((r) => r.source_record_id);
  const mpIds = rows.map((r) => r.master_place_id);

  const srMap = new Map<string, any>();
  const srR = await db.from("source_record").select("id, name, inferred_category, external_id, raw_payload, geometry").in("id", srIds);
  if (srR.error) { console.log("SR QUERY FAILED:", srR); return; }
  for (const r of srR.data ?? []) srMap.set((r as any).id, r);

  const mpMap = new Map<string, any>();
  const mpR = await db.from("master_place").select("id, canonical_name, primary_category, geometry").in("id", mpIds);
  if (mpR.error) { console.log("MP QUERY FAILED:", mpR); return; }
  for (const r of mpR.data ?? []) mpMap.set((r as any).id, r);

  function parsePt(g: any): [number, number] | null {
    if (typeof g === "object" && g?.coordinates) return g.coordinates as [number, number];
    if (typeof g === "string") { try { return (JSON.parse(g) as any).coordinates as [number, number]; } catch { return null; } }
    return null;
  }

  for (const [i, r] of rows.entries()) {
    const sr = srMap.get(r.source_record_id);
    const mp = mpMap.get(r.master_place_id);
    const srPt = sr ? parsePt(sr.geometry) : null;
    const mpPt = mp ? parsePt(mp.geometry) : null;
    console.log(`── #${(i+1).toString().padStart(2)} ─────────────────────────────`);
    console.log(`  method     : ${r.match_method}`);
    console.log(`  conf       : ${r.combined_confidence.toFixed(3)}`);
    console.log(`  name_sim   : ${r.name_similarity.toFixed(3)}`);
    console.log(`  dist_m     : ${r.distance_meters.toFixed(1)}`);
    console.log(`  cat_compat : ${r.category_compatibility.toFixed(2)}`);
    console.log(`  SR name    : "${sr?.name ?? '?'}"  (${sr?.inferred_category ?? '?'})`);
    console.log(`     ext_id  : ${sr?.external_id ?? '?'}`);
    console.log(`     coords  : ${srPt ? `[${srPt[1].toFixed(5)}, ${srPt[0].toFixed(5)}]` : '?'}`);
    console.log(`  MP name    : "${mp?.canonical_name ?? '?'}"  (${mp?.primary_category ?? '?'})`);
    console.log(`     coords  : ${mpPt ? `[${mpPt[1].toFixed(5)}, ${mpPt[0].toFixed(5)}]` : '?'}`);
  }

  // Aggregate stats
  const methods: Record<string, number> = {};
  const nameSimBins: Record<string, number> = { "1.00 (identical)": 0, "0.85-0.99": 0, "0.60-0.84": 0, "<0.60": 0 };
  const distBins: Record<string, number> = { "0-100m": 0, "100-500m": 0, "500m-2km": 0, ">2km": 0 };
  const genericNames: Record<string, number> = {};
  for (const r of rows) {
    methods[r.match_method] = (methods[r.match_method] ?? 0) + 1;
    const ns = r.name_similarity as number;
    if (ns >= 1.0) nameSimBins["1.00 (identical)"]++;
    else if (ns >= 0.85) nameSimBins["0.85-0.99"]++;
    else if (ns >= 0.6) nameSimBins["0.60-0.84"]++;
    else nameSimBins["<0.60"]++;
    const d = r.distance_meters as number;
    if (d <= 100) distBins["0-100m"]++;
    else if (d <= 500) distBins["100-500m"]++;
    else if (d <= 2000) distBins["500m-2km"]++;
    else distBins[">2km"]++;
    const sr = srMap.get(r.source_record_id);
    const n = sr?.name ?? "?";
    if (n.startsWith("Unnamed") || n.includes("Designated Campsite") || n === "Campsite") {
      genericNames[n] = (genericNames[n] ?? 0) + 1;
    }
  }
  console.log(`\n═══ Aggregate over the 30 ═══`);
  console.log(`match_method:`, methods);
  console.log(`name_similarity bins:`, nameSimBins);
  console.log(`distance bins:`, distBins);
  console.log(`generic-name SR count:`, Object.entries(genericNames).reduce((a, [, v]) => a + v, 0), genericNames);
}
main().catch((e) => { console.error(e); process.exit(1); });
