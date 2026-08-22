/**
 * READ-ONLY measurement: how much of the corpus the five enrichment columns
 * (rating / review_count / price_tier / description / photo_url) can actually
 * be populated for, given what the sources carry.
 *
 * Companion to investigate-enrichment-fields-2026-08-21.ts (which found WHERE
 * the data lives). This one counts the affected master_place population, so
 * the backfill's own numbers are measured before it runs rather than after.
 *
 * Every count here is a population count (exact, `count: 'exact'` head
 * queries, or a full paginated scan), not a sample.
 *
 * Writes nothing.
 *
 * Run (from data/):
 *   ../node_modules/.bin/tsx --env-file=.env \
 *     scripts/measure-enrichment-backfill-scope-2026-08-21.ts
 */

import { getDb } from "../ingestion/lib/db.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

type Db = SupabaseClient;

/** Exact count with the null-count trap guarded (see CLAUDE.md §RUNBOOK —
 *  a bad column returns `count: null` with no visible error.message). */
async function exactCount(
  db: Db,
  table: string,
  build: (q: ReturnType<Db["from"]>) => unknown,
  label: string,
): Promise<number> {
  let q: any = db.from(table).select("id", { count: "exact", head: true });
  q = build(q);
  const res = await q;
  if (res.error || res.count == null) {
    console.log(`QUERY FAILED (${label}):`, JSON.stringify(res));
    throw new Error(`count failed: ${label}`);
  }
  return res.count as number;
}

