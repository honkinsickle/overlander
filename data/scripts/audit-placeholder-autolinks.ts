/** READ-ONLY: quantify pre-existing confirmed place_match rows on the
 *  active project where BOTH the source_record.name and the
 *  master_place.canonical_name are placeholders per the isPlaceholderName
 *  rule. Reports total, distance-bin histogram, MP-collapse counts, and
 *  10 tightest (0-25m) samples with coords + tags. Works on TEST or PROD;
 *  --iso-scoped by SUPABASE_URL, allows --allow-prod to prevent accidental
 *  runs.
 *
 *  Runs the same isPlaceholderName as the matcher fix — inlined here so
 *  this script works on chore/prod-scope-diagnostics without the matcher
 *  branch checked out. */
import { getDb } from "../ingestion/lib/db.ts";

const PLACEHOLDER_ALLOWLIST: ReadonlySet<string> = new Set([
  "campsite",
  "designated campsite",
  "designated walk-in campsite",
]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
}

function parsePt(g: any): [number, number] | null {
  if (typeof g === "object" && g?.coordinates) return g.coordinates as [number, number];
  if (typeof g === "string") { try { return (JSON.parse(g) as any).coordinates as [number, number]; } catch { return null; } }
  return null;
}

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  const allowProd = process.argv.includes("--allow-prod");
  const isProd = ref === "nqzeywzcowujzyegxbsr";
  const isTest = ref === "znldzjdatkogdktymtvi";
  if (!isProd && !isTest) throw new Error(`Refusing: unknown project ${ref}`);
  if (isProd && !allowProd) throw new Error(`Refusing: PROD without --allow-prod`);
  const osmOnly = process.argv.includes("--osm-only");
  console.log(`[env] ${isProd ? "PROD" : "TEST"} ${ref}  ${osmOnly ? "(OSM only)" : "(all sources)"}`);
  console.log(`[read_at_utc_wallclock] ${new Date().toISOString()}\n`);

  // 1. Paginate all confirmed place_match rows.
  const pmRows: { id: string; source_record_id: string; master_place_id: string; distance_meters: number }[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const p = await db
      .from("place_match")
      .select("id, source_record_id, master_place_id, distance_meters")
      .eq("status", "confirmed")
      .order("id")
      .range(from, from + PAGE - 1);
    if (p.error) { console.log("PM QUERY FAILED:", p); return; }
    const batch = (p.data ?? []) as any[];
    pmRows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Loaded ${pmRows.length} confirmed place_match rows.`);

  // 2. Paginate all master_places (id, canonical_name).
  const mpMap = new Map<string, string>();
  from = 0;
  while (true) {
    const p = await db.from("master_place").select("id, canonical_name").order("id").range(from, from + PAGE - 1);
    if (p.error) { console.log("MP QUERY FAILED:", p); return; }
    for (const r of (p.data ?? []) as any[]) mpMap.set(r.id, r.canonical_name);
    if ((p.data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }
  console.log(`Loaded ${mpMap.size} master_places.`);

  // 3. Paginate all source_records (id, name, source_id).
  const srMap = new Map<string, { name: string; source_id: string }>();
  from = 0;
  while (true) {
    const p = await db.from("source_record").select("id, name, source_id").order("id").range(from, from + PAGE - 1);
    if (p.error) { console.log("SR QUERY FAILED:", p); return; }
    for (const r of (p.data ?? []) as any[]) srMap.set(r.id, { name: r.name, source_id: r.source_id });
    if ((p.data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }
  console.log(`Loaded ${srMap.size} source_records.\n`);

  // 4. Filter to BOTH-placeholder confirmed rows (optionally OSM-only on SR side).
  const bothPlaceholder: typeof pmRows = [];
  for (const pm of pmRows) {
    const sr = srMap.get(pm.source_record_id);
    if (!sr) continue;
    if (osmOnly && sr.source_id !== "osm") continue;
    const mpName = mpMap.get(pm.master_place_id);
    if (!isPlaceholderName(sr.name)) continue;
    if (!isPlaceholderName(mpName)) continue;
    bothPlaceholder.push(pm);
  }

  console.log(`═══ confirmed place_match where BOTH names are placeholders ═══`);
  console.log(`total: ${bothPlaceholder.length}${osmOnly ? " (OSM source_records only)" : ""}`);

  // 5. Distance bins.
  const bins = { "0-25m": 0, "25-50m": 0, "50-100m": 0, ">100m": 0 };
  for (const pm of bothPlaceholder) {
    const d = pm.distance_meters;
    if (d <= 25) bins["0-25m"]++;
    else if (d <= 50) bins["25-50m"]++;
    else if (d <= 100) bins["50-100m"]++;
    else bins[">100m"]++;
  }
  console.log("distance bins:", bins);

  // 6. MPs with 2+ placeholder SRs linked (collapse count).
  const perMp = new Map<string, number>();
  for (const pm of bothPlaceholder) {
    perMp.set(pm.master_place_id, (perMp.get(pm.master_place_id) ?? 0) + 1);
  }
  const collapses = [...perMp.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  const totalCollapseMPs = collapses.length;
  const largest = collapses[0]?.[1] ?? 0;
  const bySize: Record<string, number> = { "2": 0, "3-4": 0, "5-9": 0, "10-19": 0, "20+": 0 };
  for (const [, c] of collapses) {
    if (c === 2) bySize["2"]++;
    else if (c <= 4) bySize["3-4"]++;
    else if (c <= 9) bySize["5-9"]++;
    else if (c <= 19) bySize["10-19"]++;
    else bySize["20+"]++;
  }
  const affectedSRs = bothPlaceholder.filter((pm) => (perMp.get(pm.master_place_id) ?? 0) >= 2).length;
  console.log(`\n═══ MP collapse counts (MPs holding 2+ placeholder SRs) ═══`);
  console.log(`  distinct MPs with 2+ placeholder SRs   : ${totalCollapseMPs}`);
  console.log(`  SRs sitting on those collapsed MPs     : ${affectedSRs}`);
  console.log(`  largest collapse (SRs on one MP)       : ${largest}`);
  console.log(`  by collapse size                       :`, bySize);

  return { bothPlaceholder, srMap, mpMap };
}

async function spotCheckTightest(env: string) {
  const r = await main();
  if (!r) return;
  if (env !== "TEST") return; // spot-check output only on TEST per prompt
  const db = getDb();
  const tight = r.bothPlaceholder.filter((pm) => pm.distance_meters <= 25).slice(0, 10);
  if (tight.length === 0) { console.log("\n(no rows in 0-25m bin to spot-check)"); return; }
  const srR = await db.from("source_record").select("id, external_id, name, raw_payload, geometry").in("id", tight.map((t) => t.source_record_id));
  const mpR = await db.from("master_place").select("id, canonical_name, primary_category, geometry").in("id", tight.map((t) => t.master_place_id));
  const srMap = new Map<string, any>();
  for (const r of srR.data ?? []) srMap.set((r as any).id, r);
  const mpMap = new Map<string, any>();
  for (const r of mpR.data ?? []) mpMap.set((r as any).id, r);
  console.log(`\n═══ 10 tightest (0-25m) samples ═══`);
  for (const [i, pm] of tight.entries()) {
    const sr = srMap.get(pm.source_record_id);
    const mp = mpMap.get(pm.master_place_id);
    const el = sr?.raw_payload?.element ?? {};
    const srLat = el.lat ?? el.center?.lat;
    const srLon = el.lon ?? el.center?.lon;
    const mpPt = mp ? parsePt(mp.geometry) : null;
    console.log(`── #${(i+1).toString().padStart(2)} ─────`);
    console.log(`  dist=${pm.distance_meters.toFixed(1)}m`);
    console.log(`  SR ${sr?.external_id}: "${sr?.name}" @ [${srLat?.toFixed(5)}, ${srLon?.toFixed(5)}]`);
    console.log(`     tags: ${JSON.stringify(el.tags ?? {})}`);
    console.log(`  MP "${mp?.canonical_name}" (${mp?.primary_category}) @ [${mpPt?.[1]?.toFixed(5)}, ${mpPt?.[0]?.toFixed(5)}]`);
  }
}

const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
const label = ref === "nqzeywzcowujzyegxbsr" ? "PROD" : "TEST";
spotCheckTightest(label).catch((e) => { console.error(e); process.exit(1); });
