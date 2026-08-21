/**
 * READ-ONLY diagnosis: why do the active viewpoint source_records with no
 * master_place_id exist, and is the problem isolated to them?
 *
 * Distinguishes the two states that look alike from the source_record side:
 *   - NEVER PROCESSED  — no place_match row at all; entity resolution never ran
 *                        on this row.
 *   - PROCESSED, UNRESOLVED — a place_match row exists (status pending) with a
 *                        proposed master_place, but nothing confirmed it, so
 *                        source_record.master_place_id was never set.
 *                        `place_match.master_place_id` is NOT NULL, so a
 *                        manual_review outcome always leaves a trace.
 *
 * Also counts unlinked-but-active rows corpus-wide, to tell "88 viewpoint rows"
 * apart from "a symptom of a much larger backlog".
 *
 * No writes.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

type SR = {
  id: string; external_id: string; name: string; source_id: string;
  inferred_category: string | null; is_active: boolean; master_place_id: string | null;
  fetch_timestamp: string; created_at: string; updated_at: string;
};

type PM = {
  source_record_id: string; master_place_id: string; status: string;
  match_method: string; combined_confidence: number; distance_meters: number;
  name_similarity: number; category_compatibility: number;
  resolved_by: string | null; created_at: string;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY, no writes\n`);
  const page = 1000;

  // ── 1. The unlinked ACTIVE viewpoint rows ────────────────────────────
  const unlinked: SR[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("id, external_id, name, source_id, inferred_category, is_active, master_place_id, fetch_timestamp, created_at, updated_at")
      .eq("inferred_category", "viewpoint").eq("is_active", true).is("master_place_id", null)
      .order("id").range(from, from + page - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan unlinked"); }
    unlinked.push(...(r.data as unknown as SR[]));
    if (r.data.length < page) break;
    from += page;
  }
  const bySrc = new Map<string, SR[]>();
  for (const r of unlinked) bySrc.set(r.source_id, [...(bySrc.get(r.source_id) ?? []), r]);

  console.log("1. UNLINKED + ACTIVE viewpoint source_records");
  console.log(`   total: ${unlinked.length}`);
  for (const [s, rows] of bySrc) console.log(`     ${s}: ${rows.length}`);

  // ── Do they have place_match rows? ───────────────────────────────────
  const ids = unlinked.map((r) => r.id);
  const pms: PM[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await db.from("place_match")
      .select("source_record_id, master_place_id, status, match_method, combined_confidence, distance_meters, name_similarity, category_compatibility, resolved_by, created_at")
      .in("source_record_id", ids.slice(i, i + 100));
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("pm scan"); }
    pms.push(...(r.data as unknown as PM[]));
  }
  const withPm = new Set(pms.map((p) => p.source_record_id));
  const neverProcessed = unlinked.filter((r) => !withPm.has(r.id));
  const processedUnresolved = unlinked.filter((r) => withPm.has(r.id));

  console.log(`\n   place_match rows found for them: ${pms.length}`);
  console.log(`   -> NEVER PROCESSED (no place_match at all): ${neverProcessed.length}`);
  console.log(`   -> PROCESSED but unresolved (has place_match): ${processedUnresolved.length}`);
  if (pms.length) {
    const st = new Map<string, number>();
    for (const p of pms) st.set(`${p.status}/${p.match_method}`, (st.get(`${p.status}/${p.match_method}`) ?? 0) + 1);
    console.log(`      by status/method: ${[...st.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
  for (const [s, rows] of bySrc) {
    console.log(`      ${s}: never-processed ${rows.filter((r) => !withPm.has(r.id)).length}, processed-unresolved ${rows.filter((r) => withPm.has(r.id)).length}`);
  }

  // ── 2. Timing: when were these ingested vs their LINKED siblings? ────
  console.log("\n2. TIMING — ingest/creation times, unlinked vs linked, per source");
  for (const src of [...bySrc.keys()]) {
    const linked: SR[] = [];
    let f2 = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("id, external_id, name, source_id, inferred_category, is_active, master_place_id, fetch_timestamp, created_at, updated_at")
        .eq("inferred_category", "viewpoint").eq("source_id", src).not("master_place_id", "is", null)
        .order("id").range(f2, f2 + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("linked scan"); }
      linked.push(...(r.data as unknown as SR[]));
      if (r.data.length < page) break;
      f2 += page;
    }
    const span = (rows: SR[], f: (r: SR) => string) => {
      const v = rows.map(f).sort();
      return v.length ? `${v[0]?.slice(0, 19)} .. ${v[v.length - 1]?.slice(0, 19)}` : "(none)";
    };
    const un = bySrc.get(src)!;
    console.log(`   ${src}:`);
    console.log(`     UNLINKED (${un.length})  created_at: ${span(un, (r) => r.created_at)}`);
    console.log(`     LINKED   (${linked.length})  created_at: ${span(linked, (r) => r.created_at)}`);
    console.log(`     UNLINKED fetch_timestamp: ${span(un, (r) => r.fetch_timestamp)}`);
    console.log(`     LINKED   fetch_timestamp: ${span(linked, (r) => r.fetch_timestamp)}`);
  }

  // ── 3. Corpus-wide: is this isolated? ────────────────────────────────
  console.log("\n3. CORPUS-WIDE unlinked-but-active source_records (all categories, all sources)");
  const totalUnlinkedActive = await db.from("source_record").select("*", { count: "exact", head: true })
    .is("master_place_id", null).eq("is_active", true);
  if (totalUnlinkedActive.error || totalUnlinkedActive.count == null) { console.log("QUERY FAILED:", JSON.stringify(totalUnlinkedActive, null, 2)); throw new Error("corpus count"); }
  const totalUnlinkedAny = await db.from("source_record").select("*", { count: "exact", head: true }).is("master_place_id", null);
  if (totalUnlinkedAny.error || totalUnlinkedAny.count == null) { console.log("QUERY FAILED:", JSON.stringify(totalUnlinkedAny, null, 2)); throw new Error("corpus count 2"); }
  console.log(`   unlinked AND active : ${totalUnlinkedActive.count}`);
  console.log(`   unlinked, any state : ${totalUnlinkedAny.count}`);
  console.log(`   => the 88 viewpoint rows are ${((unlinked.length / totalUnlinkedActive.count) * 100).toFixed(1)}% of the unlinked-active population`);

  // Break the unlinked-active population down.
  const allUnlinked: { source_id: string; inferred_category: string | null }[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record").select("source_id, inferred_category")
      .is("master_place_id", null).eq("is_active", true).order("id").range(from, from + page - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("corpus scan"); }
    allUnlinked.push(...(r.data as { source_id: string; inferred_category: string | null }[]));
    if (r.data.length < page) break;
    from += page;
  }
  const bySource = new Map<string, number>(), byCat = new Map<string, number>();
  for (const r of allUnlinked) {
    bySource.set(r.source_id, (bySource.get(r.source_id) ?? 0) + 1);
    byCat.set(r.inferred_category ?? "(null)", (byCat.get(r.inferred_category ?? "(null)") ?? 0) + 1);
  }
  console.log(`\n   by source_id:`);
  for (const [k, v] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(18)} ${v}`);
  console.log(`   by inferred_category (top 15):`);
  for (const [k, v] of [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`     ${k.padEnd(22)} ${v}`);

  // How many of the corpus-wide unlinked-active have a place_match?
  const allIds: string[] = [];
  from = 0;
  while (true) {
    const r = await db.from("source_record").select("id").is("master_place_id", null).eq("is_active", true).order("id").range(from, from + page - 1);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("ids"); }
    allIds.push(...(r.data as { id: string }[]).map((x) => x.id));
    if (r.data.length < page) break;
    from += page;
  }
  let pmCount = 0;
  for (let i = 0; i < allIds.length; i += 100) {
    const r = await db.from("place_match").select("source_record_id", { count: "exact", head: true }).in("source_record_id", allIds.slice(i, i + 100));
    if (r.error || r.count == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("pm corpus"); }
    pmCount += r.count;
  }
  console.log(`\n   of the ${allIds.length} unlinked-active rows, ${pmCount} have a place_match row`);
  console.log(`   => never-processed corpus-wide: ${allIds.length - pmCount}`);

  // ── The 5 osm ids, enumerated ────────────────────────────────────────
  console.log("\n   the osm unlinked ids:");
  for (const r of bySrc.get("osm") ?? []) console.log(`     ${r.external_id}  created=${r.created_at.slice(0, 19)}  ${JSON.stringify(r.name)}`);
  console.log("\n   nps unlinked ids (first 12 of the slice):");
  for (const r of (bySrc.get("nps") ?? []).slice(0, 12)) console.log(`     ${r.external_id}  created=${r.created_at.slice(0, 19)}  ${JSON.stringify(r.name)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
