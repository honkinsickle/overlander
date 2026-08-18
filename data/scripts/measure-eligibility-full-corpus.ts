/**
 * Read-only, TEST-only: full corpus-wide STRONG/WEAK/NONE eligibility
 * bucketing, EVERY category (not the top-N/n>=100 subset the original
 * measure-llm-eligibility.ts reported). Same bucketing logic, reused
 * verbatim (isStrong = has_wikipedia || has_website || has_meaningful_tags;
 * isWeak = !isStrong && (has_phone || has_hours); else NONE) — already
 * verified to hold up in the peak/spring/viewpoint/fire_pit/dump_station
 * pilot work.
 *
 * Adds, beyond the original script:
 *   - every category, not just n>=100
 *   - per-category is_searchable flag (land_status is entirely
 *     search-excluded — flagged, not silently blended in as if it were a
 *     normal user-facing gap)
 *   - per-category, per-source-id NONE-rate breakdown (does this category's
 *     source composition matter?)
 *
 * Does NOT compute per-state breakdown (not needed here, and skipping the
 * master_place_search_export geometry join meaningfully speeds up a
 * full-corpus run).
 *
 * NOT modifying anything.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const PAGE = 1000; // PostgREST caps responses at 1000 regardless of requested range — a
                    // larger PAGE here silently clamps, and a naive `data.length < PAGE`
                    // exit check then mistakes the clamped page for the last one.

const MEANINGFUL_OSM_KEYS = new Set([
  "description", "note",
  "historic_name", "historic:name", "heritage",
  "operator",
  "cuisine",
  "name:en", "alt_name",
  "wikipedia", "wikidata",
]);

type SR = {
  master_place_id: string | null;
  source_id: string;
  has_website: boolean;
  has_phone: boolean;
  has_hours: boolean;
  has_wikipedia: boolean;
  has_wikidata: boolean;
  meaningful_tag_count: number;
  raw_tag_count: number;
  // Separate from the bucketing signals above (which is deliberately
  // reused verbatim from measure-llm-eligibility.ts / the prior pilot).
  // IMPORTANT: has_meaningful_tags checks for a literal "description" TAG
  // KEY inside OSM's raw tags dict — it does NOT check whether
  // normalized_payload.description itself is populated. For non-OSM
  // sources (USFS, NPS, RIDB) that write real prose into
  // normalized_payload.description but have none of the other signals,
  // this makes the STRONG/WEAK/NONE bucket answer a DIFFERENT question
  // ("is there rich raw material to generate a description from") than
  // "does this place already have a description" — tracked here
  // separately so the two don't get silently conflated.
  has_real_description: boolean;
};

function computeSignals(np: any, rp: any) {
  np = np ?? {};
  rp = rp ?? {};
  const contact = np.contact ?? {};
  const npHours = np.hours ?? np.opening_hours;
  const rawTags: Record<string, unknown> =
    (rp.element?.tags && typeof rp.element.tags === "object" && !Array.isArray(rp.element.tags))
      ? rp.element.tags
      : (rp.tags && typeof rp.tags === "object" && !Array.isArray(rp.tags)) ? rp.tags : {};
  const rawTagKeys = Object.keys(rawTags);
  let meaningful = 0;
  for (const k of rawTagKeys) if (MEANINGFUL_OSM_KEYS.has(k)) meaningful++;
  return {
    has_website: !!(contact.website ?? np.website ?? (rawTags as any).website ?? (rawTags as any).url),
    has_phone: !!(contact.phone ?? np.phone ?? (rawTags as any).phone),
    has_hours: !!(
      (typeof npHours === "string" && npHours.length > 0) ||
      (npHours && typeof npHours === "object" && Object.keys(npHours).length > 0) ||
      (rawTags as any).opening_hours
    ),
    has_wikipedia: !!(np.wikipedia ?? (rawTags as any).wikipedia),
    has_wikidata: !!(np.wikidata ?? (rawTags as any).wikidata),
    meaningful_tag_count: meaningful,
    raw_tag_count: rawTagKeys.length,
    // Literal presence check — does NOT distinguish real prose from a
    // templated placeholder (e.g. USFS's "NAME (Trailhead)" pattern,
    // observed directly in the spot-check, is non-null but not
    // informative). Presence only; quality is a separate, unmeasured axis.
    has_real_description: typeof np.description === "string" && np.description.trim().length > 0,
  };
}

async function fetchSRSignals(db: SupabaseClient): Promise<SR[]> {
  const rows: SR[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error("sr fetch failed"); }
    for (const raw of r.data as any[]) {
      const s = computeSignals(raw.normalized_payload, raw.raw_payload);
      rows.push({ master_place_id: raw.master_place_id, source_id: raw.source_id, ...s });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) console.log(`  ... sr ${from}`);
  }
  return rows;
}

async function fetchMPs(db: SupabaseClient): Promise<{ id: string; primary_category: string; is_searchable: boolean }[]> {
  const mps: any[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, primary_category, is_searchable")
      .order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) console.log(`  ... mp ${from}`);
  }
  return mps;
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Cross-check totals against a head-count query BEFORE trusting the
  // paginated fetch — a pagination bug (e.g. PAGE exceeding PostgREST's
  // 1000-row cap) silently returns a truncated result that looks like a
  // complete small page. A mismatch here means the fetch is wrong, not
  // that the corpus shrank.
  const mpCount = await db.from("master_place").select("id", { count: "exact", head: true });
  const srCount = await db.from("source_record").select("id", { count: "exact", head: true }).eq("is_active", true);
  console.log(`Expected totals (head-count): master_place=${mpCount.count}  active source_record=${srCount.count}`);

  console.log("Fetching master_place...");
  const mps = await fetchMPs(db);
  console.log(`  total: ${mps.length}`);
  if (mpCount.count != null && mps.length !== mpCount.count) {
    throw new Error(`PAGINATION MISMATCH: fetched ${mps.length} master_place rows but head-count says ${mpCount.count}`);
  }

  console.log("Fetching source_record signals...");
  const srs = await fetchSRSignals(db);
  console.log(`  total active source_records: ${srs.length}`);
  if (srCount.count != null && srs.length !== srCount.count) {
    throw new Error(`PAGINATION MISMATCH: fetched ${srs.length} active source_records but head-count says ${srCount.count}`);
  }

  // Aggregate per-MP (across ALL its sources) for the bucket decision, AND
  // keep per-(MP, source_id) so we can compute a per-source NONE rate too.
  type MPSig = { has_wikipedia: boolean; has_website: boolean; has_hours: boolean; has_phone: boolean; has_meaningful: boolean; has_real_description: boolean; sourceIds: Set<string> };
  const sigs = new Map<string, MPSig>();
  const bySourceForMp = new Map<string, Map<string, ReturnType<typeof computeSignals>>>(); // mp -> source_id -> that source's own signals

  for (const sr of srs) {
    if (!sr.master_place_id) continue;
    let s = sigs.get(sr.master_place_id);
    if (!s) { s = { has_wikipedia: false, has_website: false, has_hours: false, has_phone: false, has_meaningful: false, has_real_description: false, sourceIds: new Set() }; sigs.set(sr.master_place_id, s); }
    s.sourceIds.add(sr.source_id);
    s.has_wikipedia ||= sr.has_wikipedia || sr.has_wikidata;
    s.has_website ||= sr.has_website;
    s.has_hours ||= sr.has_hours;
    s.has_phone ||= sr.has_phone;
    s.has_meaningful ||= (sr.meaningful_tag_count >= 1) || (sr.raw_tag_count >= 5);
    s.has_real_description ||= sr.has_real_description;

    let bySource = bySourceForMp.get(sr.master_place_id);
    if (!bySource) { bySource = new Map(); bySourceForMp.set(sr.master_place_id, bySource); }
    bySource.set(sr.source_id, sr); // if a MP has 2 SRs from the same source (shouldn't happen), last wins — fine for this diagnostic
  }

  function bucketOf(s: MPSig): "STRONG" | "WEAK" | "NONE" {
    const isStrong = s.has_wikipedia || s.has_website || s.has_meaningful;
    if (isStrong) return "STRONG";
    const isWeak = s.has_phone || s.has_hours;
    return isWeak ? "WEAK" : "NONE";
  }

  // ── Per-category rollup ──
  type CatRow = {
    category: string;
    is_searchable_any: boolean;
    is_searchable_all: boolean;
    total: number;
    withSR: number;
    strong: number;
    weak: number;
    none: number;
    hasRealDescription: number;
    bySource: Record<string, { n: number; none: number; hasDesc: number }>;
  };
  const byCat = new Map<string, CatRow>();

  for (const m of mps) {
    let row = byCat.get(m.primary_category);
    if (!row) {
      row = { category: m.primary_category, is_searchable_any: false, is_searchable_all: true, total: 0, withSR: 0, strong: 0, weak: 0, none: 0, hasRealDescription: 0, bySource: {} };
      byCat.set(m.primary_category, row);
    }
    row.total++;
    row.is_searchable_any ||= m.is_searchable;
    row.is_searchable_all &&= m.is_searchable;

    const s = sigs.get(m.id);
    if (!s) continue; // no active source_record at all — excluded from bucketing (matches original script's "MPs with at least one active SR")
    row.withSR++;
    const bucket = bucketOf(s);
    if (bucket === "STRONG") row.strong++;
    else if (bucket === "WEAK") row.weak++;
    else row.none++;
    if (s.has_real_description) row.hasRealDescription++;

    // Per-source breakdown: for each source_id backing this MP, does the
    // OVERALL (multi-source) bucket land as NONE? (Answers "if this
    // category is backed by source X, how often is the aggregate result
    // still NONE" — the composition question task 3 asks about.)
    const bySource = bySourceForMp.get(m.id);
    if (bySource) {
      for (const [srcId, srSignal] of bySource.entries()) {
        const bs = row.bySource[srcId] ?? { n: 0, none: 0, hasDesc: 0 };
        bs.n++;
        if (bucket === "NONE") bs.none++;
        // This source's OWN description presence, not the MP-level
        // aggregate — answers "does THIS source write real descriptions",
        // distinct from whether the whole place ends up NONE overall.
        if (srSignal.has_real_description) bs.hasDesc++;
        row.bySource[srcId] = bs;
      }
    }
  }

  const rows = [...byCat.values()];

  console.log(`\n\nDistinct categories: ${rows.length}`);
  console.log(`\nhasDesc% = fraction with normalized_payload.description populated (literal presence,`);
  console.log(`NOT part of the STRONG/WEAK/NONE bucket definition — see has_real_description comment).`);
  console.log(`\n=== SORTED BY NONE COUNT (absolute contributors) DESC ===`);
  console.log("category".padEnd(24), "total".padStart(8), "withSR".padStart(8), "NONE".padStart(8), "NONE%".padStart(7), "hasDesc%".padStart(9), "searchable");
  for (const r of [...rows].sort((a, b) => b.none - a.none)) {
    const pct = r.withSR > 0 ? ((r.none / r.withSR) * 100).toFixed(1) : "-";
    const descPct = r.withSR > 0 ? ((r.hasRealDescription / r.withSR) * 100).toFixed(1) : "-";
    const searchable = r.is_searchable_all ? "yes" : r.is_searchable_any ? "mixed" : "NO";
    console.log(r.category.padEnd(24), String(r.total).padStart(8), String(r.withSR).padStart(8), String(r.none).padStart(8), (pct + "%").padStart(7), (descPct + "%").padStart(9), searchable);
  }

  console.log(`\n=== SORTED BY NONE% (rate) DESC, min withSR>=20 ===`);
  console.log("category".padEnd(24), "total".padStart(8), "withSR".padStart(8), "NONE".padStart(8), "NONE%".padStart(7), "hasDesc%".padStart(9), "searchable");
  for (const r of [...rows].filter((r) => r.withSR >= 20).sort((a, b) => (b.none / b.withSR) - (a.none / a.withSR))) {
    const pct = ((r.none / r.withSR) * 100).toFixed(1);
    const descPct = ((r.hasRealDescription / r.withSR) * 100).toFixed(1);
    const searchable = r.is_searchable_all ? "yes" : r.is_searchable_any ? "mixed" : "NO";
    console.log(r.category.padEnd(24), String(r.total).padStart(8), String(r.withSR).padStart(8), String(r.none).padStart(8), (pct + "%").padStart(7), (descPct + "%").padStart(9), searchable);
  }

  console.log(`\n=== PER-SOURCE BREAKDOWN, categories with >1 contributing source ===`);
  for (const r of [...rows].sort((a, b) => b.none - a.none)) {
    const sources = Object.entries(r.bySource);
    if (sources.length <= 1) continue;
    console.log(`\n  ${r.category} (total=${r.total}, overall NONE=${r.none}/${r.withSR}):`);
    for (const [src, bs] of sources.sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${src.padEnd(16)} n=${String(bs.n).padStart(6)}  NONE=${String(bs.none).padStart(6)}  NONE%=${((bs.none / bs.n) * 100).toFixed(1).padStart(5)}%  hasDesc%=${((bs.hasDesc / bs.n) * 100).toFixed(1)}%`);
    }
  }

  writeFileSync(
    "../.context/measurements/full-corpus-eligibility-by-category.json",
    JSON.stringify(rows, null, 2),
  );
  console.log(`\nWrote full data to .context/measurements/full-corpus-eligibility-by-category.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
