/**
 * READ-ONLY investigation: does each ingested source's stored payload carry
 * a rating / reviewCount / priceTier / description / photoUrl equivalent?
 *
 * Step 1 of the place-data resolver consolidation
 * (docs/decisions/2026-08-21-place-data-resolver-consolidation.md) adds those
 * five as nullable columns on master_place. Before writing a backfill we need
 * to know, per source, whether the data actually exists — measured, not
 * assumed from the normalizer source code (an unmapped field can sit in
 * raw_payload and never reach normalized_payload; that is exactly the shape of
 * the BLM WEB_LINK and RIDB FacilityDirections misses found on 2026-08-20).
 *
 * Method, two phases:
 *
 *  A. KEY CENSUS — full scan (not a sample) of every source_record for the
 *     sources named below, walking both raw_payload and normalized_payload to
 *     a bounded depth and counting, per key path, how many rows have it
 *     present and how many have a non-empty value. Full scan so the reported
 *     counts are population figures, not sampled ones.
 *
 *  B. CANDIDATE FILTER — key paths whose leaf name matches one of the five
 *     target concepts are reported with example values, so a human can judge
 *     whether e.g. `fee_description` is a description (it isn't) or
 *     `FacilityDescription` is (it is).
 *
 * Writes nothing. No network calls beyond Supabase reads.
 *
 * Run:
 *   npx tsx --env-file=data/.env data/scripts/investigate-enrichment-fields-2026-08-21.ts
 *   ... --sources osm,nps        # restrict
 *   ... --max-rows 2000          # cap per source (marks the report SAMPLED)
 */

import { Command } from "commander";
import { getDb } from "../ingestion/lib/db.ts";

const PAGE_SIZE = 500;
const MAX_DEPTH = 4;

/** The six ingested sources named in the task, plus the two that back
 *  "BLM/USFS" separately in this corpus, plus padus/google for completeness
 *  of the picture (they are not in the task's six but they are rows in the
 *  same table and a reader will ask). */
const DEFAULT_SOURCES = [
  "osm",
  "nps",
  "ridb",
  "state_parks",
  "atlas_oddities",
  "blm",
  "usfs",
  "padus",
  "google",
  "google_resolved",
];

/** Leaf-name patterns for the five target concepts. Deliberately loose —
 *  the point is to surface candidates for human judgement, not to decide. */
const CONCEPT_PATTERNS: Record<string, RegExp> = {
  rating: /rating|stars?$|^score$|user_ratings/i,
  reviewCount: /review|num_?ratings|rating_?count|votes?$/i,
  priceTier: /price|cost|^fee|fee_|_fee$|tier$|expens/i,
  description: /descript|summary|abstract|overview|blurb|bodytext|body_text|^notes?$|synopsis|caption|about/i,
  photoUrl: /photo|image|img|thumb|picture|media|banner|^url$/i,
};

type Stat = {
  present: number;
  nonEmpty: number;
  types: Set<string>;
  examples: string[];
};

