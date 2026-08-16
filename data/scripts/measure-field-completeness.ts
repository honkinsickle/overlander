/**
 * Read-only field completeness across the master_place corpus (TEST).
 *
 * Master_place-level fields (columns): canonical_name, description,
 * amenities, hours, contact.phone, contact.website.
 *
 * Source_record-level fields (normalized_payload): photo, wikipedia,
 * wikidata. These do not live on master_place, so they're measured on
 * source_records of each source, and then rolled up to "master_places
 * for which SOME linked source_record from source S carries the field."
 *
 * "Per source" for master_place-level fields = master_places that have
 * at least one linked source_record from that source_id (an MP can
 * count for multiple sources — this is coverage, not exclusivity).
 *
 * NO WRITES. TEST only.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

type MP = {
  id: string;
  canonical_name: string | null;
  description: string | null;
  amenities: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  source_count: number;
};

type SR = {
  id: string;
  source_id: string;
  master_place_id: string | null;
  has_photo: boolean;
  has_wikipedia: boolean;
  has_wikidata: boolean;
  has_phone: boolean;
  has_website: boolean;
  has_hours: boolean;
  has_desc: boolean;
  has_amenities: boolean;
};

async function fetchMPs(db: SupabaseClient): Promise<MP[]> {
  const rows: MP[] = [];
  let from = 0;
  while (true) {
    const r = await db
      .from("master_place")
      .select("id, canonical_name, description, amenities, hours, contact, source_count")
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED (master_place):", r);
      throw new Error("mp query failed");
    }
    rows.push(...(r.data as MP[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … master_place ${from}\n`);
  }
  return rows;
}

async function fetchSRs(db: SupabaseClient): Promise<SR[]> {
  const rows: SR[] = [];
  let from = 0;
  while (true) {
    // Pull normalized_payload whole, extract fields in JS. Simpler and
    // avoids PostgREST JSON-pointer syntax quirks; per-row payload is
    // small enough (few KB max).
    const r = await db
      .from("source_record")
      .select("id, source_id, master_place_id, normalized_payload, is_active")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED (source_record):", r);
      throw new Error("sr query failed");
    }
    for (const raw of r.data as Array<{
      id: string; source_id: string; master_place_id: string | null;
      normalized_payload: Record<string, unknown> | null;
    }>) {
      const np = (raw.normalized_payload ?? {}) as Record<string, unknown>;
      const contact = (np.contact ?? {}) as Record<string, unknown>;
      const photo = np.photo as Record<string, unknown> | undefined;
      const hours = np.hours ?? np.opening_hours;
      const amenities = np.amenities;
      rows.push({
        id: raw.id,
        source_id: raw.source_id,
        master_place_id: raw.master_place_id,
        has_photo: !!(photo && (photo as any).url),
        has_wikipedia: !!(np.wikipedia || (np.tags as any)?.wikipedia),
        has_wikidata: !!(np.wikidata || (np.tags as any)?.wikidata),
        has_phone: !!(contact.phone),
        has_website: !!(contact.website),
        has_hours: !!(hours && (typeof hours === "string" ? hours.length > 0 : Object.keys(hours as any).length > 0)),
        has_desc: !!(np.description && String(np.description).length > 0),
        has_amenities: !!(amenities && Object.keys(amenities as any).length > 0),
      });
    }
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … source_record ${from}\n`);
  }
  return rows;
}

// ─── Field presence at master_place level ────────────────────────────────

function mpHasCanonical(m: MP) { return !!(m.canonical_name && m.canonical_name.trim().length > 0); }
function mpHasDescription(m: MP) { return !!(m.description && m.description.trim().length > 0); }
function mpHasAmenities(m: MP) { return !!(m.amenities && Object.keys(m.amenities).length > 0); }
function mpHasHours(m: MP) { return !!(m.hours && Object.keys(m.hours).length > 0); }
function mpHasPhone(m: MP) { return !!(m.contact && (m.contact as any).phone); }
function mpHasWebsite(m: MP) { return !!(m.contact && (m.contact as any).website); }

// ─── Main ────────────────────────────────────────────────────────────────

const SOURCE_ORDER = ["osm", "ridb", "nps", "usfs", "padus", "google_resolved", "google", "bc_parks", "parks_canada", "alberta_parks"] as const;

function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`; }
function fmt(n: number) { return n.toLocaleString(); }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log("Fetching master_place…");
  const mps = await fetchMPs(db);
  console.log(`  master_place rows: ${fmt(mps.length)}`);

  console.log("Fetching source_record (active)…");
  const srs = await fetchSRs(db);
  console.log(`  source_record rows: ${fmt(srs.length)}`);

  // Build MP → set<source_id> and MP → aggregated SR-derived flags per source.
  const mpById = new Map<string, MP>(mps.map(m => [m.id, m]));
  const mpSources = new Map<string, Set<string>>();
  // Track "any linked SR of source S carries flag X" per (mp, source, flag)
  const mpSrFlags = new Map<string, Record<string, Record<string, boolean>>>();
  const FLAGS = ["photo", "wikipedia", "wikidata", "phone", "website", "hours", "desc", "amenities"] as const;
  type Flag = typeof FLAGS[number];

  for (const sr of srs) {
    if (!sr.master_place_id) continue;
    if (!mpById.has(sr.master_place_id)) continue;
    let set = mpSources.get(sr.master_place_id);
    if (!set) { set = new Set(); mpSources.set(sr.master_place_id, set); }
    set.add(sr.source_id);

    let flags = mpSrFlags.get(sr.master_place_id);
    if (!flags) { flags = {}; mpSrFlags.set(sr.master_place_id, flags); }
    let src = flags[sr.source_id];
    if (!src) { src = {}; flags[sr.source_id] = src; }
    src.photo = src.photo || sr.has_photo;
    src.wikipedia = src.wikipedia || sr.has_wikipedia;
    src.wikidata = src.wikidata || sr.has_wikidata;
    src.phone = src.phone || sr.has_phone;
    src.website = src.website || sr.has_website;
    src.hours = src.hours || sr.has_hours;
    src.desc = src.desc || sr.has_desc;
    src.amenities = src.amenities || sr.has_amenities;
  }

  // Determine which sources are actually present
  const sourcesPresent = new Set<string>();
  for (const s of mpSources.values()) for (const x of s) sourcesPresent.add(x);
  const sources = SOURCE_ORDER.filter(s => sourcesPresent.has(s));
  console.log(`  sources present: ${sources.join(", ")}`);

  // Denominators: MPs total, MPs per source
  const nMP = mps.length;
  const nMPBySource = new Map<string, number>();
  for (const s of sources) {
    let n = 0;
    for (const set of mpSources.values()) if (set.has(s)) n++;
    nMPBySource.set(s, n);
  }

  // ─── Matrix A: master_place-level fields ────────────────────────────────
  console.log("\n════ MATRIX A — master_place-level field coverage ════");
  console.log("     (denominator = master_places carrying at least one active SR from that source; corpus = all master_places)\n");

  const mpFields: Array<[string, (m: MP) => boolean]> = [
    ["canonical_name", mpHasCanonical],
    ["description",   mpHasDescription],
    ["amenities",     mpHasAmenities],
    ["hours",         mpHasHours],
    ["phone",         mpHasPhone],
    ["website",       mpHasWebsite],
  ];

  const header = ["field".padEnd(14), `corpus (n=${fmt(nMP)})`.padStart(20), ...sources.map(s => `${s} (n=${fmt(nMPBySource.get(s)!)})`.padStart(20))];
  console.log(header.join(""));
  for (const [name, fn] of mpFields) {
    const corpusN = mps.filter(fn).length;
    const cells: string[] = [`${pct(corpusN, nMP)} (${fmt(corpusN)})`.padStart(20)];
    for (const s of sources) {
      let n = 0;
      for (const m of mps) {
        const set = mpSources.get(m.id);
        if (set && set.has(s) && fn(m)) n++;
      }
      cells.push(`${pct(n, nMPBySource.get(s)!)} (${fmt(n)})`.padStart(20));
    }
    console.log([name.padEnd(14), ...cells].join(""));
  }

  // ─── Matrix B: source_record-level fields (aggregated per MP) ──────────
  console.log("\n════ MATRIX B — source_record-carried fields (photo / wikipedia / wikidata) ════");
  console.log("     Per source: fraction of that source's MPs that have at least one SR of that source carrying the field.");
  console.log("     Corpus: fraction of MPs where ANY linked SR (any source) carries the field.\n");

  const srFields: Flag[] = ["photo", "wikipedia", "wikidata"];
  console.log(header.join(""));
  for (const f of srFields) {
    // Corpus: any source contributes the flag
    let corpusN = 0;
    for (const flags of mpSrFlags.values()) {
      let any = false;
      for (const src of Object.values(flags)) if ((src as any)[f]) { any = true; break; }
      if (any) corpusN++;
    }
    const cells: string[] = [`${pct(corpusN, nMP)} (${fmt(corpusN)})`.padStart(20)];
    for (const s of sources) {
      let n = 0;
      for (const flags of mpSrFlags.values()) {
        const src = flags[s];
        if (src && (src as any)[f]) n++;
      }
      cells.push(`${pct(n, nMPBySource.get(s)!)} (${fmt(n)})`.padStart(20));
    }
    console.log([f.padEnd(14), ...cells].join(""));
  }

  // ─── Matrix C: source_record-level raw (all active SRs of each source) ─
  console.log("\n════ MATRIX C — source_record raw coverage in normalized_payload ════");
  console.log("     Denominator: count of active source_records of that source.\n");

  const nSR = srs.length;
  const nSRBySource = new Map<string, number>();
  for (const sr of srs) nSRBySource.set(sr.source_id, (nSRBySource.get(sr.source_id) ?? 0) + 1);

  const cHeader = ["field".padEnd(14), `all-SR (n=${fmt(nSR)})`.padStart(20), ...sources.map(s => `${s} (n=${fmt(nSRBySource.get(s) ?? 0)})`.padStart(20))];
  console.log(cHeader.join(""));

  const srFlagCheck: Array<[string, (r: SR) => boolean]> = [
    ["photo",       (r) => r.has_photo],
    ["wikipedia",   (r) => r.has_wikipedia],
    ["wikidata",    (r) => r.has_wikidata],
    ["phone",       (r) => r.has_phone],
    ["website",     (r) => r.has_website],
    ["hours",       (r) => r.has_hours],
    ["description", (r) => r.has_desc],
    ["amenities",   (r) => r.has_amenities],
  ];
  for (const [name, fn] of srFlagCheck) {
    const allN = srs.filter(fn).length;
    const cells: string[] = [`${pct(allN, nSR)} (${fmt(allN)})`.padStart(20)];
    for (const s of sources) {
      const total = nSRBySource.get(s) ?? 0;
      const n = srs.filter(r => r.source_id === s && fn(r)).length;
      cells.push(`${pct(n, total)} (${fmt(n)})`.padStart(20));
    }
    console.log([name.padEnd(14), ...cells].join(""));
  }

  // ─── Distribution ──────────────────────────────────────────────────────
  console.log("\n════ Source distribution ════");
  console.log(`  Distinct sources per MP:`);
  const sourceCountHist = new Map<number, number>();
  for (const m of mps) {
    const n = mpSources.get(m.id)?.size ?? 0;
    sourceCountHist.set(n, (sourceCountHist.get(n) ?? 0) + 1);
  }
  for (const k of [...sourceCountHist.keys()].sort((a, b) => a - b)) {
    console.log(`    ${k} source(s): ${fmt(sourceCountHist.get(k)!)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
