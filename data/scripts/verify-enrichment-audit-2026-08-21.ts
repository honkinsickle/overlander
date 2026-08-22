/**
 * READ-ONLY. The measurement basis for the CORRECTIONS in
 * docs/measurements/2026-08-21-master-place-enrichment-columns.md.
 *
 * WHY THIS FILE EXISTS. The first version of that report carried four claims
 * that a self-audit found wrong or under-scoped. The re-measurements that
 * corrected them were originally run from three throwaway scripts that were
 * deleted immediately after — so the corrected numbers were, briefly, less
 * reproducible than the wrong ones they replaced. This file is those three
 * probes, committed, in the repo's normal `measure-` / `verify-` script
 * convention.
 *
 * Every number this prints appears in that report. Specifically:
 *
 *   §A  field_precedence coverage per source, by DIRECT per-source filter
 *       rather than by grouping a full read — backs report §5's "blm and
 *       atlas_oddities have NO field_precedence rows for ANY field".
 *   §B  The 693 / 214 split of the 907 column-only rows — backs report §4b,
 *       which corrected "the rest are rows the view's own filters exclude".
 *   §C  Inactive nps/ridb source_records carrying a photo url — the entire
 *       basis of report §4a, i.e. WHY "0 view-only" held. If this ever
 *       returns non-zero, §4a's prediction has come true.
 *   §D  State scoping of the fields credited to state_parks and blm — backs
 *       the report's Washington-only correction (Imagelink 138/138 WA,
 *       Description 97/97 WA). Read §D's own caveat about BLM.
 *   §E  Full key-space enumeration per source (every distinct leaf name, no
 *       pattern filter) — backs report §3a, the exhaustive re-check that
 *       replaced the regex census as the absence proof for rating /
 *       reviewCount / priceTier.
 *   §F  Whether OSM carries a `pricing` tag at all — the concrete leak that
 *       showed the regex census was not an absence proof (`price` is not a
 *       substring of `pricing`).
 *
 * §E scans every source_record row of seven sources including osm's ~109k,
 * so it is by far the slowest section. Use --sections to run a subset.
 *
 * Writes nothing. TEST only — refuses to run against any other project ref.
 *
 * Run (from data/):
 *   ../node_modules/.bin/tsx --env-file=.env \
 *     scripts/verify-enrichment-audit-2026-08-21.ts
 *   ... --sections A,B,C,D        # skip the slow key-space scan
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";

const TEST_REF = "znldzjdatkogdktymtvi";
const PAGE = 1000;
/** PostgREST puts .in() lists in the URL; larger chunks overflow the server's
 *  header limit (measured: a 400-id chunk produced UND_ERR_HEADERS_OVERFLOW). */
const IN_CHUNK = 50;
/** Full-payload pages are large; 500 keeps each response manageable. */
const PAYLOAD_PAGE = 500;
const MAX_DEPTH = 4;

type Db = SupabaseClient;

/** Exact count. `count: null` is a FAILURE signal, not a data value — a
 *  supabase-js query with a bad column returns a null count and often an
 *  empty error.message (CLAUDE.md §RUNBOOK). Log the WHOLE response.
 *  NOTE the `select("*")`: `select("id")` 400s on field_precedence, which has
 *  no id column — that exact mistake cost a run during the audit. */
async function exactCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q: any,
  label: string,
): Promise<number> {
  const res = await q;
  if (res.error || res.count == null) {
    console.log(`QUERY FAILED (${label}):`, JSON.stringify(res));
    throw new Error(`count failed: ${label}`);
  }
  return res.count as number;
}

