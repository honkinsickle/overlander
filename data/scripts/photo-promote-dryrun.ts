/**
 * READ-ONLY dry run for promoting Google-verified accepted photo candidates.
 *
 * Lists every master_place_photo_candidate row with match_status='accepted'
 * and pilot_run='ca-campground-2026-09-01-fixed', with full provenance, and
 * — critically — the STABLE source identity (source_id, external_id) of each
 * place, so the promotion can match TEST -> PROD master_place by identity
 * rather than by raw (env-specific) uuid.
 *
 * Writes NOTHING. Run against whatever SUPABASE_URL points at (expected TEST):
 *   npx tsx --env-file=.env scripts/photo-promote-dryrun.ts
 */
import { getDb } from "../ingestion/lib/db.ts";

function ref(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}

async function main(): Promise<void> {
  const db = getDb();
  console.log(`Target project: ${ref()}\n`);

  const r = await db
    .from("master_place_photo_candidate")
    .select(
      "id, master_place_id, source, image_url, thumb_url, source_page_url, license, license_url, license_class, attribution, title, place_name, primary_category, google_verdict, google_confidence, match_reason, pilot_run",
    )
    .eq("match_status", "accepted")
    .eq("pilot_run", "ca-campground-2026-09-01-fixed")
    .order("place_name", { ascending: true });

  if (r.error || r.data == null) {
    console.log("QUERY FAILED:", JSON.stringify(r));
    process.exit(1);
  }

  const rows = r.data as any[];
  console.log(`accepted rows for pilot_run='ca-campground-2026-09-01-fixed': ${rows.length}\n`);

  // For each candidate's master_place, pull its ACTIVE source_records so we can
  // choose a stable (source_id, external_id) identity for TEST->PROD matching.
  const mpIds = [...new Set(rows.map((x) => x.master_place_id))];
  const srById = new Map<string, { source_id: string; external_id: string }[]>();
  for (let i = 0; i < mpIds.length; i += 100) {
    const chunk = mpIds.slice(i, i + 100);
    const sr = await db
      .from("source_record")
      .select("master_place_id, source_id, external_id, is_active")
      .in("master_place_id", chunk)
      .eq("is_active", true);
    if (sr.error || sr.data == null) {
      console.log("SOURCE_RECORD QUERY FAILED:", JSON.stringify(sr));
      process.exit(1);
    }
    for (const s of sr.data as any[]) {
      const arr = srById.get(s.master_place_id) ?? [];
      arr.push({ source_id: s.source_id, external_id: s.external_id });
      srById.set(s.master_place_id, arr);
    }
  }

  for (const row of rows) {
    const ids = srById.get(row.master_place_id) ?? [];
    console.log("────────────────────────────────────────────────────────");
    console.log(`  place_name : ${row.place_name}`);
    console.log(`  category   : ${row.primary_category}`);
    console.log(`  TEST mp id : ${row.master_place_id}`);
    console.log(`  source     : ${row.source}`);
    console.log(`  license    : ${row.license}  [${row.license_class}]`);
    console.log(`  attribution: ${row.attribution ?? "(none — public domain)"}`);
    console.log(`  image_url  : ${row.image_url}`);
    console.log(`  source_pg  : ${row.source_page_url ?? "(none)"}`);
    console.log(`  title      : ${row.title ?? "(none)"}`);
    console.log(`  google     : verdict=${row.google_verdict} conf=${row.google_confidence}`);
    console.log(`  match_note : ${row.match_reason ?? ""}`);
    console.log(`  identity   : ${ids.map((x) => `${x.source_id}:${x.external_id}`).join("  |  ") || "(NO ACTIVE SOURCE_RECORD)"}`);
  }
  console.log("────────────────────────────────────────────────────────");

  // Compliance scan: no Google image data may be persisted anywhere in a row.
  const googleLeak = rows.filter(
    (x) =>
      /googleusercontent|googleapis|places\/photo|maps\.google/i.test(
        `${x.image_url} ${x.thumb_url ?? ""} ${x.source_page_url ?? ""} ${x.attribution ?? ""}`,
      ),
  );
  console.log(`\nCompliance scan (Google image data in image/thumb/page/attr): ${googleLeak.length} rows`);

  const bySource: Record<string, number> = {};
  for (const x of rows) bySource[x.source] = (bySource[x.source] ?? 0) + 1;
  console.log(`by source: ${JSON.stringify(bySource)}`);
}

main().catch((e) => {
  console.error("dryrun fatal:", e);
  process.exit(1);
});
