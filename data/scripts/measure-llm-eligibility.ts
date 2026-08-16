/**
 * Read-only: characterize the rich-facets distribution across master_place
 * to define an LLM-enrichment eligibility criterion. NOT modifying anything.
 *
 * Terminology note: the codebase has no `facets` column. source_record has
 * `normalized_payload` (jsonb; per-source cleaned shape) and `raw_payload`
 * (jsonb; verbatim source). The OSM ingester's normalizeOsm() at
 * data/ingestion/sources/osm.ts:307-364 DISCARDS the raw `tags{}` dict —
 * so wikipedia / wikidata / historic_name / operator / cuisine / heritage
 * exist for OSM rows only in raw_payload.tags, never in normalized_payload.
 *
 * This script probes BOTH.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

type State = "WA" | "OR" | "CA" | "NV" | "UT" | "AZ" | "outside";
function classifyState(lng: number, lat: number): State {
  if (lat >= 31.333 && lat < 37.0 && lng >= -114.82 && lng <= -109.045) return "AZ";
  if (lat >= 37.0 && lat < 42.0 && lng >= -114.05 && lng <= -109.04) return "UT";
  if (lat >= 35.0 && lat < 42.0 && lng >= -120.01 && lng <= -114.04) return "NV";
  if (lat >= 45.85 && lat <= 49.0 && lng >= -124.85 && lng <= -117.04) return "WA";
  if (lat >= 41.99 && lat < 46.30 && lng >= -124.75 && lng <= -116.45) return "OR";
  if (lat >= 32.534 && lat < 42.01 && lng >= -124.50 && lng <= -114.13) return "CA";
  return "outside";
}

// Strict per the ask's exemplars: keys that carry LLM-usable descriptive
// content, not category markers. Excludes tourism/natural/amenity/leisure
// (already captured by inferred_category), ele (bare number), and access
// tags like surface/wheelchair (useful but not the "descriptive text" the
// ask calls out). The 5+-raw-tags fallback catches rich OSM rows that lack
// any of these keys.
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
  // signals
  has_website: boolean;
  has_phone: boolean;
  has_hours: boolean;
  has_wikipedia: boolean;
  has_wikidata: boolean;
  meaningful_tag_count: number;
  raw_tag_count: number;
};

async function fetchSRSignals(db: SupabaseClient): Promise<SR[]> {
  const rows: SR[] = [];
  let from = 0;
  process.stderr.write("Fetching source_record signals (normalized_payload + raw_payload tag summary)…\n");
  while (true) {
    // Pull both payloads; extract in JS. Alternative — PostgREST JSON extraction
    // in .select() — is finicky when the key can be absent, so pull the objects.
    const r = await db.from("source_record")
      .select("master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED (sr):", r);
      throw new Error("sr fetch failed");
    }
    for (const raw of r.data as Array<{
      master_place_id: string | null;
      source_id: string;
      normalized_payload: any;
      raw_payload: any;
    }>) {
      const np = raw.normalized_payload ?? {};
      const rp = raw.raw_payload ?? {};
      const contact = np.contact ?? {};
      const npHours = np.hours ?? np.opening_hours;
      // Raw tag dict lives at different paths per source:
      //   OSM: raw_payload.element.tags (key-value dict from Overpass)
      //   NPS: raw_payload.place.tags (array of theme labels — not a dict)
      //   RIDB / USFS / PAD-US / google_resolved: no key-value tag dict
      // Only OSM's shape supports the "5+ keys" or "high-signal key" test.
      const rawTags: Record<string, unknown> =
        (rp.element?.tags && typeof rp.element.tags === "object" && !Array.isArray(rp.element.tags))
          ? rp.element.tags
          : (rp.tags && typeof rp.tags === "object" && !Array.isArray(rp.tags)) ? rp.tags : {};
      const rawTagKeys = Object.keys(rawTags);
      let meaningful = 0;
      for (const k of rawTagKeys) if (MEANINGFUL_OSM_KEYS.has(k)) meaningful++;

      rows.push({
        master_place_id: raw.master_place_id,
        source_id: raw.source_id,
        // Existing pipeline-visible signals (normalized_payload):
        has_website: !!(contact.website ?? np.website ?? rawTags.website ?? rawTags.url),
        has_phone: !!(contact.phone ?? np.phone ?? rawTags.phone),
        has_hours: !!(
          (typeof npHours === "string" && npHours.length > 0) ||
          (npHours && typeof npHours === "object" && Object.keys(npHours).length > 0) ||
          rawTags.opening_hours
        ),
        // Wiki refs (from raw only — normalized_payload never carries them):
        has_wikipedia: !!(np.wikipedia ?? rawTags.wikipedia),
        has_wikidata: !!(np.wikidata ?? rawTags.wikidata),
        // Meaningful tags: presence of high-signal keys OR 5+ total tags
        // (the "more than name+category" phrasing in the ask)
        meaningful_tag_count: meaningful,
        raw_tag_count: rawTagKeys.length,
      });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }
  return rows;
}

type MP = {
  id: string;
  primary_category: string;
  lng: number;
  lat: number;
  state: State;
};

async function fetchMPs(db: SupabaseClient): Promise<MP[]> {
  const mps: any[] = [];
  process.stderr.write("Fetching master_place (id, category)…\n");
  let from = 0;
  while (true) {
    const r = await db.from("master_place")
      .select("id, primary_category")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mps.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … mp ${from}\n`);
  }
  process.stderr.write("Fetching master_place geometry (from master_place_search_export)…\n");
  const geo = new Map<string, { lng: number; lat: number }>();
  from = 0;
  while (true) {
    const r = await db.from("master_place_search_export")
      .select("id, lng, lat")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const out: MP[] = [];
  for (const m of mps) {
    const g = geo.get(m.id);
    // Non-searchable MPs (land_status, is_searchable=false) are excluded from
    // the geo view. Skip them — they're not the target for LLM enrichment.
    if (!g) continue;
    out.push({ id: m.id, primary_category: m.primary_category, lng: g.lng, lat: g.lat, state: classifyState(g.lng, g.lat) });
  }
  return out;
}

// ─── Aggregate + report ──────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const mps = await fetchMPs(db);
  console.log(`  in-scope MPs (searchable + geometry): ${fmt(mps.length)}`);

  const srs = await fetchSRSignals(db);
  console.log(`  source_records probed: ${fmt(srs.length)}`);

  // Aggregate signals per MP: any linked SR contributes
  type MPSig = {
    has_wikipedia: boolean;
    has_website: boolean;
    has_opening_hours: boolean;
    has_phone: boolean;
    has_meaningful_tags: boolean;  // ≥1 meaningful key OR ≥5 raw tags
    source_ids: Set<string>;
  };
  const sigs = new Map<string, MPSig>();
  for (const sr of srs) {
    if (!sr.master_place_id) continue;
    let s = sigs.get(sr.master_place_id);
    if (!s) {
      s = { has_wikipedia: false, has_website: false, has_opening_hours: false,
            has_phone: false, has_meaningful_tags: false, source_ids: new Set() };
      sigs.set(sr.master_place_id, s);
    }
    s.source_ids.add(sr.source_id);
    s.has_wikipedia ||= sr.has_wikipedia || sr.has_wikidata;
    s.has_website ||= sr.has_website;
    s.has_opening_hours ||= sr.has_hours;
    s.has_phone ||= sr.has_phone;
    s.has_meaningful_tags ||= (sr.meaningful_tag_count >= 1) || (sr.raw_tag_count >= 5);
  }

  const mpsWithSR = mps.filter(m => sigs.has(m.id));
  const N = mpsWithSR.length;
  console.log(`  MPs with at least one active SR: ${fmt(N)}`);

  // ── Individual signal counts
  const c = { wiki: 0, web: 0, hours: 0, phone: 0, meaningful: 0 };
  for (const m of mpsWithSR) {
    const s = sigs.get(m.id)!;
    if (s.has_wikipedia) c.wiki++;
    if (s.has_website) c.web++;
    if (s.has_opening_hours) c.hours++;
    if (s.has_phone) c.phone++;
    if (s.has_meaningful_tags) c.meaningful++;
  }
  console.log("\n── INDIVIDUAL SIGNALS (each independent) ──");
  console.log(`  has_wikipedia (any source, incl raw_payload.tags):    ${fmt(c.wiki).padStart(8)}  ${pct(c.wiki, N)}`);
  console.log(`  has_website:                                          ${fmt(c.web).padStart(8)}  ${pct(c.web, N)}`);
  console.log(`  has_opening_hours:                                    ${fmt(c.hours).padStart(8)}  ${pct(c.hours, N)}`);
  console.log(`  has_phone:                                            ${fmt(c.phone).padStart(8)}  ${pct(c.phone, N)}`);
  console.log(`  has_meaningful_tags (≥1 high-signal key OR ≥5 raw):   ${fmt(c.meaningful).padStart(8)}  ${pct(c.meaningful, N)}`);

  // ── Buckets
  let strong = 0, weakOnly = 0, none = 0;
  for (const m of mpsWithSR) {
    const s = sigs.get(m.id)!;
    const isStrong = s.has_wikipedia || s.has_website || s.has_meaningful_tags;
    const isWeak = !isStrong && (s.has_phone || s.has_opening_hours);
    if (isStrong) strong++;
    else if (isWeak) weakOnly++;
    else none++;
  }
  console.log("\n── BUCKETS ──");
  console.log(`  STRONG   (wiki OR website OR meaningful_tags):        ${fmt(strong).padStart(8)}  ${pct(strong, N)}`);
  console.log(`  WEAK-only (phone/hours only, no strong):              ${fmt(weakOnly).padStart(8)}  ${pct(weakOnly, N)}`);
  console.log(`  NONE     (no rich signals — minimal-bucket):          ${fmt(none).padStart(8)}  ${pct(none, N)}`);

  // ── By category
  console.log("\n── BY CATEGORY — top 25 by rich-eligibility rate (min n=100) ──");
  console.log("  category               n     strong%  weak%  none%  strong_n");
  const byCat = new Map<string, { n: number; strong: number; weak: number; none: number }>();
  for (const m of mpsWithSR) {
    const s = sigs.get(m.id)!;
    const isStrong = s.has_wikipedia || s.has_website || s.has_meaningful_tags;
    const isWeak = !isStrong && (s.has_phone || s.has_opening_hours);
    let row = byCat.get(m.primary_category);
    if (!row) { row = { n: 0, strong: 0, weak: 0, none: 0 }; byCat.set(m.primary_category, row); }
    row.n++;
    if (isStrong) row.strong++; else if (isWeak) row.weak++; else row.none++;
  }
  const catRows = [...byCat.entries()]
    .filter(([_, r]) => r.n >= 100)
    .map(([k, r]) => ({ cat: k, ...r, strongPct: r.strong / r.n }))
    .sort((a, b) => b.strongPct - a.strongPct);
  for (const row of catRows.slice(0, 25)) {
    console.log(`  ${row.cat.padEnd(22)} ${fmt(row.n).padStart(6)}  ${pct(row.strong, row.n).padStart(6)}  ${pct(row.weak, row.n).padStart(6)}  ${pct(row.none, row.n).padStart(6)}  ${fmt(row.strong).padStart(6)}`);
  }
  console.log(`  (${catRows.length} categories total with n>=100; ${byCat.size} categories overall)`);

  // ── By state
  console.log("\n── BY STATE ──");
  console.log("  state  n         strong    weak   none   strong%");
  const byState = new Map<State, { n: number; strong: number; weak: number; none: number }>();
  for (const m of mpsWithSR) {
    const s = sigs.get(m.id)!;
    const isStrong = s.has_wikipedia || s.has_website || s.has_meaningful_tags;
    const isWeak = !isStrong && (s.has_phone || s.has_opening_hours);
    let row = byState.get(m.state);
    if (!row) { row = { n: 0, strong: 0, weak: 0, none: 0 }; byState.set(m.state, row); }
    row.n++;
    if (isStrong) row.strong++; else if (isWeak) row.weak++; else row.none++;
  }
  for (const st of ["WA", "OR", "CA", "NV", "UT", "AZ", "outside"] as State[]) {
    const r = byState.get(st) ?? { n: 0, strong: 0, weak: 0, none: 0 };
    console.log(`  ${st.padEnd(7)}${fmt(r.n).padStart(8)}  ${fmt(r.strong).padStart(6)}  ${fmt(r.weak).padStart(6)}  ${fmt(r.none).padStart(6)}  ${pct(r.strong, r.n)}`);
  }

  // ── Wiki-tag distribution by source (sanity)
  console.log("\n── SANITY: wikipedia/wikidata tag counts by source (raw_payload.tags) ──");
  const wikiBySrc = new Map<string, { total: number; wiki: number; wikidata: number }>();
  for (const sr of srs) {
    let row = wikiBySrc.get(sr.source_id);
    if (!row) { row = { total: 0, wiki: 0, wikidata: 0 }; wikiBySrc.set(sr.source_id, row); }
    row.total++;
    if (sr.has_wikipedia) row.wiki++;
    if (sr.has_wikidata) row.wikidata++;
  }
  for (const [src, r] of [...wikiBySrc.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${src.padEnd(18)} total=${fmt(r.total).padStart(7)}  wikipedia=${fmt(r.wiki).padStart(5)} (${pct(r.wiki, r.total)})  wikidata=${fmt(r.wikidata).padStart(5)} (${pct(r.wikidata, r.total)})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
