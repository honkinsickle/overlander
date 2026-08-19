/**
 * READ-ONLY TEST measurement for the NPS-sourced viewpoint reactivation.
 *
 * Establishes fresh, treating every prior figure as a report rather than fact:
 *   - inactive nps viewpoint source_record count;
 *   - linked vs unlinked split, and the distinct master_places behind the links,
 *     with their primary_category breakdown;
 *   - whether "City Hall Observation Deck" is among them;
 *   - description coverage (the claim is 100% — verified, not assumed);
 *   - the osm-sourced viewpoint rows, which must NOT be touched.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

type SR = {
  external_id: string;
  name: string;
  source_id: string;
  is_active: boolean;
  master_place_id: string | null;
  normalized_payload: { description?: unknown } | null;
};

const hasDesc = (r: SR) =>
  typeof r.normalized_payload?.description === "string" &&
  (r.normalized_payload.description as string).trim().length > 0;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY, measured now\n`);

  const page = 1000;
  const rows: SR[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("external_id, name, source_id, is_active, master_place_id, normalized_payload")
      .eq("inferred_category", "viewpoint").order("id").range(from, from + page - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan viewpoint"); }
    rows.push(...(r.data as unknown as SR[]));
    if (r.data.length < page) break;
    from += page;
  }

  const nps = rows.filter((r) => r.source_id === "nps");
  const osm = rows.filter((r) => r.source_id === "osm");
  const other = rows.filter((r) => r.source_id !== "nps" && r.source_id !== "osm");

  console.log("VIEWPOINT source_records by source");
  console.log(`  nps   total ${nps.length}   active ${nps.filter((r) => r.is_active).length}   inactive ${nps.filter((r) => !r.is_active).length}`);
  console.log(`  osm   total ${osm.length}   active ${osm.filter((r) => r.is_active).length}   inactive ${osm.filter((r) => !r.is_active).length}   <- MUST NOT BE TOUCHED`);
  if (other.length) console.log(`  other sources: ${[...new Set(other.map((r) => r.source_id))].join(", ")} (${other.length} rows)`);
  console.log(`  viewpoint total (all sources): ${rows.length}`);

  // Task 6 claim: NPS viewpoint is 100% described. Verify.
  const npsDescribed = nps.filter(hasDesc).length;
  console.log(`\nDESCRIPTION COVERAGE (the "100%" claim, verified not assumed)`);
  console.log(`  nps viewpoint rows with a non-empty description: ${npsDescribed} / ${nps.length}` +
    `  (${((npsDescribed / nps.length) * 100).toFixed(1)}%)`);
  console.log(`  osm viewpoint rows with a description          : ${osm.filter(hasDesc).length} / ${osm.length}` +
    `  (${((osm.filter(hasDesc).length / osm.length) * 100).toFixed(1)}%)`);
  const npsNoDesc = nps.filter((r) => !hasDesc(r));
  if (npsNoDesc.length) {
    console.log(`  !! ${npsNoDesc.length} nps viewpoint rows have NO description:`);
    for (const r of npsNoDesc.slice(0, 10)) console.log(`     ${r.external_id}  ${JSON.stringify(r.name)}`);
  }

  // Linked / unlinked split.
  const linked = nps.filter((r) => r.master_place_id);
  const unlinked = nps.filter((r) => !r.master_place_id);
  const mpIds = [...new Set(linked.map((r) => r.master_place_id!))];
  console.log(`\nLINKAGE`);
  console.log(`  nps viewpoint linked to a master_place : ${linked.length}`);
  console.log(`  -> distinct master_places              : ${mpIds.length}`);
  console.log(`  nps viewpoint UNLINKED (out of scope)  : ${unlinked.length}`);

  // Category breakdown of those master_places.
  const mps: { id: string; canonical_name: string; primary_category: string | null; source_count: number; is_searchable: boolean }[] = [];
  for (let i = 0; i < mpIds.length; i += 200) {
    const r = await db.from("master_place").select("id, canonical_name, primary_category, source_count, is_searchable").in("id", mpIds.slice(i, i + 200));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("mp read"); }
    mps.push(...(r.data as typeof mps));
  }
  const byCat = new Map<string, number>();
  for (const m of mps) byCat.set(m.primary_category ?? "(null)", (byCat.get(m.primary_category ?? "(null)") ?? 0) + 1);
  console.log(`\n  their primary_category breakdown (prior report said 144 viewpoint / 1 facility / 1 visitor_center):`);
  for (const [c, n] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${c.padEnd(20)} ${n}`);
  console.log(`  of those master_places: source_count=0 -> ${mps.filter((m) => m.source_count === 0).length}, >0 -> ${mps.filter((m) => m.source_count > 0).length}`);

  // How many are currently in the export view?
  let inView = 0;
  for (let i = 0; i < mpIds.length; i += 200) {
    const r = await db.from("master_place_search_export").select("id", { count: "exact", head: true }).in("id", mpIds.slice(i, i + 200));
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("view count"); }
    inView += r.count;
  }
  console.log(`  currently present in master_place_search_export: ${inView} / ${mpIds.length}`);

  // City Hall Observation Deck.
  console.log(`\nCITY HALL OBSERVATION DECK`);
  const chits = mps.filter((m) => /city hall/i.test(m.canonical_name));
  if (chits.length === 0) {
    console.log(`  NOT found among the ${mpIds.length} linked master_places — searching source_record names…`);
    const byName = nps.filter((r) => /city hall/i.test(r.name));
    for (const r of byName) console.log(`     source_record ${r.external_id} ${JSON.stringify(r.name)} active=${r.is_active} mp=${r.master_place_id}`);
    if (byName.length === 0) console.log(`     no nps viewpoint source_record matches /city hall/i either`);
  } else {
    for (const m of chits) {
      console.log(`  FOUND: ${JSON.stringify(m.canonical_name)}  id=${m.id}`);
      console.log(`     primary_category=${m.primary_category}  source_count=${m.source_count}  is_searchable=${m.is_searchable}`);
      const v = await db.from("master_place_search_export").select("id").eq("id", m.id).maybeSingle();
      if (v.error) { console.log("QUERY FAILED:", JSON.stringify(v, null, 2)); throw new Error("chod view"); }
      console.log(`     in export view now: ${v.data ? "PRESENT" : "ABSENT"}`);
      const srs = nps.filter((r) => r.master_place_id === m.id);
      for (const r of srs) console.log(`     source_record ${r.external_id} active=${r.is_active} described=${hasDesc(r)}`);
    }
  }

  // Reference-trip mention.
  const rt = await db.from("reference_trips").select("id, is_active").limit(50);
  if (rt.error || rt.data == null) { console.log("QUERY FAILED:", JSON.stringify(rt, null, 2)); throw new Error("rt"); }
  console.log(`\n  reference_trips present: ${(rt.data as { id: string; is_active: boolean }[]).map((t) => `${t.id}${t.is_active ? "" : " (inactive)"}`).join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
