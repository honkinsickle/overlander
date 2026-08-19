/**
 * READ-ONLY investigation: what is actually in the osm viewpoint rows that carry
 * a non-null `normalized_payload.description`?
 *
 * Why it matters: a pending decision would reactivate "the ones with
 * descriptions" on the assumption that a non-null description means real,
 * human-written visitor content. That assumption has never been checked.
 *
 * Provenance is directly answerable here. `normalizeOsm` sets
 *   description = tags.description ?? tags.note ?? template
 * and viewpoint is NOT a templated category, so every value came from either a
 * `description` tag or a `note` tag. OSM convention treats `note` as
 * mapper-to-mapper editorial commentary, NOT visitor-facing text — so the split
 * matters a great deal.
 *
 * No writes. Nothing is filtered or applied; thresholds are only proposed.
 */
import { createClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";

type Row = {
  external_id: string;
  name: string;
  is_active: boolean;
  master_place_id: string | null;
  normalized_payload: { description?: unknown } | null;
  raw_payload: { element?: { tags?: Record<string, string> } } | null;
};

/** Strip the trailing "(Viewpoint)"-style suffix and punctuation for comparison. */
const norm = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*$/, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.log(`[env] TEST ${ref} — READ-ONLY, no writes\n`);

  const all: Row[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("external_id, name, is_active, master_place_id, normalized_payload, raw_payload")
      .eq("source_id", "osm").eq("inferred_category", "viewpoint").order("id").range(from, from + 999);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("scan"); }
    all.push(...(r.data as unknown as Row[]));
    if (r.data.length < 1000) break;
    from += 1000;
  }

  const described = all.filter((r) => {
    const d = r.normalized_payload?.description;
    return typeof d === "string" && d.trim().length > 0;
  });
  const desc = (r: Row) => (r.normalized_payload!.description as string).trim();
  const tags = (r: Row) => r.raw_payload?.element?.tags ?? {};

  console.log("POPULATION (fresh)");
  console.log(`  osm viewpoint source_records total     : ${all.length}`);
  console.log(`  with a non-empty description           : ${described.length}`);
  console.log(`  active right now                       : ${described.filter((r) => r.is_active).length}`);
  console.log(`  linked to a master_place               : ${described.filter((r) => r.master_place_id).length}`);
  console.log(`  distinct master_places behind them     : ${new Set(described.filter((r) => r.master_place_id).map((r) => r.master_place_id)).size}`);

  // ── PROVENANCE: description tag vs note tag ───────────────────────────
  let fromDesc = 0, fromNote = 0, fromNeither = 0;
  const noteRows: Row[] = [];
  for (const r of described) {
    const t = tags(r);
    if (t.description != null && t.description.trim() === desc(r)) fromDesc += 1;
    else if (t.note != null && t.note.trim() === desc(r)) { fromNote += 1; noteRows.push(r); }
    else fromNeither += 1;
  }
  console.log(`\nPROVENANCE — which raw tag produced the description`);
  console.log(`  from a \`description\` tag : ${fromDesc}  (${((fromDesc / described.length) * 100).toFixed(1)}%)`);
  console.log(`  from a \`note\` tag        : ${fromNote}  (${((fromNote / described.length) * 100).toFixed(1)}%)   <- mapper-to-mapper by OSM convention`);
  console.log(`  matched neither exactly   : ${fromNeither}`);

  // ── LENGTH DISTRIBUTION ───────────────────────────────────────────────
  const lens = described.map((r) => desc(r).length).sort((a, b) => a - b);
  const pct = (p: number) => lens[Math.min(lens.length - 1, Math.floor(lens.length * p))];
  console.log(`\nLENGTH (characters)`);
  console.log(`  min ${lens[0]}  p25 ${pct(0.25)}  median ${pct(0.5)}  p75 ${pct(0.75)}  p90 ${pct(0.9)}  max ${lens[lens.length - 1]}`);
  for (const t of [20, 30, 40, 60, 80, 120]) {
    const under = described.filter((r) => desc(r).length < t).length;
    console.log(`  under ${String(t).padStart(3)} chars: ${String(under).padStart(4)}  (${((under / described.length) * 100).toFixed(1)}%)   at-or-over: ${described.length - under}`);
  }

  // ── JUNK PATTERNS ─────────────────────────────────────────────────────
  const nameRestate = described.filter((r) => {
    const d = norm(desc(r)), n = norm(r.name);
    return d.length > 0 && (d === n || (n.length > 3 && (d.includes(n) || n.includes(d))) );
  });
  const veryShort = described.filter((r) => desc(r).length < 40);
  const singleWord = described.filter((r) => desc(r).trim().split(/\s+/).length === 1);
  const urlish = described.filter((r) => /^https?:\/\//i.test(desc(r)));
  const mapperish = described.filter((r) => /\b(fixme|survey|check|verify|todo|imagery|resurvey|approximate|not sure|guess|need to|added from|source:|bing|maxar|josm)\b/i.test(desc(r)));

  console.log(`\nPATTERN FLAGS (heuristic — samples shown below so you can judge)`);
  console.log(`  description ~ the place's own name : ${nameRestate.length}`);
  console.log(`  shorter than 40 chars              : ${veryShort.length}`);
  console.log(`  a single word                      : ${singleWord.length}`);
  console.log(`  starts with a URL                  : ${urlish.length}`);
  console.log(`  mapper-ish vocabulary              : ${mapperish.length}`);

  // ── VERBATIM SAMPLES ──────────────────────────────────────────────────
  function dump(label: string, rows: Row[], n: number) {
    console.log(`\n${"─".repeat(74)}\n${label}  (${rows.length} rows${rows.length > n ? `, showing ${n}` : ""})`);
    const stride = Math.max(1, Math.floor(rows.length / n));
    for (const r of rows.filter((_, i) => i % stride === 0).slice(0, n)) {
      const t = tags(r);
      const src = t.description != null && t.description.trim() === desc(r) ? "description" : t.note != null && t.note.trim() === desc(r) ? "NOTE" : "?";
      console.log(`  ${r.external_id}  name=${JSON.stringify(r.name)}  [from ${src} tag, ${desc(r).length} chars]`);
      console.log(`     ${JSON.stringify(desc(r))}`);
    }
  }

  dump("A. FROM A `note` TAG — mapper-to-mapper by convention", noteRows, 15);
  const descRows = described.filter((r) => { const t = tags(r); return t.description != null && t.description.trim() === desc(r); });
  dump("B. FROM A `description` TAG, 40+ chars — the best case", descRows.filter((r) => desc(r).length >= 40), 15);
  dump("C. FROM A `description` TAG, under 40 chars", descRows.filter((r) => desc(r).length < 40), 15);
  dump("D. FLAGGED: description ~ the place's own name", nameRestate, 12);

  // ── PROPOSED THRESHOLD (proposed only, NOT applied) ───────────────────
  const survives = described.filter((r) => {
    const t = tags(r);
    const fromDescTag = t.description != null && t.description.trim() === desc(r);
    const d = desc(r), n = norm(r.name);
    const restate = norm(d) === n || (n.length > 3 && norm(d) === n);
    return fromDescTag && d.length >= 40 && !restate;
  });
  console.log(`\n${"═".repeat(74)}`);
  console.log(`PROPOSED FILTER (NOT APPLIED): from a \`description\` tag AND >= 40 chars AND not a name restatement`);
  console.log(`  would survive: ${survives.length} of ${described.length}`);
  console.log(`  distinct master_places behind survivors: ${new Set(survives.filter((r) => r.master_place_id).map((r) => r.master_place_id)).size}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
