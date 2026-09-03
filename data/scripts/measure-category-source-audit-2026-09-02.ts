/**
 * Category × source audit — corpus half. READ-ONLY, TEST ONLY.
 *
 * Produces, per `master_place.primary_category`:
 *   - total master_place rows
 *   - rows that are is_searchable AND source_count > 0 (pre-footprint)
 *   - in-scope rows = present in `master_place_search_export` (the Typesense
 *     sync source: is_searchable + source_count>0 + inside six_state_footprint()
 *     + operational_status not CLOSED/DECOMMISSIONED)
 *   - STRONG / WEAK / NONE split over the in-scope rows
 *
 * Bucketing logic imported UNCHANGED from ./lib/eligibility.ts — not
 * re-derived here, same as every prior measurement pass. Signals are folded
 * streaming (payloads discarded per page) so memory stays bounded; the
 * 2026-08-21 template-signal script held every in-scope SR in an array, which
 * is not necessary and does not scale with the current corpus.
 *
 * NOT modifying any DB state. No ingest, no Typesense, no writes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  computeSignals,
  emptyAggregatedSignals,
  foldSignalsInto,
  bucketOf,
  type AggregatedSignals,
} from "./lib/eligibility.ts";

const PAGE = 1000;
const TEST_REF = "znldzjdatkogdktymtvi";

type CatRow = {
  category: string;
  total: number;
  searchable_sourced: number;
  in_scope: number;
  strong: number;
  weak: number;
  none: number;
};

/** Every paged read goes through here. A null `data` or a present `error` is a
 *  FAILURE SIGNAL, never "zero rows" — see the CLAUDE.md gotcha (a bad column
 *  returns count:null with an often-empty error.message). Logs the WHOLE
 *  response, not error?.message. */
async function page<T>(
  label: string,
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  onRows: (rows: T[]) => void,
): Promise<number> {
  let from = 0;
  let seen = 0;
  for (;;) {
    const r = await run(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.log(`QUERY FAILED [${label}]:`, r);
      throw new Error(`query failed: ${label}`);
    }
    onRows(r.data);
    seen += r.data.length;
    if (r.data.length < PAGE) break;
    from += PAGE;
    if (from % 25000 === 0) process.stderr.write(`  ${label}: ${seen}…\n`);
  }
  return seen;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    process.exit(2);
  }
  const ref = new URL(url).host.split(".")[0];
  if (ref !== TEST_REF) {
    console.error(`Refusing non-TEST project: ${ref} (expected ${TEST_REF})`);
    process.exit(2);
  }
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Project: ${ref} (TEST)`);
  console.log(`Run started: ${new Date().toISOString()}`);

  // ── A. Every master_place: totals + searchable/sourced, by category ──
  const cats = new Map<string, CatRow>();
  const row = (c: string): CatRow => {
    let x = cats.get(c);
    if (!x) {
      x = { category: c, total: 0, searchable_sourced: 0, in_scope: 0, strong: 0, weak: 0, none: 0 };
      cats.set(c, x);
    }
    return x;
  };

  process.stderr.write("A. master_place (primary_category, is_searchable, source_count)…\n");
  const totalMp = await page<{ primary_category: string | null; is_searchable: boolean | null; source_count: number | null }>(
    "master_place",
    (f, t) =>
      db.from("master_place")
        .select("primary_category, is_searchable, source_count")
        .order("id")
        .range(f, t),
    (rows) => {
      for (const m of rows) {
        const r = row(m.primary_category ?? "(null)");
        r.total++;
        if (m.is_searchable && (m.source_count ?? 0) > 0) r.searchable_sourced++;
      }
    },
  );
  console.log(`Total master_place rows: ${totalMp}`);

  // ── B. In-scope population = the export view ──
  process.stderr.write("B. master_place_search_export (id, primary_category)…\n");
  const inScope = new Map<string, string>(); // mp id → category
  await page<{ id: string; primary_category: string | null }>(
    "export_view",
    (f, t) =>
      db.from("master_place_search_export")
        .select("id, primary_category")
        .order("id")
        .range(f, t),
    (rows) => {
      for (const m of rows) {
        inScope.set(m.id, m.primary_category ?? "(null)");
        row(m.primary_category ?? "(null)").in_scope++;
      }
    },
  );
  console.log(`In-scope (master_place_search_export): ${inScope.size}`);

  // ── C. Active source_records → aggregated signals, streaming ──
  process.stderr.write("C. source_record (active) → signals…\n");
  const sigs = new Map<string, AggregatedSignals>();
  let srSeenInScope = 0;
  const totalSr = await page<{ master_place_id: string | null; normalized_payload: unknown; raw_payload: unknown }>(
    "source_record",
    (f, t) =>
      db.from("source_record")
        .select("master_place_id, normalized_payload, raw_payload")
        .eq("is_active", true)
        .order("id")
        .range(f, t),
    (rows) => {
      for (const sr of rows) {
        const mp = sr.master_place_id;
        if (!mp || !inScope.has(mp)) continue;
        srSeenInScope++;
        let s = sigs.get(mp);
        if (!s) {
          s = emptyAggregatedSignals();
          sigs.set(mp, s);
        }
        foldSignalsInto(s, computeSignals(sr.normalized_payload, sr.raw_payload));
      }
    },
  );
  console.log(`Active source_record rows scanned: ${totalSr}; linked to an in-scope MP: ${srSeenInScope}`);

  // ── D. Template descriptions (master_place-level, not per-SR) ──
  process.stderr.write("D. master_place_generated_content (template descriptions)…\n");
  const templateIds = new Set<string>();
  await page<{ master_place_id: string }>(
    "generated_content",
    (f, t) =>
      db.from("master_place_generated_content")
        .select("master_place_id")
        .eq("generation_method", "template")
        .eq("field_name", "description")
        .order("id")
        .range(f, t),
    (rows) => {
      for (const g of rows) if (inScope.has(g.master_place_id)) templateIds.add(g.master_place_id);
    },
  );
  console.log(`In-scope MPs with a template description row: ${templateIds.size}`);

  // ── E. Bucket every in-scope MP into its category ──
  for (const [id, cat] of inScope) {
    const base = sigs.get(id) ?? emptyAggregatedSignals();
    const s: AggregatedSignals = { ...base, has_template_description: templateIds.has(id) };
    const b = bucketOf(s);
    const r = row(cat);
    if (b === "STRONG") r.strong++;
    else if (b === "WEAK") r.weak++;
    else r.none++;
  }

  // ── Output: TSV, sorted by in-scope desc then total desc ──
  const out = [...cats.values()].sort((a, b) => b.in_scope - a.in_scope || b.total - a.total);
  console.log("\n=== PER-CATEGORY (TSV) ===");
  console.log("primary_category\ttotal_mp\tsearchable_sourced\tin_scope\tSTRONG\tWEAK\tNONE");
  for (const r of out) {
    console.log(
      `${r.category}\t${r.total}\t${r.searchable_sourced}\t${r.in_scope}\t${r.strong}\t${r.weak}\t${r.none}`,
    );
  }

  const sum = (k: keyof CatRow) => out.reduce((a, r) => a + (r[k] as number), 0);
  console.log(
    `\nTOTALS\ttotal_mp=${sum("total")}\tsearchable_sourced=${sum("searchable_sourced")}\tin_scope=${sum("in_scope")}\tSTRONG=${sum("strong")}\tWEAK=${sum("weak")}\tNONE=${sum("none")}`,
  );
  console.log(`Distinct primary_category values: ${out.length}`);
  console.log(`Run finished: ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