/** Paginate a select to exhaustion. */
async function scanAll<T>(
  db: Db,
  table: string,
  columns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: (q: any) => any,
  label: string,
  pageSize = PAGE,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = build(db.from(table).select(columns))
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    const res = await q;
    if (res.error || res.data == null) {
      console.log(`QUERY FAILED (${label} @${from}):`, JSON.stringify(res));
      throw new Error(`scan failed: ${label}`);
    }
    const rows = res.data as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ── §A ────────────────────────────────────────────────────────────────
async function sectionA(db: Db): Promise<void> {
  console.log("\n=== §A field_precedence rows by source_id (direct per-source filter) ===");
  for (const s of ["blm", "atlas_oddities", "state_parks", "usfs", "nps", "ridb", "osm", "padus"]) {
    const n = await exactCount(
      db.from("field_precedence").select("*", { count: "exact", head: true }).eq("source_id", s),
      `field_precedence ${s}`,
    );
    console.log(`  source_id=${s.padEnd(16)} rows=${n}${n === 0 ? "   ← contributes NO resolved field to master_place" : ""}`);
  }
  const all = await db.from("field_precedence").select("source_id");
  if (all.error || all.data == null) {
    console.log("QUERY FAILED (field_precedence all):", JSON.stringify(all));
    throw new Error("field_precedence read failed");
  }
  const rows = all.data as { source_id: string }[];
  console.log(
    `  ${rows.length} rows total; distinct source_ids: ${[...new Set(rows.map((r) => r.source_id))].sort().join(", ")}`,
  );
}

// ── §B ────────────────────────────────────────────────────────────────
async function sectionB(db: Db): Promise<string[]> {
  console.log("\n=== §B column-only rows: absent from the export view, or present-but-blank? ===");
  const colIds = (
    await scanAll<{ id: string }>(db, "master_place", "id", (q) => q.not("photo_url", "is", null), "master_place.photo_url")
  ).map((r) => r.id);
  const viewWithPhoto = new Set(
    (
      await scanAll<{ id: string }>(
        db,
        "master_place_search_export",
        "id",
        (q) => q.not("photo_url", "is", null),
        "export view photo_url",
      )
    ).map((r) => r.id),
  );
  const colOnly = colIds.filter((id) => !viewWithPhoto.has(id));
  console.log(`  master_place rows with photo_url: ${colIds.length}`);
  console.log(`  export-view rows with photo_url:  ${viewWithPhoto.size}`);
  console.log(`  column-only:                      ${colOnly.length}`);

  let inView = 0;
  for (let i = 0; i < colOnly.length; i += IN_CHUNK) {
    inView += await exactCount(
      db
        .from("master_place_search_export")
        .select("*", { count: "exact", head: true })
        .in("id", colOnly.slice(i, i + IN_CHUNK)),
      `column-only in-view @${i}`,
    );
  }
  console.log(`  → PRESENT in the view, photo_url NULL (its lateral covers only nps/ridb): ${inView}`);
  console.log(`  → ABSENT from the view (excluded by is_searchable / source_count / footprint): ${colOnly.length - inView}`);

  // Which sources sit on the column-only rows. NOT a partition — a
  // master_place can carry several sources, so these overlap.
  const bySource = new Map<string, Set<string>>();
  for (let i = 0; i < colOnly.length; i += IN_CHUNK) {
    const res = await db
      .from("source_record")
      .select("master_place_id, source_id")
      .in("master_place_id", colOnly.slice(i, i + IN_CHUNK))
      .eq("is_active", true);
    if (res.error || res.data == null) {
      console.log("QUERY FAILED (column-only source mix):", JSON.stringify(res));
      throw new Error("column-only source mix failed");
    }
    for (const r of res.data as { master_place_id: string; source_id: string }[]) {
      if (!bySource.has(r.source_id)) bySource.set(r.source_id, new Set());
      bySource.get(r.source_id)!.add(r.master_place_id);
    }
  }
  console.log(`  active source_ids across ALL ${colOnly.length} (population; OVERLAPPING, not a partition):`);
  for (const [s, ids] of [...bySource].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`    ${s.padEnd(16)} ${ids.size}`);
  }
  return colOnly;
}