/** Paginate a select, returning every row. */
async function scan<T>(
  db: Db,
  table: string,
  columns: string,
  build: (q: any) => any,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q: any = db.from(table).select(columns);
    q = build(q).order("id", { ascending: true }).range(from, from + PAGE - 1);
    const res = await q;
    if (res.error || res.data == null) {
      console.log(`QUERY FAILED (${label} @${from}):`, JSON.stringify(res));
      throw new Error(`scan failed: ${label}`);
    }
    const rows = res.data as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

type SrRow = {
  master_place_id: string | null;
  source_id: string;
  normalized_payload: Record<string, unknown> | null;
  raw_payload: Record<string, unknown> | null;
};

function normPhotoUrl(np: Record<string, unknown> | null): string | null {
  const photo = np?.photo as { url?: unknown } | null | undefined;
  const url = photo?.url;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
}

function rawProp(rp: Record<string, unknown> | null, key: string): string | null {
  const props = rp?.props as Record<string, unknown> | undefined;
  const v = props?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function normDescription(np: Record<string, unknown> | null): string | null {
  const d = np?.description;
  return typeof d === "string" && d.trim().length > 0 ? d.trim() : null;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`Target project ref: ${ref}`);
  if (ref !== "znldzjdatkogdktymtvi") {
    throw new Error(`refusing to run against non-TEST project ${ref}`);
  }
  const db = getDb();

  // ── 1. master_place baseline ────────────────────────────────────────
  const mpTotal = await exactCount(db, "master_place", (q) => q, "master_place total");
  const mpLive = await exactCount(
    db,
    "master_place",
    (q: any) => q.gt("source_count", 0),
    "master_place source_count>0",
  );
  const mpDesc = await exactCount(
    db,
    "master_place",
    (q: any) => q.not("description", "is", null),
    "master_place description not null",
  );
  console.log("\n=== master_place baseline (population counts) ===");
  console.log(`master_place rows                      ${mpTotal}`);
  console.log(`  with source_count > 0                ${mpLive}`);
  console.log(`  with description non-null            ${mpDesc}`);

  // ── 2. field_precedence coverage per source ─────────────────────────
  const fpRes = await db.from("field_precedence").select("source_id, field_name");
  if (fpRes.error || fpRes.data == null) {
    console.log("QUERY FAILED (field_precedence):", JSON.stringify(fpRes));
    throw new Error("field_precedence read failed");
  }
  const fpBySource = new Map<string, Set<string>>();
  for (const r of fpRes.data as { source_id: string; field_name: string }[]) {
    if (!fpBySource.has(r.source_id)) fpBySource.set(r.source_id, new Set());
    fpBySource.get(r.source_id)!.add(r.field_name);
  }
  console.log("\n=== field_precedence coverage (which sources can reach master_place at all) ===");
  for (const s of ["osm", "nps", "ridb", "state_parks", "atlas_oddities", "blm", "usfs", "padus"]) {
    const fields = fpBySource.get(s);
    console.log(
      `  ${s.padEnd(16)} ${fields ? `${fields.size} field(s): ${[...fields].sort().join(", ")}` : "NO ROWS — contributes no resolved field"}`,
    );
  }

  // ── 3. photo source coverage, per source, at master_place grain ─────
  console.log("\n=== photo coverage (active source_records → distinct master_place) ===");
  const photoSources = ["nps", "ridb", "blm", "state_parks"] as const;
  const mpPhoto = new Map<string, { url: string; source: string }>();
  // Precedence for the backfill: nps > ridb (mirrors the existing photo
  // LEFT JOIN LATERAL in master_place_search_export / pois_along_corridor),
  // then blm, then state_parks (both new — neither is in that lateral).
  const PRECEDENCE = ["nps", "ridb", "blm", "state_parks"];
  const perSource: Record<string, { rowsWithPhoto: number; distinctMp: number; linkedMp: number }> = {};

  for (const src of photoSources) {
    const rows = await scan<SrRow>(
      db,
      "source_record",
      "id, master_place_id, source_id, normalized_payload, raw_payload",
      (q: any) => q.eq("source_id", src).eq("is_active", true),
      `source_record ${src}`,
    );
    let rowsWithPhoto = 0;
    const distinct = new Set<string>();
    let linked = 0;
    for (const r of rows) {
      let url: string | null = null;
      if (src === "nps" || src === "ridb") url = normPhotoUrl(r.normalized_payload);
      else if (src === "blm") url = rawProp(r.raw_payload, "PHOTO_LINK");
      else if (src === "state_parks") url = rawProp(r.raw_payload, "Imagelink");
      if (!url) continue;
      rowsWithPhoto += 1;
      if (!r.master_place_id) continue;
      linked += 1;
      distinct.add(r.master_place_id);
      const cur = mpPhoto.get(r.master_place_id);
      if (!cur || PRECEDENCE.indexOf(src) < PRECEDENCE.indexOf(cur.source)) {
        mpPhoto.set(r.master_place_id, { url, source: src });
      }
    }
    perSource[src] = { rowsWithPhoto, distinctMp: distinct.size, linkedMp: linked };
    console.log(
      `  ${src.padEnd(12)} active rows carrying a photo url: ${rowsWithPhoto}` +
        `  (linked to a master_place: ${linked}; distinct master_place: ${distinct.size})`,
    );
  }
  const winnerBySource = new Map<string, number>();
  for (const v of mpPhoto.values()) {
    winnerBySource.set(v.source, (winnerBySource.get(v.source) ?? 0) + 1);
  }
  console.log(`  → distinct master_place that would get photo_url: ${mpPhoto.size}`);
  console.log(
    `    winning source split: ${[...winnerBySource].sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`,
  );

  // ── 4. description: what is stranded behind missing field_precedence ─
  console.log("\n=== description: source-carried vs reaching master_place.description ===");
  const descSources = ["blm", "state_parks", "atlas_oddities"] as const;
  const mpIdsNeedingDesc = new Set<string>();
  for (const src of descSources) {
    const rows = await scan<SrRow>(
      db,
      "source_record",
      "id, master_place_id, source_id, normalized_payload, raw_payload",
      (q: any) => q.eq("source_id", src).eq("is_active", true),
      `source_record ${src} desc`,
    );
    let withDesc = 0;
    const mpIds = new Set<string>();
    for (const r of rows) {
      const d = normDescription(r.normalized_payload);
      if (!d) continue;
      withDesc += 1;
      if (r.master_place_id) mpIds.add(r.master_place_id);
    }
    // How many of those master_places currently have a NULL description?
    let nullDesc = 0;
    const ids = [...mpIds];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const res = await db
        .from("master_place")
        .select("id", { count: "exact", head: true })
        .in("id", chunk)
        .is("description", null);
      if (res.error || res.count == null) {
        console.log(`QUERY FAILED (${src} null-desc chunk):`, JSON.stringify(res));
        throw new Error("null-desc count failed");
      }
      nullDesc += res.count;
    }
    for (const id of mpIds) mpIdsNeedingDesc.add(id);
    console.log(
      `  ${src.padEnd(16)} active rows with a non-empty normalized description: ${withDesc}` +
        `  → distinct linked master_place ${mpIds.size}, of which master_place.description IS NULL: ${nullDesc}` +
        `  [field_precedence description row: ${fpBySource.get(src)?.has("description") ? "present" : "ABSENT"}]`,
    );
  }

  // ── 5. rating / review_count / price_tier ───────────────────────────
  console.log("\n=== rating / review_count / price_tier ===");
  console.log(
    "  No source_record payload key matching a rating, review-count, or price-tier\n" +
      "  concept was found by the full-scan census (investigate-enrichment-fields-\n" +
      "  2026-08-21.ts). See that script's output for the near-miss candidates that\n" +
      "  were examined and rejected. Backfill population for these three: 0.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
