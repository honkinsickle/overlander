/**
 * Atlas Obscura oddities — manual content ingest (TEST only).
 *
 * Fills description + photo on ~1,789 existing atlas_oddities source_records
 * on TEST, matched by external_id (`atlasobscura:<slug>`, parsed from the AO
 * URL). Sources three manually-supplied CSVs in
 * /Users/adamwagner/atlas-obscura-{or,ca}/data/; resolution priority when a
 * slug appears in more than one CSV is CA > OR > LA. LA has no photo
 * columns so LA rows contribute description only.
 *
 * Flow C per Adam's 2026-08-27 direction: source_record write PLUS
 * recompute_master_place() so descriptions flow to master_place.description
 * (via the new field_precedence row for atlas_oddities, priority 6, added
 * by migration 20260827180000), PLUS backfill_master_place_photo_url() so
 * photos flow to master_place.photo_url (via the same migration extending
 * the RPC's precedence chain).
 *
 * Refuses to run against anything other than the TEST project.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/atlas-oddities-manual-content-ingest.ts [--dry-run]
 */

import { readFileSync } from "node:fs";
import { getDb } from "../ingestion/lib/db.ts";

const TEST_URL = "https://znldzjdatkogdktymtvi.supabase.co";
if (process.env.SUPABASE_URL !== TEST_URL) {
  console.error(`Refusing to run — SUPABASE_URL is not TEST. Got: ${process.env.SUPABASE_URL}`);
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const db = getDb();

// Priority order: CA first (largest + has photos), then OR (independent set),
// then LA (fills any residual — mostly no-op since LA is a near-subset of CA).
const CSV_SOURCES: ReadonlyArray<{ label: string; path: string; hasPhoto: boolean }> = [
  { label: "CA", path: "/Users/adamwagner/atlas-obscura-ca/data/california.csv", hasPhoto: true },
  { label: "OR", path: "/Users/adamwagner/atlas-obscura-or/data/oregon.csv", hasPhoto: true },
  { label: "LA", path: "/Users/adamwagner/atlas-obscura-ca/data/los-angeles.csv", hasPhoto: false },
];

type Row = Record<string, string>;

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      record.push(field);
      field = "";
      continue;
    }
    if (c === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  const header = rows[0];
  const out: Row[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === "") continue;
    if (cols.length !== header.length) continue;
    const obj: Row = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c];
    out.push(obj);
  }
  return out;
}