// ── §C ────────────────────────────────────────────────────────────────
async function sectionC(db: Db): Promise<void> {
  console.log("\n=== §C inactive nps/ridb source_records carrying a photo url ===");
  console.log("  (this is WHY '0 view-only' held — the view's lateral has no is_active");
  console.log("   filter, the RPC does, so a non-zero here is the divergence going live)");
  let total = 0;
  for (const s of ["nps", "ridb"]) {
    const n = await exactCount(
      db
        .from("source_record")
        .select("*", { count: "exact", head: true })
        .eq("source_id", s)
        .eq("is_active", false)
        .not("normalized_payload->photo->>url", "is", null),
      `inactive ${s} with photo`,
    );
    total += n;
    console.log(`  ${s}: INACTIVE rows with normalized_payload.photo.url = ${n}`);
  }
  console.log(
    total === 0
      ? "  → 0. The column/view superset relationship holds TODAY, by data, not by design."
      : `  → ${total} > 0. Report §4a's prediction has come true: re-run the backfill and\n` +
          "    expect the export view to serve photos the column (correctly) does not.",
  );
}

// ── §D ────────────────────────────────────────────────────────────────
async function sectionD(db: Db): Promise<void> {
  console.log("\n=== §D state scoping of fields credited to a whole source ===");
  for (const [src, key] of [
    ["state_parks", "Imagelink"],
    ["state_parks", "Description"],
    ["blm", "PHOTO_LINK"],
    ["blm", "DESCRIPTION"],
  ] as const) {
    const rows = await scanAll<{ external_id: string; raw_payload: Record<string, unknown> | null }>(
      db,
      "source_record",
      "id, external_id, raw_payload",
      (q) => q.eq("source_id", src).eq("is_active", true),
      `${src} raw_payload`,
      PAYLOAD_PAGE,
    );
    const byState = new Map<string, number>();
    for (const x of rows) {
      const props = x.raw_payload?.props as Record<string, unknown> | undefined;
      const v = props?.[key];
      if (typeof v !== "string" || !v.trim()) continue;
      // state_parks stamps the state on raw_payload.state; nothing equivalent
      // exists for blm — see the caveat printed below.
      const st =
        typeof x.raw_payload?.state === "string"
          ? x.raw_payload.state
          : (x.external_id.split(":")[1] ?? "?");
      byState.set(st, (byState.get(st) ?? 0) + 1);
    }
    const total = [...byState.values()].reduce((a, b) => a + b, 0);
    console.log(
      `  ${src}.props.${key}: ${total} non-empty active rows of ${rows.length} — ` +
        `${[...byState].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`,
    );
  }
  console.log(
    "\n  ⚠ CAVEAT — the blm lines above do NOT carry a state breakdown. blm\n" +
      "    source_records have no raw_payload.state, and the external_id fallback\n" +
      "    resolves to a URL-path token ('recpt'), not a state. The report therefore\n" +
      "    makes NO claim in either direction about how blm's rows distribute across\n" +
      "    states. Do not read the blm bucket label as a state.",
  );
}

