/**
 * READ-only diagnostic for the 47% photo-coverage figure.
 *
 * STEP 1a: split TEST ridb source_records by entity type (facility vs recarea)
 * and report photo coverage in each bucket.
 *
 * STEP 1b: sample 20 photoless rows, hit the LIVE /media endpoint for each,
 * write raw responses to data/.cache/ridb-media-diagnostic/ (gitignored),
 * and bucket every response into:
 *   - HTTP 404
 *   - HTTP 200 with empty RECDATA
 *   - HTTP 200 with non-empty RECDATA (report MediaType + IsPrimary per entry)
 *
 * If any row lands in the third bucket, that is a selection bug in
 * ridbPhotoFromMedia — the script reports "SELECTION BUG SUSPECTED" and
 * halts before returning.
 */

import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ridbPhotoFromMedia } from "../ingestion/sources/ridb.ts";

const RIDB_BASE = "https://ridb.recreation.gov/api/v1";
const USER_AGENT = "overlander-data-diagnostic/0.0.1";
// Resolve relative to THIS file, not cwd — otherwise `data/.cache/...` from a
// script run inside `data/` lands at `data/data/.cache/...`.
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", ".cache", "ridb-media-diagnostic");

function requireApiKey(): string {
  const k = process.env.RIDB_API_KEY;
  if (!k) throw new Error("RIDB_API_KEY not set");
  return k;
}

type Row = {
  id: string;
  external_id: string;
  normalized_payload: Record<string, unknown> | null;
};

function parseExternal(externalId: string): { entity: "facilities" | "recareas"; id: string } | null {
  const parts = externalId.split(":");
  if (parts.length !== 3 || parts[0] !== "ridb") return null;
  if (parts[1] === "facility") return { entity: "facilities", id: parts[2] };
  if (parts[1] === "recarea") return { entity: "recareas", id: parts[2] };
  return null;
}