function slugFromUrl(url: string): string | null {
  const m = url.match(/atlasobscura\.com\/places\/([^/?#]+)/);
  return m ? m[1] : null;
}

type Chosen = {
  externalId: string;
  slug: string;
  source: string;  // CA / OR / LA
  about: string;
  photoUrl: string | null;
};

function chooseRows(): Chosen[] {
  const chosen = new Map<string, Chosen>();
  const contributions: Record<string, number> = { CA: 0, OR: 0, LA: 0 };
  const overrides: Record<string, number> = {};
  for (const cfg of CSV_SOURCES) {
    const text = readFileSync(cfg.path, "utf8");
    const rows = parseCsv(text);
    for (const row of rows) {
      const slug = slugFromUrl(row.url ?? "");
      if (!slug) continue;
      const eid = `atlasobscura:${slug}`;
      if (chosen.has(eid)) {
        overrides[cfg.label] = (overrides[cfg.label] ?? 0) + 1;
        continue;
      }
      const about = (row.about ?? "").trim();
      if (!about) continue;
      const photoUrl = cfg.hasPhoto ? ((row.photo_source_url ?? "").trim() || null) : null;
      chosen.set(eid, {
        externalId: eid,
        slug,
        source: cfg.label,
        about,
        photoUrl,
      });
      contributions[cfg.label] = (contributions[cfg.label] ?? 0) + 1;
    }
  }
  console.log("Slugs chosen per CSV:", contributions);
  console.log("Slugs already-covered when parsed (dedup skips):", overrides);
  return Array.from(chosen.values());
}

type SrRow = {
  id: string;
  external_id: string;
  master_place_id: string | null;
  normalized_payload: Record<string, unknown>;
  is_active: boolean;
};

async function fetchMatchedSourceRecords(externalIds: string[]): Promise<SrRow[]> {
  const out: SrRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const chunk = externalIds.slice(i, i + CHUNK);
    const resp = await db
      .from("source_record")
      .select("id, external_id, master_place_id, normalized_payload, is_active")
      .eq("source_id", "atlas_oddities")
      .in("external_id", chunk);
    if (resp.error || resp.data == null) {
      console.error("QUERY FAILED (fetch matched):", resp);
      process.exit(1);
    }
    for (const r of resp.data) out.push(r as unknown as SrRow);
  }
  return out;
}

async function countAoWithDescription(): Promise<number> {
  const r = await db
    .from("source_record")
    .select("external_id", { count: "exact", head: true })
    .eq("source_id", "atlas_oddities")
    .not("normalized_payload->>description", "is", null);
  if (r.error || r.count == null) {
    console.error("QUERY FAILED (aoDesc count):", r);
    process.exit(1);
  }
  return r.count;
}

async function countAoWithPhoto(): Promise<number> {
  const r = await db
    .from("source_record")
    .select("external_id", { count: "exact", head: true })
    .eq("source_id", "atlas_oddities")
    .not("normalized_payload->photo", "is", null);
  if (r.error || r.count == null) {
    console.error("QUERY FAILED (aoPhoto count):", r);
    process.exit(1);
  }
  return r.count;
}

async function countMpAoDescription(mpIds: string[]): Promise<number> {
  // Count master_place rows in mpIds where attribution.description = 'atlas_oddities'.
  let total = 0;
  const CHUNK = 100;
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db
      .from("master_place")
      .select("id", { count: "exact", head: true })
      .in("id", chunk)
      .eq("attribution->>description", "atlas_oddities");
    if (r.error || r.count == null) {
      console.error("QUERY FAILED (mpAoDesc count):", r);
      process.exit(1);
    }
    total += r.count;
  }
  return total;
}

async function countMpAoPhoto(mpIds: string[]): Promise<number> {
  // Count master_place rows in mpIds where photo_url is non-null AND
  // (best-effort) attributable to AO — which we can't tell from photo_url
  // alone. As a proxy: count mp rows in mpIds with non-null photo_url whose
  // *only* photo-carrying linked source_records are atlas_oddities. For a
  // straightforward "how many mp rows in scope now carry a photo url"
  // report, count non-null photo_url within the id set.
  let withPhoto = 0;
  const CHUNK = 100;
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db
      .from("master_place")
      .select("id", { count: "exact", head: true })
      .in("id", chunk)
      .not("photo_url", "is", null);
    if (r.error || r.count == null) {
      console.error("QUERY FAILED (mpAoPhoto count):", r);
      process.exit(1);
    }
    withPhoto += r.count;
  }
  return withPhoto;
}

async function updateOneSourceRecord(
  sr: SrRow,
  desc: string,
  photoUrl: string | null,
): Promise<void> {
  const next: Record<string, unknown> = { ...sr.normalized_payload, description: desc };
  next.photo = photoUrl
    ? { url: photoUrl, credit: "Atlas Obscura" }
    : (sr.normalized_payload as Record<string, unknown>).photo ?? null;

  const resp = await db
    .from("source_record")
    .update({ normalized_payload: next })
    .eq("id", sr.id);
  if (resp.error) {
    console.error(`UPDATE failed for ${sr.external_id}:`, resp.error);
    throw new Error(`update failed`);
  }
}

async function recomputeOne(mpId: string): Promise<void> {
  const r = await db.rpc("recompute_master_place", { p_master_place_id: mpId });
  if (r.error) {
    console.error(`recompute_master_place failed for ${mpId}:`, r.error);
    throw new Error("recompute failed");
  }
}

async function backfillPhotoUrls(mpIds: string[]): Promise<number> {
  let total = 0;
  const CHUNK = 500;
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db.rpc("backfill_master_place_photo_url", { p_ids: chunk });
    if (r.error) {
      console.error("backfill_master_place_photo_url failed:", r.error);
      throw new Error("photo backfill failed");
    }
    total += Number(r.data ?? 0);
  }
  return total;
}