function leafName(path: string): string {
  const parts = path.split(".");
  // Skip trailing array markers so `images[].url` leafs on `url`.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].replace(/\[\]$/, "");
    if (p) return p;
  }
  return path;
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function record(stats: Map<string, Stat>, path: string, value: unknown): void {
  let s = stats.get(path);
  if (!s) {
    s = { present: 0, nonEmpty: 0, types: new Set(), examples: [] };
    stats.set(path, s);
  }
  s.present += 1;
  s.types.add(value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
  if (!isEmptyValue(value)) {
    s.nonEmpty += 1;
    if (s.examples.length < 3 && typeof value !== "object") {
      const str = String(value);
      s.examples.push(str.length > 160 ? `${str.slice(0, 160)}…` : str);
    }
  }
}

/** Walk a payload, recording every scalar/array leaf path. Objects recurse;
 *  arrays recurse into their FIRST element only (enough to learn the element
 *  shape without exploding the path space) and are also recorded themselves
 *  so array-presence is countable. */
function walk(
  node: unknown,
  path: string,
  depth: number,
  stats: Map<string, Stat>,
): void {
  if (depth > MAX_DEPTH) return;
  if (node === null || typeof node !== "object") {
    record(stats, path, node);
    return;
  }
  if (Array.isArray(node)) {
    record(stats, path, node);
    if (node.length > 0) walk(node[0], `${path}[]`, depth + 1, stats);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const child = path ? `${path}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      record(stats, child, v);
      walk(v, child, depth + 1, stats);
    } else {
      walk(v, child, depth + 1, stats);
    }
  }
}

async function censusSource(
  db: ReturnType<typeof getDb>,
  sourceId: string,
  maxRows: number,
): Promise<{ scanned: number; total: number; active: number; stats: Map<string, Stat> }> {
  const totalRes = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);
  if (totalRes.error || totalRes.count == null) {
    console.log(`QUERY FAILED (total, ${sourceId}):`, JSON.stringify(totalRes));
    throw new Error(`total count failed for ${sourceId}`);
  }
  const activeRes = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId)
    .eq("is_active", true);
  if (activeRes.error || activeRes.count == null) {
    console.log(`QUERY FAILED (active, ${sourceId}):`, JSON.stringify(activeRes));
    throw new Error(`active count failed for ${sourceId}`);
  }

  const stats = new Map<string, Stat>();
  let scanned = 0;
  let from = 0;
  for (;;) {
    if (scanned >= maxRows) break;
    const to = from + PAGE_SIZE - 1;
    const res = await db
      .from("source_record")
      .select("raw_payload, normalized_payload")
      .eq("source_id", sourceId)
      .order("id", { ascending: true })
      .range(from, to);
    if (res.error || res.data == null) {
      console.log(`QUERY FAILED (page ${from}, ${sourceId}):`, JSON.stringify(res));
      throw new Error(`page read failed for ${sourceId}`);
    }
    const rows = res.data as Array<{
      raw_payload: unknown;
      normalized_payload: unknown;
    }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      walk(r.raw_payload, "raw", 0, stats);
      walk(r.normalized_payload, "norm", 0, stats);
      scanned += 1;
    }
    from += PAGE_SIZE;
    if (scanned % 5000 === 0) {
      process.stderr.write(`  ${sourceId}: ${scanned}/${totalRes.count}\n`);
    }
  }
  return { scanned, total: totalRes.count, active: activeRes.count, stats };
}

function report(
  sourceId: string,
  scanned: number,
  total: number,
  active: number,
  stats: Map<string, Stat>,
): void {
  const sampled = scanned < total;
  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `SOURCE ${sourceId} — ${total} source_record rows (${active} active). ` +
      `Scanned ${scanned}${sampled ? " — SAMPLED, not population" : " — FULL SCAN"}.`,
  );
  console.log("=".repeat(78));

  for (const [concept, re] of Object.entries(CONCEPT_PATTERNS)) {
    const hits = [...stats.entries()]
      .filter(([path]) => re.test(leafName(path)))
      .sort((a, b) => b[1].nonEmpty - a[1].nonEmpty);
    console.log(`\n--- ${concept} candidates ---`);
    if (hits.length === 0) {
      console.log("  (none)");
      continue;
    }
    for (const [path, s] of hits.slice(0, 14)) {
      const pct = scanned > 0 ? ((s.nonEmpty / scanned) * 100).toFixed(1) : "0.0";
      console.log(
        `  ${path}\n    present ${s.present}  non-empty ${s.nonEmpty} (${pct}% of scanned)  ` +
          `types {${[...s.types].join(",")}}`,
      );
      for (const ex of s.examples) console.log(`    e.g. ${ex}`);
    }
    if (hits.length > 14) console.log(`  … ${hits.length - 14} more candidate paths`);
  }
}

async function main(): Promise<void> {
  const program = new Command()
    .option("--sources <list>", "comma-separated source_ids", "")
    .option("--max-rows <n>", "cap rows scanned per source", "1000000")
    .parse(process.argv);
  const opts = program.opts<{ sources: string; maxRows: string }>();
  const sources = opts.sources ? opts.sources.split(",").map((s) => s.trim()) : DEFAULT_SOURCES;
  const maxRows = Number(opts.maxRows);

  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`Target project ref: ${ref}`);
  if (ref !== "znldzjdatkogdktymtvi") {
    throw new Error(`refusing to run against non-TEST project ${ref}`);
  }

  const db = getDb();
  for (const sourceId of sources) {
    const { scanned, total, active, stats } = await censusSource(db, sourceId, maxRows);
    report(sourceId, scanned, total, active, stats);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
