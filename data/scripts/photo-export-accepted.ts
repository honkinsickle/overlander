/**
 * PHASE 1 (READ-ONLY, run against TEST): export the Google-verified accepted
 * photo candidates into a JSON manifest for the PROD promotion phase.
 *
 * Captures full provenance for a faithful candidate-table copy, the STABLE
 * source identities (source_id, external_id — excluding env-specific
 * generated_* ids) for TEST->PROD master_place matching, and a deterministic
 * `wire` flag marking the one image per place that will be wired into the
 * corridor RPC's photo path.
 *
 * Wiring selection rule (per resolved place):
 *   1. exclude non-web-renderable formats (.tiff/.tif) — browsers can't <img> them,
 *   2. among the rest, keep the highest name_score (tie: google_confidence
 *      high>med>low, then smallest distance_m).
 *
 *   npx tsx --env-file=<TEST env file> scripts/photo-export-accepted.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { getDb } from "../ingestion/lib/db.ts";

const PILOT_RUN = "ca-campground-2026-09-01-fixed";
const CONF_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function ref(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}
function renderable(url: string | null): boolean {
  return !!url && !/\.tiff?(\?|$)/i.test(url);
}

async function main(): Promise<void> {
  const db = getDb();
  const target = ref();
  if (target !== "znldzjdatkogdktymtvi") {
    console.log(`REFUSING: export must run against TEST, got '${target}'`);
    process.exit(1);
  }
  console.log(`Exporting accepted candidates from TEST (${target})`);

  const r = await db
    .from("master_place_photo_candidate")
    .select(
      "id, master_place_id, source, image_url, thumb_url, source_page_url, license, license_url, license_class, attribution, title, match_status, match_confidence, name_score, distance_m, match_reason, place_name, primary_category, pilot_run, google_verdict, google_confidence, google_reasoning, google_ref_source",
    )
    .eq("match_status", "accepted")
    .eq("pilot_run", PILOT_RUN)
    .order("place_name");
  if (r.error || r.data == null) {
    console.log("QUERY FAILED:", JSON.stringify(r));
    process.exit(1);
  }
  const rows = r.data as any[];

  // Stable identities per TEST master_place (exclude generated_* + google*).
  const mpIds = [...new Set(rows.map((x) => x.master_place_id))];
  const identities = new Map<string, string[]>();
  const sr = await db
    .from("source_record")
    .select("master_place_id, source_id, external_id, is_active")
    .in("master_place_id", mpIds)
    .eq("is_active", true);
  if (sr.error || sr.data == null) {
    console.log("SR QUERY FAILED:", JSON.stringify(sr));
    process.exit(1);
  }
  for (const s of sr.data as any[]) {
    if (/^generated/.test(s.source_id) || /^google/.test(s.source_id)) continue;
    const arr = identities.get(s.master_place_id) ?? [];
    arr.push(`${s.source_id}|${s.external_id}`);
    identities.set(s.master_place_id, arr);
  }

  // Deterministic wire flag: one image per TEST master_place.
  const byPlace = new Map<string, any[]>();
  for (const row of rows) {
    const arr = byPlace.get(row.master_place_id) ?? [];
    arr.push(row);
    byPlace.set(row.master_place_id, arr);
  }
  const wireIds = new Set<string>();
  for (const [, cands] of byPlace) {
    const eligible = cands.filter((c) => renderable(c.image_url));
    if (eligible.length === 0) continue;
    eligible.sort(
      (a, b) =>
        (b.name_score ?? 0) - (a.name_score ?? 0) ||
        (CONF_RANK[b.google_confidence] ?? 0) - (CONF_RANK[a.google_confidence] ?? 0) ||
        (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9),
    );
    wireIds.add(eligible[0].id);
  }

  const manifest = rows.map((row) => ({
    ...row,
    stable_identities: identities.get(row.master_place_id) ?? [],
    wire: wireIds.has(row.id),
  }));

  mkdirSync("tmp", { recursive: true });
  writeFileSync("tmp/photo-manifest.json", JSON.stringify(manifest, null, 2));
  console.log(`\nWrote tmp/photo-manifest.json: ${manifest.length} rows, ${wireIds.size} marked wire=true`);
  for (const m of manifest) {
    console.log(
      `  ${m.wire ? "WIRE " : "     "} ${m.place_name.padEnd(30)} ids=[${m.stable_identities.join(",")}] ${m.image_url?.slice(0, 60)}`,
    );
  }
}

main().catch((e) => {
  console.error("export fatal:", e);
  process.exit(1);
});