function hasPhoto(row: Row): boolean {
  const p = (row.normalized_payload ?? {}).photo as { url?: unknown } | null | undefined;
  return p != null && typeof p === "object" && typeof p.url === "string" && (p.url as string).length > 0;
}

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`[env] target: ${ref}`);

  // ---- STEP 1a: entity-type split ----
  console.log("\n═══ STEP 1a — TEST ridb source_records by entity type ═══");
  const rows = (
    await db.from("source_record").select("id, external_id, normalized_payload").eq("source_id", "ridb")
  ).data as Row[];
  console.log(`  total ridb rows: ${rows.length}`);

  const buckets = {
    facility: { total: 0, withPhoto: 0, photoless: [] as Row[] },
    recarea: { total: 0, withPhoto: 0, photoless: [] as Row[] },
    other: { total: 0, withPhoto: 0, photoless: [] as Row[] },
  };
  for (const r of rows) {
    const parsed = parseExternal(r.external_id);
    const key = parsed?.entity === "facilities" ? "facility" : parsed?.entity === "recareas" ? "recarea" : "other";
    buckets[key].total += 1;
    if (hasPhoto(r)) buckets[key].withPhoto += 1;
    else buckets[key].photoless.push(r);
  }
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
  console.log(`  facilities : ${buckets.facility.total}  with photo: ${buckets.facility.withPhoto}  (${pct(buckets.facility.withPhoto, buckets.facility.total)})`);
  console.log(`  recareas   : ${buckets.recarea.total}  with photo: ${buckets.recarea.withPhoto}  (${pct(buckets.recarea.withPhoto, buckets.recarea.total)})`);
  console.log(`  other      : ${buckets.other.total}  with photo: ${buckets.other.withPhoto}`);

  // ---- STEP 1b: sample 20 photoless rows and re-fetch /media ----
  console.log("\n═══ STEP 1b — sample 20 photoless rows, live /media call ═══");
  // Weight the sample: 15 facilities + 5 recareas if possible (facilities are
  // 88% of the corpus). Deterministic — take the first N by id order for
  // repeatable diagnostic runs.
  const sortById = (a: Row, b: Row) => (a.id < b.id ? -1 : 1);
  buckets.facility.photoless.sort(sortById);
  buckets.recarea.photoless.sort(sortById);
  const sample: Row[] = [
    ...buckets.facility.photoless.slice(0, 15),
    ...buckets.recarea.photoless.slice(0, 5),
  ];
  console.log(`  sample size: ${sample.length}  (facility: ${Math.min(15, buckets.facility.photoless.length)}  recarea: ${Math.min(5, buckets.recarea.photoless.length)})`);

  await mkdir(OUT_DIR, { recursive: true });
  const apiKey = requireApiKey();

  type Result = {
    external_id: string;
    entity: "facilities" | "recareas";
    id: string;
    http_status: number;
    array_length: number;
    entries: Array<{ MediaType?: unknown; IsPrimary?: unknown; URL?: unknown }>;
    bucket: "404" | "200-empty" | "200-with-media";
    would_be_selected: { url: string; altText: string | null; credit: string | null } | null;
  };
  const results: Result[] = [];

  for (const r of sample) {
    const parsed = parseExternal(r.external_id);
    if (!parsed) continue;
    const url = `${RIDB_BASE}/${parsed.entity}/${encodeURIComponent(parsed.id)}/media`;
    const res = await fetch(url, {
      headers: { apikey: apiKey, Accept: "application/json", "User-Agent": USER_AGENT },
    });
    let bodyText = "";
    let arr: unknown[] = [];
    try {
      bodyText = await res.text();
      const json = bodyText ? JSON.parse(bodyText) : null;
      if (json && Array.isArray(json.RECDATA)) arr = json.RECDATA;
    } catch {
      // fall through — parse failure treated as empty
    }
    const bucket = res.status === 404 ? "404" : arr.length === 0 ? "200-empty" : "200-with-media";
    const entries = arr.map((e) => {
      const o = e as { MediaType?: unknown; IsPrimary?: unknown; URL?: unknown };
      return { MediaType: o?.MediaType, IsPrimary: o?.IsPrimary, URL: o?.URL };
    });
    const selected = ridbPhotoFromMedia(arr);
    results.push({
      external_id: r.external_id,
      entity: parsed.entity,
      id: parsed.id,
      http_status: res.status,
      array_length: arr.length,
      entries,
      bucket,
      would_be_selected: selected,
    });

    // Dump raw response
    const safeExt = r.external_id.replace(/[^A-Za-z0-9._-]+/g, "_");
    await writeFile(join(OUT_DIR, `${safeExt}.json`), JSON.stringify({
      external_id: r.external_id,
      url,
      http_status: res.status,
      body: bodyText,
    }, null, 2));
  }

  console.log(`\n  raw responses written to ${OUT_DIR}/*.json`);
  console.log(`\n  per-row detail:`);
  for (const r of results) {
    const mts = r.entries.map((e) => `${e.MediaType}${e.IsPrimary === true || e.IsPrimary === "true" ? "*" : ""}`).join(",");
    const selMark = r.bucket === "200-with-media" ? (r.would_be_selected ? "  → selected" : "  → REJECTED-BY-SELECTOR") : "";
    console.log(`    ${r.external_id.padEnd(30)}  status ${r.http_status}  len ${String(r.array_length).padStart(2)}  bucket=${r.bucket.padEnd(15)}  types=[${mts}]${selMark}`);
  }

  const b404 = results.filter((r) => r.bucket === "404").length;
  const b200empty = results.filter((r) => r.bucket === "200-empty").length;
  const b200media = results.filter((r) => r.bucket === "200-with-media");
  const rejectedByLogic = b200media.filter((r) => r.would_be_selected === null);
  const acceptedByLogic = b200media.filter((r) => r.would_be_selected !== null);

  console.log(`\n═══ STEP 1b — bucket summary ═══`);
  console.log(`  HTTP 404                                        : ${b404}`);
  console.log(`  HTTP 200 empty RECDATA                          : ${b200empty}`);
  console.log(`  HTTP 200 with media                             : ${b200media.length}`);
  console.log(`    - accepted by ridbPhotoFromMedia              : ${acceptedByLogic.length}`);
  console.log(`    - REJECTED by ridbPhotoFromMedia (SUSPICIOUS) : ${rejectedByLogic.length}`);

  if (rejectedByLogic.length > 0) {
    console.log(`\n⚠️  SELECTION BUG SUSPECTED — ${rejectedByLogic.length} row(s) returned MEDIA but ridbPhotoFromMedia picked null:`);
    for (const r of rejectedByLogic) {
      console.log(`  ${r.external_id}  entries:`, JSON.stringify(r.entries, null, 2));
    }
    console.log(`\n  Halting per instructions. See raw payloads in ${OUT_DIR}/`);
    process.exit(2);
  } else if (acceptedByLogic.length > 0) {
    console.log(`\n⚠️  BACKFILL GAP — ${acceptedByLogic.length} sampled rows have media the selector accepts but the backfill left photo=null. This is not a selection bug, but the backfill either wasn't run against these rows or something else is filtering them. Report to caller.`);
  } else {
    console.log(`\n✓ NO SELECTION BUG. All photoless rows in the sample are either 404 or 200-empty at the RIDB source. The 47% coverage is upstream truth, not our logic.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
