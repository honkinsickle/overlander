/** READ-ONLY: for the 48 (TEST) MPs that collapsed 2+ placeholder SRs,
 *  list every linked SR with its distance_meters + coords, so a human can
 *  eyeball "same site double-mapped" vs "adjacent distinct sites". */
import { getDb } from "../ingestion/lib/db.ts";

const PLACEHOLDER_ALLOWLIST: ReadonlySet<string> = new Set([
  "campsite", "designated campsite", "designated walk-in campsite",
]);
function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (n.length === 0) return true;
  if (n.startsWith("unnamed ")) return true;
  if (PLACEHOLDER_ALLOWLIST.has(n)) return true;
  return false;
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

  // Paginate confirmed + master_place + source_record like the sibling script.
  const pmRows: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const p = await db.from("place_match").select("id, source_record_id, master_place_id, distance_meters").eq("status", "confirmed").order("id").range(from, from + PAGE - 1);
    if (p.error) { console.log("PM QUERY FAILED:", p); return; }
    pmRows.push(...(p.data ?? []));
    if ((p.data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }
  const mpMap = new Map<string, string>();
  from = 0;
  while (true) {
    const p = await db.from("master_place").select("id, canonical_name").order("id").range(from, from + PAGE - 1);
    if (p.error) { console.log("MP QUERY FAILED:", p); return; }
    for (const r of (p.data ?? []) as any[]) mpMap.set(r.id, r.canonical_name);
    if ((p.data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }
  const srMap = new Map<string, { name: string; source_id: string; external_id: string; raw_payload: any }>();
  from = 0;
  while (true) {
    const p = await db.from("source_record").select("id, name, source_id, external_id, raw_payload").order("id").range(from, from + PAGE - 1);
    if (p.error) { console.log("SR QUERY FAILED:", p); return; }
    for (const r of (p.data ?? []) as any[]) srMap.set(r.id, { name: r.name, source_id: r.source_id, external_id: r.external_id, raw_payload: r.raw_payload });
    if ((p.data?.length ?? 0) < PAGE) break;
    from += PAGE;
  }

  // Group placeholder-both confirmed rows by MP.
  const perMp = new Map<string, any[]>();
  for (const pm of pmRows) {
    const sr = srMap.get(pm.source_record_id);
    if (!sr) continue;
    if (osmOnly && sr.source_id !== "osm") continue;
    const mpName = mpMap.get(pm.master_place_id);
    if (!isPlaceholderName(sr.name)) continue;
    if (!isPlaceholderName(mpName)) continue;
    if (!perMp.has(pm.master_place_id)) perMp.set(pm.master_place_id, []);
    perMp.get(pm.master_place_id)!.push({ ...pm, sr_name: sr.name, sr_source: sr.source_id, sr_external: sr.external_id, sr_raw: sr.raw_payload, mp_name: mpName });
  }
  const collapsed = [...perMp.entries()].filter(([, arr]) => arr.length >= 2).sort((a, b) => b[1].length - a[1].length);
  console.log(`\n═══ Collapsed MPs (2+ placeholder SRs): ${collapsed.length} MPs, ${collapsed.reduce((s, [, a]) => s + a.length, 0)} SRs ═══\n`);

  // Show ALL collapse groups on TEST (≤48). On PROD, cap to top 20 to keep output readable.
  const toShow = isProd ? collapsed.slice(0, 20) : collapsed;
  for (const [mpId, arr] of toShow) {
    console.log(`\nMP ${mpId} — "${arr[0].mp_name}" (${arr.length} SRs linked)`);
    for (const pm of arr as any[]) {
      const el = pm.sr_raw?.element ?? {};
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const tags = el.tags ?? {};
      const tagStr = Object.entries(tags).map(([k, v]) => `${k}=${v}`).slice(0, 5).join(", ");
      console.log(`   dist=${pm.distance_meters.toFixed(1).padStart(6)}m  src=${pm.sr_source.padEnd(4)}  ${pm.sr_external}  "${pm.sr_name}"  @[${lat?.toFixed(5)}, ${lon?.toFixed(5)}]  tags: ${tagStr}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