async function main() {
  console.log("=".repeat(72));
  console.log("AO manual content ingest —", DRY_RUN ? "DRY RUN" : "LIVE");
  console.log("Target: TEST (", TEST_URL, ")");
  console.log("=".repeat(72));

  // ── Read + choose ────────────────────────────────────────────────
  const rows = chooseRows();
  console.log(`Chosen rows total: ${rows.length}`);
  const withPhoto = rows.filter((r) => r.photoUrl).length;
  console.log(`  of which have a photo url: ${withPhoto}`);

  // ── Match against TEST ───────────────────────────────────────────
  const externalIds = rows.map((r) => r.externalId);
  const srRows = await fetchMatchedSourceRecords(externalIds);
  const srByEid = new Map(srRows.map((r) => [r.external_id, r]));
  const matched = rows.filter((r) => srByEid.has(r.externalId));
  const unmatched = rows.filter((r) => !srByEid.has(r.externalId));

  console.log(`\nMatched to TEST source_records: ${matched.length}`);
  console.log(`Unmatched (skipped):            ${unmatched.length}`);
  for (const u of unmatched) console.log(`  skip: ${u.externalId} (from ${u.source})`);

  // Link rate to master_place
  const withMp = matched.filter((r) => srByEid.get(r.externalId)?.master_place_id).length;
  const withoutMp = matched.length - withMp;
  console.log(`  matched with a linked master_place_id: ${withMp}`);
  console.log(`  matched with NO linked master_place_id: ${withoutMp} (source_record only)`);

  const inactive = matched.filter((r) => !srByEid.get(r.externalId)?.is_active).length;
  console.log(`  matched but is_active=false:            ${inactive} (updated anyway)`);

  // ── Baseline before-counts ───────────────────────────────────────
  console.log("\n── BEFORE ──");
  const beforeAoDesc = await countAoWithDescription();
  const beforeAoPhoto = await countAoWithPhoto();
  console.log(`  atlas_oddities source_records with normalized_payload.description non-null: ${beforeAoDesc}`);
  console.log(`  atlas_oddities source_records with normalized_payload.photo non-null:       ${beforeAoPhoto}`);

  const mpIds = Array.from(
    new Set(
      matched
        .map((r) => srByEid.get(r.externalId)?.master_place_id)
        .filter((id): id is string => !!id),
    ),
  );
  const beforeMpDesc = await countMpAoDescription(mpIds);
  const beforeMpPhoto = await countMpAoPhoto(mpIds);
  console.log(`  scoped master_place with attribution.description='atlas_oddities': ${beforeMpDesc}`);
  console.log(`  scoped master_place with photo_url non-null:                       ${beforeMpPhoto}`);

  if (DRY_RUN) {
    console.log("\nDRY RUN — no writes.");
    return;
  }

  // ── Write ────────────────────────────────────────────────────────
  console.log(`\n── UPDATING ${matched.length} source_records ──`);
  let updated = 0;
  let failed = 0;
  const startWrite = Date.now();
  for (const row of matched) {
    const sr = srByEid.get(row.externalId)!;
    try {
      await updateOneSourceRecord(sr, row.about, row.photoUrl);
      updated++;
      if (updated % 100 === 0) {
        const rate = updated / ((Date.now() - startWrite) / 1000);
        console.log(`  updated ${updated}/${matched.length} (~${rate.toFixed(1)}/s)`);
      }
    } catch {
      failed++;
    }
  }
  console.log(`  updated: ${updated}   failed: ${failed}`);

  // ── Recompute master_place ───────────────────────────────────────
  console.log(`\n── RECOMPUTE ${mpIds.length} master_place rows ──`);
  let recomputed = 0;
  let recomputeFailed = 0;
  const startRecompute = Date.now();
  for (const mpId of mpIds) {
    try {
      await recomputeOne(mpId);
      recomputed++;
      if (recomputed % 100 === 0) {
        const rate = recomputed / ((Date.now() - startRecompute) / 1000);
        console.log(`  recomputed ${recomputed}/${mpIds.length} (~${rate.toFixed(1)}/s)`);
      }
    } catch {
      recomputeFailed++;
    }
  }
  console.log(`  recomputed: ${recomputed}   failed: ${recomputeFailed}`);

  // ── Backfill photo_url ───────────────────────────────────────────
  console.log(`\n── BACKFILL PHOTO_URL for ${mpIds.length} master_place rows ──`);
  const photoUpdated = await backfillPhotoUrls(mpIds);
  console.log(`  master_place rows whose photo_url actually changed: ${photoUpdated}`);

  // ── After-counts ─────────────────────────────────────────────────
  console.log("\n── AFTER ──");
  const afterAoDesc = await countAoWithDescription();
  const afterAoPhoto = await countAoWithPhoto();
  console.log(`  atlas_oddities source_records with normalized_payload.description non-null: ${afterAoDesc}`);
  console.log(`  atlas_oddities source_records with normalized_payload.photo non-null:       ${afterAoPhoto}`);
  const afterMpDesc = await countMpAoDescription(mpIds);
  const afterMpPhoto = await countMpAoPhoto(mpIds);
  console.log(`  scoped master_place with attribution.description='atlas_oddities': ${afterMpDesc}`);
  console.log(`  scoped master_place with photo_url non-null:                       ${afterMpPhoto}`);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
