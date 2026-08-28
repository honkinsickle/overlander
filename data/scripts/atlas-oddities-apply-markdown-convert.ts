/**
 * Apply `convertAoMarkdown` to every atlas_oddities source_record's
 * description on the currently-linked project (defaults to TEST — the
 * script fences to TEST by default; run with `--allow-prod` if
 * data/.env has been swapped to PROD credentials, and even then the
 * script re-asserts the URL against the PROD ref explicitly at the top
 * of main() so a mis-swap can't slip through).
 *
 * Behavior:
 *   1. Fetch every atlas_oddities source_record with a non-null
 *      normalized_payload.description.
 *   2. For each row, compute the converted text. If unchanged (either
 *      already clean or the converter is a no-op), skip.
 *   3. UPDATE normalized_payload.description on the changed rows.
 *   4. Call recompute_master_place(id) for each unique linked mp_id
 *      whose source_record actually changed — this flows the converted
 *      text into master_place.description.
 *   5. Report before/after counts and a sample of before→after diffs.
 *
 * Idempotent — running twice does nothing on the second pass.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/atlas-oddities-apply-markdown-convert.ts [--dry-run] [--allow-prod]
 */

import { getDb } from "../ingestion/lib/db.ts";
import { convertAoMarkdown, looksLikeAoMarkdown } from "../ingestion/sources/atlas-oddities-markdown.ts";

const TEST_URL = "https://znldzjdatkogdktymtvi.supabase.co";
const PROD_URL = "https://nqzeywzcowujzyegxbsr.supabase.co";
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_PROD = process.argv.includes("--allow-prod");

const url = process.env.SUPABASE_URL ?? "";
if (url === PROD_URL) {
  if (!ALLOW_PROD) {
    console.error(
      "Refusing to run — data/.env is pointed at PROD but --allow-prod was not supplied.",
    );
    process.exit(1);
  }
  console.log("⚠  Running against PROD (SUPABASE_URL = PROD ref). --allow-prod supplied.");
} else if (url !== TEST_URL) {
  console.error(`Refusing to run — SUPABASE_URL is neither TEST nor PROD. Got: ${url}`);
  process.exit(1);
}

const db = getDb();

type Row = {
  id: string;
  external_id: string;
  master_place_id: string | null;
  normalized_payload: Record<string, unknown>;
};

async function fetchAll(): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const r = await db
      .from("source_record")
      .select("id, external_id, master_place_id, normalized_payload")
      .eq("source_id", "atlas_oddities")
      .not("normalized_payload->>description", "is", null)
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED (fetchAll):", r);
      process.exit(1);
    }
    for (const row of r.data) out.push(row as unknown as Row);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function countWithMarkdownLike(): Promise<number> {
  // Rough count of source_records whose description contains any AO markdown
  // pattern the converter handles. Done client-side to reuse the same regex
  // logic; corpus is small (2,858 rows) so a full scan is fine.
  const rows = await fetchAll();
  return rows.filter((r) => {
    const d = (r.normalized_payload as { description?: string }).description ?? "";
    return looksLikeAoMarkdown(d);
  }).length;
}

async function main() {
  console.log("=".repeat(72));
  console.log("AO markdown converter apply —", DRY_RUN ? "DRY RUN" : "LIVE");
  console.log(`Target: ${url}`);
  console.log("=".repeat(72));

  console.log("\n── BEFORE ──");
  const beforeMdLike = await countWithMarkdownLike();
  console.log(`  atlas_oddities descriptions still carrying markdown syntax: ${beforeMdLike}`);

  const rows = await fetchAll();
  console.log(`\nFetched ${rows.length} atlas_oddities rows with a description.`);

  const changes: Array<{ row: Row; before: string; after: string }> = [];
  for (const row of rows) {
    const before = (row.normalized_payload as { description?: string }).description ?? "";
    const after = convertAoMarkdown(before);
    if (after !== before) changes.push({ row, before, after });
  }
  console.log(`  rows that would change: ${changes.length}`);
  console.log(`  rows already clean (converter no-op): ${rows.length - changes.length}`);

  if (changes.length > 0) {
    console.log(`\nSample before→after (first 3):`);
    for (const c of changes.slice(0, 3)) {
      console.log(`  ${c.row.external_id}`);
      console.log(`    BEFORE: ${c.before.slice(0, 140).replace(/\n/g, " ")}${c.before.length > 140 ? "…" : ""}`);
      console.log(`    AFTER:  ${c.after.slice(0, 140).replace(/\n/g, " ")}${c.after.length > 140 ? "…" : ""}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — no writes.");
    return;
  }

  if (changes.length === 0) {
    console.log("\nNothing to change. Done.");
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────
  console.log(`\n── UPDATING ${changes.length} source_records ──`);
  let updated = 0;
  let failed = 0;
  const changedMpIds = new Set<string>();
  const startWrite = Date.now();
  for (const { row, after } of changes) {
    const next = { ...row.normalized_payload, description: after };
    const resp = await db
      .from("source_record")
      .update({ normalized_payload: next })
      .eq("id", row.id);
    if (resp.error) {
      console.error(`UPDATE failed for ${row.external_id}:`, resp.error);
      failed++;
      continue;
    }
    updated++;
    if (row.master_place_id) changedMpIds.add(row.master_place_id);
    if (updated % 200 === 0) {
      const rate = updated / ((Date.now() - startWrite) / 1000);
      console.log(`  updated ${updated}/${changes.length} (~${rate.toFixed(1)}/s)`);
    }
  }
  console.log(`  updated: ${updated}   failed: ${failed}`);

  // ── Recompute ──────────────────────────────────────────────────────
  const mpIds = Array.from(changedMpIds);
  console.log(`\n── RECOMPUTE ${mpIds.length} master_place rows ──`);
  let recomputed = 0;
  let recomputeFailed = 0;
  const startRecompute = Date.now();
  for (const mpId of mpIds) {
    const r = await db.rpc("recompute_master_place", { p_master_place_id: mpId });
    if (r.error) {
      console.error(`recompute failed for ${mpId}:`, r.error);
      recomputeFailed++;
      continue;
    }
    recomputed++;
    if (recomputed % 200 === 0) {
      const rate = recomputed / ((Date.now() - startRecompute) / 1000);
      console.log(`  recomputed ${recomputed}/${mpIds.length} (~${rate.toFixed(1)}/s)`);
    }
  }
  console.log(`  recomputed: ${recomputed}   failed: ${recomputeFailed}`);

  console.log("\n── AFTER ──");
  const afterMdLike = await countWithMarkdownLike();
  console.log(`  atlas_oddities descriptions still carrying markdown syntax: ${afterMdLike}`);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
