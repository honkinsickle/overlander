/**
 * Corpus depth by (primary_category × source_id). READ-ONLY, TEST ONLY.
 *
 * Extends `measure-category-source-audit-2026-09-02.ts` (#364), which reported
 * per-category corpus depth but NOT which ingest source produced those rows.
 * The source-to-category routing question needs that second axis: "camping has
 * 6,114 rows" does not say whether they came from rec-gov, the state-parks
 * family, or OSM — and the routing recommendation for the OFFLINE corpus half
 * is exactly a statement about which importer to keep feeding.
 *
 * DEFINITIONS, stated because they are the whole meaning of every number:
 *   - IN-SCOPE = present in `master_place_search_export` (is_searchable AND
 *     source_count > 0 AND inside six_state_footprint() AND operational_status
 *     not CLOSED/DECOMMISSIONED). This is the same population #364 reported.
 *   - A master_place is CREDITED to every source_id that has an ACTIVE
 *     source_record pointing at it. A place with 3 active source_records from
 *     3 importers is counted once under each — so column sums exceed the
 *     category total by design. The "distinct places" column is the
 *     non-double-counted figure.
 *
 * NOT modifying any DB state. No ingest, no Typesense, no writes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;
const TEST_REF = "znldzjdatkogdktymtvi";

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
    if (seen % 25000 === 0) process.stderr.write(`  ${label}: ${seen}…\n`);
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
  const db: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false },
  });
  console.log(`Project: ${ref} (TEST)`);
  console.log(`Run started: ${new Date().toISOString()}`);

  // ── A. in-scope master_places, id → primary_category ──────────────────
  const catOf = new Map<string, string>();
  const nA = await page<{ id: string; primary_category: string | null }>(
    "export",
    (from, to) =>
      db
        .from("master_place_search_export")
        .select("id,primary_category")
        .range(from, to),
    (rows) => {
      for (const r of rows) catOf.set(r.id, r.primary_category ?? "(null)");
    },
  );
  console.log(`\nIn-scope master_place rows: ${nA}`);

  // ── B. active source_records → (category, source) credits ─────────────
  // Streamed and folded; payloads never held.
  const matrix = new Map<string, Map<string, Set<string>>>(); // cat → src → mp ids
  const bySource = new Map<string, number>(); // src → distinct in-scope mps
  const srcSeen = new Map<string, Set<string>>();
  let srActive = 0;
  let srInScope = 0;

  const nB = await page<{ master_place_id: string | null; source_id: string }>(
    "source_record",
    (from, to) =>
      db
        .from("source_record")
        .select("master_place_id,source_id")
        .eq("is_active", true)
        .range(from, to),
    (rows) => {
      for (const r of rows) {
        srActive++;
        if (!r.master_place_id) continue;
        const cat = catOf.get(r.master_place_id);
        if (cat === undefined) continue; // not in-scope
        srInScope++;
        let bySrc = matrix.get(cat);
        if (!bySrc) matrix.set(cat, (bySrc = new Map()));
        let ids = bySrc.get(r.source_id);
        if (!ids) bySrc.set(r.source_id, (ids = new Set()));
        ids.add(r.master_place_id);
        let s = srcSeen.get(r.source_id);
        if (!s) srcSeen.set(r.source_id, (s = new Set()));
        s.add(r.master_place_id);
      }
    },
  );
  for (const [src, ids] of srcSeen) bySource.set(src, ids.size);
  console.log(
    `Active source_record rows: ${nB} (${srInScope} point at an in-scope master_place)`,
  );

  // ── C. report ─────────────────────────────────────────────────────────
  const catTotals = new Map<string, number>();
  for (const c of catOf.values()) catTotals.set(c, (catTotals.get(c) ?? 0) + 1);

  const sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n── Distinct in-scope master_places credited, by source ──`);
  console.log(`${"source_id".padEnd(28)} ${"places".padStart(7)}`);
  for (const [src, n] of sources) {
    console.log(`${src.padEnd(28)} ${String(n).padStart(7)}`);
  }

  console.log(
    `\n── primary_category × source_id (distinct in-scope master_places) ──`,
  );
  console.log(
    `A place with N active source_records is credited to all N sources, so the\n` +
      `source columns sum to MORE than "in-scope". "in-scope" is the distinct count.`,
  );
  const cats = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, total] of cats) {
    const bySrc = matrix.get(cat);
    const parts = bySrc
      ? [...bySrc.entries()]
          .sort((a, b) => b[1].size - a[1].size)
          .map(([s, ids]) => `${s}=${ids.size}`)
      : [];
    console.log(
      `${cat.padEnd(26)} in-scope=${String(total).padStart(6)}  ${parts.join(" ") || "(no active source_record)"}`,
    );
  }

  console.log(`\nRun finished: ${new Date().toISOString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
