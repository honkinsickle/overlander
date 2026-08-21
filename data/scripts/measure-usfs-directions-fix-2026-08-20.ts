/**
 * One-off, read-only: the 2026-08-20 gap scan spot-check (§5) found USFS rows
 * carrying a substantial `normalized_payload.directions` field alongside a
 * templated junk `description` — `has_real_description` never looks at
 * `directions`, so those rows undercounted as NONE/WEAK. This script adds a
 * `has_real_directions` signal (same DESCRIPTION_MIN_LENGTH=40 threshold,
 * reused from lib/eligibility.ts, not re-derived) and reports CORRECTED
 * STRONG/WEAK/NONE counts for USFS-linked master_places only.
 *
 * Deliberately NOT touching lib/eligibility.ts or measure-corpus-gap-scan-
 * 2026-08-20.ts — `directions` is confirmed (queried, this session) to be
 * populated ONLY by usfs (0 rows on osm/padus/ridb/nps/atlas_oddities/blm/
 * google_resolved/google), so this fix cannot silently affect any other
 * source's bucketing even if it were folded into the shared module. Kept
 * separate anyway per the task's explicit "do not touch other sources'
 * logic" instruction — this script only ever reports on USFS-linked MPs.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals,
  emptyAggregatedSignals,
  foldSignalsInto,
  isStrong as isStrongSignals,
  isWeak as isWeakSignals,
  DESCRIPTION_MIN_LENGTH,
  type AggregatedSignals,
} from "./lib/eligibility.ts";

const PAGE = 1000;

function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(2)}%`; }

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Run date/time: ${new Date().toISOString()}`);

  type Row = {
    master_place_id: string | null;
    source_id: string;
    normalized_payload: any;
    raw_payload: any;
  };
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    rows.push(...(r.data as Row[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Active source_record rows queried: ${fmt(rows.length)}`);

  // Aggregate ORIGINAL signals (unchanged lib/eligibility.ts logic) per MP,
  // across ALL active SRs (matching the original gap-scan script's method).
  type MPSig = AggregatedSignals & { has_real_directions: boolean; is_usfs_linked: boolean };
  const sigs = new Map<string, MPSig>();
  for (const r of rows) {
    if (!r.master_place_id) continue;
    let s = sigs.get(r.master_place_id);
    if (!s) { s = { ...emptyAggregatedSignals(), has_real_directions: false, is_usfs_linked: false }; sigs.set(r.master_place_id, s); }
    foldSignalsInto(s, computeSignals(r.normalized_payload, r.raw_payload));
    if (r.source_id === "usfs") {
      s.is_usfs_linked = true;
      const d = r.normalized_payload?.directions;
      if (typeof d === "string" && d.trim().length >= DESCRIPTION_MIN_LENGTH) s.has_real_directions = true;
    }
  }

  const usfsMPs = [...sigs.entries()].filter(([, s]) => s.is_usfs_linked);
  console.log(`USFS-linked master_places (active SR): ${fmt(usfsMPs.length)}`);

  function bucketOriginal(s: AggregatedSignals): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s)) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }
  function bucketCorrected(s: MPSig): "STRONG" | "WEAK" | "NONE" {
    if (isStrongSignals(s) || s.has_real_directions) return "STRONG";
    if (isWeakSignals(s)) return "WEAK";
    return "NONE";
  }

  let origS = 0, origW = 0, origN = 0;
  let corrS = 0, corrW = 0, corrN = 0;
  let flipped = 0; // NONE/WEAK -> STRONG solely due to directions
  const flippedIds: string[] = [];
  for (const [id, s] of usfsMPs) {
    const ob = bucketOriginal(s);
    const cb = bucketCorrected(s);
    if (ob === "STRONG") origS++; else if (ob === "WEAK") origW++; else origN++;
    if (cb === "STRONG") corrS++; else if (cb === "WEAK") corrW++; else corrN++;
    if (ob !== "STRONG" && cb === "STRONG") { flipped++; if (flippedIds.length < 10) flippedIds.push(id); }
  }
  const N = usfsMPs.length;

  console.log("\n══ USFS BUCKETS — ORIGINAL (has_real_description only, unchanged lib/eligibility.ts) ══");
  console.log(`  STRONG: ${fmt(origS)} (${pct(origS, N)})`);
  console.log(`  WEAK:   ${fmt(origW)} (${pct(origW, N)})`);
  console.log(`  NONE:   ${fmt(origN)} (${pct(origN, N)})`);

  console.log("\n══ USFS BUCKETS — CORRECTED (has_real_description OR has_real_directions, USFS only) ══");
  console.log(`  STRONG: ${fmt(corrS)} (${pct(corrS, N)})`);
  console.log(`  WEAK:   ${fmt(corrW)} (${pct(corrW, N)})`);
  console.log(`  NONE:   ${fmt(corrN)} (${pct(corrN, N)})`);

  console.log(`\n  Rows that flipped to STRONG solely because of a real 'directions' field: ${fmt(flipped)} (${pct(flipped, N)} of USFS-linked MPs)`);
  console.log(`  Sample flipped master_place ids: ${flippedIds.join(", ")}`);
}

main().catch(e => { console.error(e); process.exit(1); });
