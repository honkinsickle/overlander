/**
 * PHASE 2 (run against PROD): promote the exported accepted photo candidates.
 *
 * Reads tmp/photo-manifest.json (produced by photo-export-accepted.ts against
 * TEST) and, for each distinct place:
 *   1. resolves TEST -> PROD master_place by STABLE source identity
 *      (source_id, external_id) — never by raw uuid, never via generated_* ids.
 *      Requires exactly ONE PROD match; 0 or >1 is skipped and flagged.
 *   2. skips (flags) any place that ALREADY has a photo in the corridor RPC's
 *      read path — never override an existing working photo.
 *   3. copies every accepted row into PROD master_place_photo_candidate
 *      (faithful provenance), and
 *   4. for wire=true rows on cleanly-resolved, photoless places, upserts a
 *      `wikipedia` source_record whose normalized_payload.photo the corridor
 *      RPC lateral join reads (approach (a); no RPC change). Does NOT touch
 *      master_place, precedence, or the baked/Google-hydration paths.
 *
 *   --dry-run : resolve + report, write NOTHING (default-safe)
 *   --confirm : required to write to PROD
 *
 *   npx tsx --env-file=.env scripts/photo-promote-prod.ts --dry-run
 *   npx tsx --env-file=.env scripts/photo-promote-prod.ts --confirm
 */
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const PHOTO_SOURCES = ["nps", "ridb", "wikipedia", "atlas_oddities", "family_destinations", "editorial_food"];
const SOURCE_QUALITY = 0.6;

function ref(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}
function fileName(url: string): string {
  return decodeURIComponent((url.split("?")[0].split("/").pop() ?? "").trim());
}
function cleanUrl(url: string): string {
  return url.split("?")[0];
}

type Row = {
  master_place_id: string;
  source: string; image_url: string | null; thumb_url: string | null;
  source_page_url: string | null; license: string | null; license_url: string | null;
  license_class: string | null; attribution: string | null; title: string | null;
  match_status: string; match_confidence: number | null; name_score: number | null;
  distance_m: number | null; match_reason: string | null; place_name: string;
  primary_category: string | null; pilot_run: string;
  google_verdict: string | null; google_confidence: string | null;
  google_reasoning: string | null; google_ref_source: string | null;
  stable_identities: string[]; wire: boolean;
};

async function resolveProdPlace(
  db: SupabaseClient,
  identities: string[],
): Promise<{ prodId: string | null; matched: string[]; note: string }> {
  const orExpr = identities
    .map((s) => { const [sid, ...rest] = s.split("|"); return `and(source_id.eq.${sid},external_id.eq.${rest.join("|")})`; })
    .join(",");
  const r = await db.from("source_record").select("master_place_id, source_id, external_id").eq("is_active", true).or(orExpr);
  if (r.error || r.data == null) return { prodId: null, matched: [], note: `SR query failed: ${JSON.stringify(r.error)}` };
  const ids = [...new Set((r.data as any[]).map((x) => x.master_place_id).filter(Boolean))];
  const matched = (r.data as any[]).map((x) => `${x.source_id}|${x.external_id}`);
  if (ids.length === 0) return { prodId: null, matched, note: "UNRESOLVED (no PROD source_record for any identity)" };
  if (ids.length > 1) return { prodId: null, matched, note: `AMBIGUOUS (${ids.length} PROD places: ${ids.join(", ")})` };
  return { prodId: ids[0], matched, note: "ok" };
}

async function hasExistingPhoto(db: SupabaseClient, prodId: string): Promise<boolean> {
  const r = await db.from("source_record").select("id, normalized_payload").eq("master_place_id", prodId).eq("is_active", true).in("source_id", PHOTO_SOURCES);
  if (r.error || r.data == null) throw new Error(`existing-photo check failed: ${JSON.stringify(r.error)}`);
  return (r.data as any[]).some((x) => x.normalized_payload?.photo?.url);
}