// ── §E ────────────────────────────────────────────────────────────────
function walk(node: unknown, path: string, depth: number, out: Set<string>): void {
  if (depth > MAX_DEPTH) return;
  if (node === null || typeof node !== "object") {
    out.add(path);
    return;
  }
  if (Array.isArray(node)) {
    out.add(path);
    if (node.length > 0) walk(node[0], `${path}[]`, depth + 1, out);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const child = path ? `${path}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out.add(child);
      walk(v, child, depth + 1, out);
    } else {
      walk(v, child, depth + 1, out);
    }
  }
}

async function sectionE(db: Db, printLeaves: boolean): Promise<void> {
  console.log("\n=== §E full key-space per source (NO pattern filter — the absence proof) ===");
  console.log("  A regex census is a DISCOVERY instrument, not an absence proof: the");
  console.log("  priceTier pattern contained `price`, and `price` is not a substring of");
  console.log("  `pricing`, so OSM's pricing tags were never reported by it (see §F).");
  console.log("  This enumerates every distinct leaf name instead.\n");
  console.log("  source            rows      key paths   leaf names");
  for (const src of ["nps", "ridb", "state_parks", "blm", "usfs", "atlas_oddities", "osm"]) {
    const paths = new Set<string>();
    let n = 0;
    let from = 0;
    for (;;) {
      const res = await db
        .from("source_record")
        .select("raw_payload, normalized_payload")
        .eq("source_id", src)
        .order("id", { ascending: true })
        .range(from, from + PAYLOAD_PAGE - 1);
      if (res.error || res.data == null) {
        console.log(`QUERY FAILED (§E ${src} @${from}):`, JSON.stringify(res));
        throw new Error(`key-space scan failed for ${src}`);
      }
      const rows = res.data as { raw_payload: unknown; normalized_payload: unknown }[];
      for (const x of rows) {
        walk(x.raw_payload, "raw", 0, paths);
        walk(x.normalized_payload, "norm", 0, paths);
        n += 1;
      }
      if (rows.length < PAYLOAD_PAGE) break;
      from += PAYLOAD_PAGE;
    }
    const leaves = new Set([...paths].map((p) => p.split(".").pop()!.replace(/\[\]$/, "")));
    console.log(`  ${src.padEnd(16)} ${String(n).padStart(8)}  ${String(paths.size).padStart(9)}  ${String(leaves.size).padStart(10)}`);
    if (printLeaves) console.log(`    ${[...leaves].sort().join(" · ")}\n`);
  }
  console.log(
    "\n  Result (2026-08-21): no leaf name in any of these seven denotes a user\n" +
      "  rating, a review count, or a price tier. Near-misses this pass surfaced and\n" +
      "  the regex census missed: NPS relevanceScore (API search relevance, not a\n" +
      "  user rating) and USFS development_scale / usage_level (site classifications).\n" +
      "  Re-run with --leaves to print the full lists and re-judge them yourself.",
  );
}

// ── §F ────────────────────────────────────────────────────────────────
async function sectionF(db: Db): Promise<void> {
  console.log("\n=== §F does OSM carry a `pricing` tag? (the concrete regex-census leak) ===");
  const hits: string[] = [];
  let n = 0;
  let from = 0;
  for (;;) {
    const res = await db
      .from("source_record")
      .select("external_id, raw_payload, normalized_payload")
      .eq("source_id", "osm")
      .order("id", { ascending: true })
      .range(from, from + PAYLOAD_PAGE - 1);
    if (res.error || res.data == null) {
      console.log(`QUERY FAILED (§F @${from}):`, JSON.stringify(res));
      throw new Error("osm pricing scan failed");
    }
    const rows = res.data as {
      external_id: string;
      raw_payload: unknown;
      normalized_payload: unknown;
    }[];
    for (const x of rows) {
      n += 1;
      const s = JSON.stringify(x.raw_payload) + JSON.stringify(x.normalized_payload);
      if (s.includes('"pricing')) hits.push(x.external_id);
    }
    if (rows.length < PAYLOAD_PAGE) break;
    from += PAYLOAD_PAGE;
  }
  console.log(`  osm rows scanned ${n}; rows whose payload carries a "pricing…" key: ${hits.length}`);
  for (const id of hits.slice(0, 5)) console.log(`    ${id}`);
  console.log(
    "  Judgement (2026-08-21): `pricing=by_request` plus pricing:display /\n" +
      "  :check_method / :check_required — checkout metadata, NOT a price tier.\n" +
      "  Rejected on content. The finding here is that the regex census never\n" +
      "  surfaced them at all, which is why §E exists.",
  );
}

async function main(): Promise<void> {
  const program = new Command()
    .option("--sections <list>", "comma-separated section letters, e.g. A,B,C", "A,B,C,D,E,F")
    .option("--leaves", "in §E, print every leaf name per source (long)", false)
    .parse(process.argv);
  const opts = program.opts<{ sections: string; leaves: boolean }>();
  const want = new Set(opts.sections.split(",").map((s) => s.trim().toUpperCase()));

  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`Target project ref: ${ref}`);
  if (ref !== TEST_REF) throw new Error(`refusing to run against non-TEST project ${ref}`);
  const db = getDb();

  if (want.has("A")) await sectionA(db);
  if (want.has("B")) await sectionB(db);
  if (want.has("C")) await sectionC(db);
  if (want.has("D")) await sectionD(db);
  if (want.has("E")) await sectionE(db, opts.leaves);
  if (want.has("F")) await sectionF(db);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
