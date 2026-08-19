/**
 * READ-ONLY TEST measurement for the toilet / water / dump_station description
 * templates. Measures current state fresh — population counts, the complete raw
 * tag census, distinct tag-set shapes, and the current
 * `normalized_payload.description` state — so the template design is grounded in
 * what is actually in the corpus right now rather than in any prior report.
 *
 * Prints the FULL tag set for every row in a small category and a strided
 * sample in a large one.
 *
 * TEST-only, no writes.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";
const CATEGORIES = ["toilet", "water", "dump_station"] as const;

/** Tags that DEFINE each category per osm.ts TAG_TO_CATEGORY — used to tell a
 *  "bare" row (category tag only) from one carrying real extra content. */
const DEFINING: Record<string, (k: string, v: string) => boolean> = {
  toilet: (k, v) => k === "amenity" && v === "toilets",
  water: (k, v) => (k === "amenity" && v === "drinking_water") || (k === "man_made" && (v === "water_well" || v === "water_tap")),
  dump_station: (k, v) => k === "amenity" && v === "sanitary_dump_station",
};

type Row = {
  external_id: string;
  name: string;
  is_active: boolean;
  inferred_category: string;
  raw_payload: { element?: { tags?: Record<string, string> } } | null;
  normalized_payload: { description?: string | null } | null;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  const page = 1000;
  for (const cat of CATEGORIES) {
    const rows: Row[] = [];
    let from = 0;
    while (true) {
      const r = await db
        .from("source_record")
        .select("external_id, name, is_active, inferred_category, raw_payload, normalized_payload")
        .eq("source_id", "osm").eq("inferred_category", cat)
        .order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan ${cat}`); }
      rows.push(...(r.data as unknown as Row[]));
      if (r.data.length < page) break;
      from += page;
    }

    const tagsOf = (x: Row) => x.raw_payload?.element?.tags ?? {};
    const def = DEFINING[cat];
    const extraOf = (x: Row) => Object.entries(tagsOf(x)).filter(([k, v]) => !def(k, v));

    console.log("=".repeat(78));
    console.log(`CATEGORY ${cat}`);
    console.log(`  population (osm, inferred_category='${cat}'): ${rows.length}`);
    console.log(`  is_active: true ${rows.filter((r) => r.is_active).length} / false ${rows.filter((r) => !r.is_active).length}`);
    const withDesc = rows.filter((r) => (r.normalized_payload?.description ?? "").trim().length > 0);
    console.log(`  normalized_payload.description already non-empty: ${withDesc.length}`);
    if (rows.length === 0) { console.log(); continue; }

    // Complete tag-key census — exhaustive, so "no X tag exists" is provable.
    const keyCount = new Map<string, number>();
    for (const r of rows) for (const k of Object.keys(tagsOf(r))) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    console.log(`\n  COMPLETE tag-key census (${keyCount.size} distinct keys):`);
    for (const [k, n] of [...keyCount.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(28)} ${String(n).padStart(5)}  (${((n / rows.length) * 100).toFixed(1)}%)`);
    }

    // Values for the tags a template would actually consume.
    const valuesFor = (key: string) => {
      const c = new Map<string, number>();
      for (const r of rows) { const v = tagsOf(r)[key]; if (v !== undefined) c.set(v, (c.get(v) ?? 0) + 1); }
      return [...c.entries()].sort((a, b) => b[1] - a[1]);
    };
    for (const k of ["toilets:disposal", "access", "fee", "wheelchair", "drinking_water", "bottle", "fountain", "waste", "water_point", "sanitary_dump_station:round_drain", "charge", "male", "female", "unisex", "changing_table", "toilets:handwashing", "portable", "operator", "seasonal", "indoor", "pump", "covered"]) {
      const vs = valuesFor(k);
      if (vs.length) console.log(`\n    values for ${k}: ${vs.map(([v, n]) => `${v}=${n}`).join("  ")}`);
    }

    const bare = rows.filter((r) => extraOf(r).length === 0).length;
    console.log(`\n  rows that are BARE (defining tag only): ${bare}/${rows.length} (${((bare / rows.length) * 100).toFixed(1)}%)`);

    // Full tag sets: every row if small, otherwise a strided sample.
    const SHOW_ALL_UNDER = 60;
    const show = rows.length <= SHOW_ALL_UNDER ? rows : rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 20)) === 0).slice(0, 20);
    console.log(`\n  FULL TAG SETS (${rows.length <= SHOW_ALL_UNDER ? `all ${rows.length}` : `${show.length} strided of ${rows.length}`}):`);
    for (const r of show) {
      console.log(`    ${r.external_id.padEnd(24)} ${JSON.stringify(tagsOf(r))}`);
    }
    console.log();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