async function placeMeta(db: SupabaseClient, prodId: string): Promise<{ name: string; lng: number; lat: number } | null> {
  const r = await db.from("master_place_search_export").select("canonical_name, lng, lat").eq("id", prodId).maybeSingle();
  if (r.error || r.data == null) return null;
  return { name: (r.data as any).canonical_name, lng: (r.data as any).lng, lat: (r.data as any).lat };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");
  const db = getDb();
  const target = ref();
  console.log(`Target: ${target}${target === PROD_REF ? " ** PROD **" : ""}  mode: ${dryRun ? "DRY-RUN" : confirm ? "WRITE" : "(no --dry-run/--confirm)"}`);
  if (!dryRun && !confirm) { console.log("Refusing: pass --dry-run or --confirm."); process.exit(1); }
  if (confirm && target !== PROD_REF) { console.log(`Refusing WRITE: target is not PROD (${target}).`); process.exit(1); }

  const manifest: Row[] = JSON.parse(readFileSync("tmp/photo-manifest.json", "utf8"));

  // group by TEST place
  const byPlace = new Map<string, Row[]>();
  for (const row of manifest) { const a = byPlace.get(row.master_place_id) ?? []; a.push(row); byPlace.set(row.master_place_id, a); }

  const plan: { place: string; prodId: string | null; note: string; hasPhoto: boolean; wireUrl: string | null; meta: any }[] = [];
  for (const [, rows] of byPlace) {
    const place = rows[0].place_name;
    const { prodId, note } = await resolveProdPlace(db, rows[0].stable_identities);
    let hasPhoto = false, meta: any = null, wireUrl: string | null = null;
    if (prodId) {
      hasPhoto = await hasExistingPhoto(db, prodId);
      meta = await placeMeta(db, prodId);
      const w = rows.find((r) => r.wire);
      wireUrl = w?.image_url ?? null;
    }
    plan.push({ place, prodId, note, hasPhoto, wireUrl, meta });
  }

  console.log("\n=== RESOLUTION ===");
  for (const p of plan) {
    console.log(`  ${p.place.padEnd(30)} prod=${p.prodId ?? "—"} ${p.note}${p.prodId ? ` hasPhoto=${p.hasPhoto} meta=${p.meta ? "ok" : "MISSING"} wire=${p.wireUrl ? fileName(p.wireUrl) : "—"}` : ""}`);
  }

  const resolvable = plan.filter((p) => p.prodId && p.meta);
  const willWire = resolvable.filter((p) => !p.hasPhoto && p.wireUrl);
  console.log(`\nresolved cleanly: ${resolvable.length}/${plan.length}; will wire: ${willWire.length} (skip ${resolvable.length - willWire.length} for existing-photo/no-wire)`);

  if (dryRun) { console.log("\nDRY-RUN: no writes."); return; }

  // ---- WRITES ----
  const prodIdByTest = new Map<string, string>();
  for (const [testId, rows] of byPlace) {
    const p = plan.find((x) => x.place === rows[0].place_name);
    if (p?.prodId) prodIdByTest.set(testId, p.prodId);
  }

  // 1. faithful candidate-table copy (all rows whose place resolved)
  let candCopied = 0;
  for (const row of manifest) {
    const prodId = prodIdByTest.get(row.master_place_id);
    if (!prodId) continue;
    const { error } = await db.from("master_place_photo_candidate").upsert({
      master_place_id: prodId,
      source: row.source, image_url: row.image_url, thumb_url: row.thumb_url,
      source_page_url: row.source_page_url, license: row.license, license_url: row.license_url,
      license_class: row.license_class, attribution: row.attribution, title: row.title,
      match_status: row.match_status, match_confidence: row.match_confidence,
      name_score: row.name_score, distance_m: row.distance_m, match_reason: row.match_reason,
      place_name: row.place_name, primary_category: row.primary_category, pilot_run: row.pilot_run,
      google_verdict: row.google_verdict, google_confidence: row.google_confidence,
      google_reasoning: row.google_reasoning, google_ref_source: row.google_ref_source,
    }, { onConflict: "master_place_id,image_url" });
    if (error) console.log(`  candidate copy FAILED for ${row.place_name}: ${error.message}`);
    else candCopied++;
  }
  console.log(`\ncandidate rows copied to PROD: ${candCopied}`);

  // 2. wire (source_record upsert) — one photo per resolvable photoless place
  let wired = 0;
  for (const p of willWire) {
    const url = cleanUrl(p.wireUrl!);
    const row = manifest.find((r) => r.image_url === p.wireUrl && r.master_place_id && prodIdByTest.get(r.master_place_id) === p.prodId)!;
    const credit = row.license_class === "public_domain" ? null : row.attribution;
    const photo = { url, altText: p.place, credit, license: row.license, licenseUrl: row.license_url };
    const externalId = `wikipedia:photo-pilot:${fileName(p.wireUrl!)}`;
    const { error } = await db.from("source_record").upsert({
      source_id: "wikipedia",
      external_id: externalId,
      name: p.place,
      inferred_category: row.primary_category,
      geometry: `SRID=4326;POINT(${p.meta.lng} ${p.meta.lat})`,
      raw_payload: { photo_pilot: true, pilot_run: row.pilot_run, source: row.source, source_page_url: row.source_page_url, google_verdict: row.google_verdict },
      normalized_payload: { photo },
      source_quality_score: SOURCE_QUALITY,
      master_place_id: p.prodId,
      is_active: true,
    }, { onConflict: "source_id,external_id" });
    if (error) console.log(`  WIRE FAILED for ${p.place}: ${error.message}`);
    else { wired++; console.log(`  wired ${p.place} -> ${externalId}`); }
  }
  console.log(`\nsource_records wired: ${wired}`);
}

main().catch((e) => { console.error("promote fatal:", e); process.exit(1); });
