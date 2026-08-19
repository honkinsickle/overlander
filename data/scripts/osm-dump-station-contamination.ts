/**
 * READ-ONLY TEST follow-up to osm-tag-richness-investigation.ts.
 *
 * That script reported dump_station at 93.3% "has >=1 meaningful tag" — an
 * APPARATUS ARTIFACT, not a data fact. Its defining-tag predicate for
 * dump_station is `amenity=sanitary_dump_station`, so on a row misclassified
 * under the pre-#202 `amenity=waste_disposal -> dump_station` mapping the
 * `amenity` key itself was counted as an "additional meaningful tag."
 *
 * This re-measures dump_station split by which tag actually produced the
 * category, so the richness figure is about real RV dump stations.
 * (The waste_disposal mis-mapping is documented on PROD in docs/STATE.md
 * 2026-08-10 — 1,723 rows; this measures the TEST side.)
 *
 * READ-ONLY. TEST only.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

const NOISE_EXACT = new Set(["name", "created_by", "note", "fixme", "source", "attribution", "check_date", "survey", "ref", "wikidata", "wikipedia", "image", "url"]);
const NOISE_PREFIX = ["name:", "source:", "note:", "check_date:", "ref:", "gnis:", "tiger:", "nhd:", "alt_name", "old_name"];
const isNoise = (k: string) => NOISE_EXACT.has(k) || NOISE_PREFIX.some((p) => k.startsWith(p));

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY\n`);

  const r = await db
    .from("source_record")
    .select("external_id, name, raw_payload")
    .eq("source_id", "osm")
    .eq("inferred_category", "dump_station")
    .order("id");
  if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); process.exit(1); }

  const rows = r.data as unknown as { external_id: string; name: string | null; raw_payload: { element?: { tags?: Record<string, string> } } | null }[];

  const groups = new Map<string, { total: number; rich: number; keys: Map<string, number> }>();
  for (const row of rows) {
    const tags = row.raw_payload?.element?.tags ?? {};
    const amenity = tags.amenity ?? "(no amenity tag)";
    const g = groups.get(amenity) ?? { total: 0, rich: 0, keys: new Map() };
    g.total += 1;
    // Additional tags = everything except the amenity key that DEFINED the row.
    const extra = Object.keys(tags).filter((k) => k !== "amenity" && !isNoise(k));
    if (extra.length > 0) g.rich += 1;
    for (const k of extra) g.keys.set(k, (g.keys.get(k) ?? 0) + 1);
    groups.set(amenity, g);
  }

  console.log(`dump_station population on TEST: ${rows.length} osm source_records`);
  console.log(`split by the amenity tag that actually produced the category:\n`);
  for (const [amenity, g] of [...groups.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const pct = ((g.rich / g.total) * 100).toFixed(1);
    console.log(`  amenity=${amenity}`);
    console.log(`    rows: ${g.total}`);
    console.log(`    with >=1 genuinely additional tag: ${g.rich}/${g.total} (${pct}%)`);
    const top = [...g.keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`    additional tag keys: ${top.length ? top.map(([k, n]) => `${k}=${n}`).join("  ") : "(none)"}`);
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
