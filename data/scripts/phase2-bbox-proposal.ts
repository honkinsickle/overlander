/** Phase 2 bbox proposal. READ-only.
 *  - Overpass count for 4 tag combos in the proposed bbox
 *  - Current TEST source_record count for the same 4 tag patterns
 *  Reports both; makes no writes; runs no ingestion.  */
import { getDb } from "../ingestion/lib/db.ts";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const UA = "overlander-diagnostic/0.0.1 (bbox proposal)";

async function overpassCount(query: string): Promise<number> {
  let lastErr: unknown = null;
  for (const url of MIRRORS) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 180_000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctl.signal,
      });
      clearTimeout(to);
      if (!res.ok) { lastErr = new Error(`${res.status} @ ${url}`); continue; }
      const json = (await res.json()) as { elements?: Array<{ tags?: { total?: string; nodes?: string } }> };
      const el = json.elements?.[0];
      return Number(el?.tags?.total ?? el?.tags?.nodes ?? "0");
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function main() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (${ref})`);
  console.log(`[env] TEST ${ref}`);

  // Proposed bbox: SW Arizona / SE California / south NV — the RV-heavy region
  // the earlier session's bbox (-120,35,-114,37) explicitly misses.
  const bbox = { w: -116.5, s: 32.5, e: -111.0, n: 35.0 };
  const bboxLabel = `${bbox.w},${bbox.s},${bbox.e},${bbox.n}`;
  const overpassBbox = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`; // Overpass wants s,w,n,e
  console.log(`\n[proposed bbox] ${bboxLabel} (W,S,E,N)`);
  console.log(`  covers: Quartzsite · Yuma · Wickenburg · Phoenix Metro · Slab City · Salton Sea · Anza-Borrego · JT · Havasu · Blythe · Ehrenberg · Kingman`);
  console.log(`  size: ${(bbox.e - bbox.w).toFixed(1)}° wide × ${(bbox.n - bbox.s).toFixed(1)}° tall`);

  // ─── Predicted yield: Overpass counts ─────────────────────────────
  console.log(`\n[overpass counts — nodes only, in proposed bbox]`);
  const q = (predicate: string) => `[out:json][timeout:180];\nnode${predicate}(${overpassBbox});\nout count;`;

  const p1 = await overpassCount(q(`["amenity"="sanitary_dump_station"]`));
  console.log(`  amenity=sanitary_dump_station                    : ${p1}`);
  const p2 = await overpassCount(q(`["tourism"="camp_site"]["backcountry"="yes"]`));
  console.log(`  tourism=camp_site + backcountry=yes              : ${p2}`);
  const p3 = await overpassCount(q(`["tourism"="camp_site"]["informal"="yes"]`));
  console.log(`  tourism=camp_site + informal=yes                 : ${p3}`);
  const p4 = await overpassCount(q(`["amenity"="waste_disposal"]`));
  console.log(`  amenity=waste_disposal (REMOVED from adapter)    : ${p4}   (would land 0 after fix)`);

  // ─── Current TEST source_records for the same 4 patterns ──────────
  console.log(`\n[current TEST osm source_records — count by tag]`);
  const rows: { raw_payload: { element?: { tags?: Record<string, string> } } | null }[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("raw_payload")
      .eq("source_id", "osm")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as typeof rows;
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  console.log(`  (scanned ${rows.length} osm source_records on TEST)`);

  const c1 = rows.filter((r) => r.raw_payload?.element?.tags?.amenity === "sanitary_dump_station").length;
  const c2 = rows.filter((r) => r.raw_payload?.element?.tags?.tourism === "camp_site" && r.raw_payload?.element?.tags?.backcountry === "yes").length;
  const c3 = rows.filter((r) => r.raw_payload?.element?.tags?.tourism === "camp_site" && r.raw_payload?.element?.tags?.informal === "yes").length;
  const c4 = rows.filter((r) => r.raw_payload?.element?.tags?.amenity === "waste_disposal").length;
  console.log(`  amenity=sanitary_dump_station                    : ${c1}`);
  console.log(`  tourism=camp_site + backcountry=yes              : ${c2}`);
  console.log(`  tourism=camp_site + informal=yes                 : ${c3}`);
  console.log(`  amenity=waste_disposal                           : ${c4}`);

  console.log(`\n[predicted delta after Phase 2 ingest of proposed bbox]`);
  console.log(`  sanitary_dump_station    : ${c1} → ${c1 + p1}    (+${p1})`);
  console.log(`  camp_site + backcountry  : ${c2} → ${c2 + p2}    (+${p2})`);
  console.log(`  camp_site + informal     : ${c3} → ${c3 + p3}    (+${p3})`);
  console.log(`  waste_disposal (removed) : ${c4} → ${c4}   (+0; corrected adapter no longer requests)`);
  console.log(`\n[bbox-scoped predictions above are for the SW-AZ bbox only, not full-corridor. Actual totals will depend on RIDB sub-tile overlap dedup + adapter's own 50km cell splitter.]`);
}
main().catch((e) => { console.error(e); process.exit(1); });
