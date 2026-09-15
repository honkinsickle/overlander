/**
 * READ-ONLY investigation — MacKerricher State Park photo/attribution lineage.
 * Writes NOTHING. Run against PROD via:
 *   npx tsx --env-file=$HOME/.config/overlander/env-backups/.env.production-backup \
 *     data/scripts/investigate-mackerricher-photo-2026-09-01.ts
 * Or against TEST via --env-file=data/.env (default TEST project).
 *
 * Answers:
 *  1. Which master_place row(s) is MacKerricher, and its source_record lineage.
 *  2. What actually populates the card photo — the export-view / corridor-RPC
 *     lateral (nps/ridb/wikipedia/atlas_oddities/family_destinations/editorial_food),
 *     the backfilled master_place.photo_url column (blm/state_parks Imagelink/
 *     PHOTO_LINK), or Google live-hydration (google_place_id present).
 *  3. Whether any source carries license/attribution metadata for the image.
 */
import { getDb } from "../ingestion/lib/db.ts";

const PROD = "nqzeywzcowujzyegxbsr";
const TEST = "znldzjdatkogdktymtvi";

async function main(): Promise<void> {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "";
  const label = ref === PROD ? "** PROD **" : ref === TEST ? "(TEST)" : "(UNKNOWN)";
  console.log(`target project: ${ref} ${label}\n`);

  // 1. master_place rows matching MacKerricher (spelling variants tolerated)
  const mp = await db
    .from("master_place")
    .select(
      "id,canonical_name,primary_category,secondary_categories,is_searchable,source_count,prominence_score,photo_url,attribution,description,state,operational_status",
    )
    .ilike("canonical_name", "%acKerricher%");
  if (mp.error) {
    console.log("QUERY FAILED (master_place):", JSON.stringify(mp));
    process.exit(1);
  }
  console.log(`[1] master_place rows matching "%acKerricher%": ${mp.data?.length ?? 0}`);
  for (const r of mp.data as any[]) {
    console.log(`\n  id=${r.id}`);
    console.log(`    canonical_name   = ${JSON.stringify(r.canonical_name)}`);
    console.log(`    primary_category = ${r.primary_category}   secondary=${JSON.stringify(r.secondary_categories)}`);
    console.log(`    is_searchable=${r.is_searchable} source_count=${r.source_count} prominence=${r.prominence_score} state=${r.state} op_status=${JSON.stringify(r.operational_status)}`);
    console.log(`    photo_url (backfilled column) = ${JSON.stringify(r.photo_url)}`);
    console.log(`    attribution = ${JSON.stringify(r.attribution)}`);
    console.log(`    description = ${JSON.stringify((r.description ?? "").slice(0, 120))}`);
  }

  const ids = (mp.data as any[]).map((r) => r.id);
  if (ids.length === 0) {
    console.log("\nNo MacKerricher master_place. Done.");
    return;
  }

  // 2. Full source_record lineage for those master_places
  const sr = await db
    .from("source_record")
    .select(
      "id,source_id,external_id,is_active,master_place_id,source_quality_score,normalized_payload,raw_payload",
    )
    .in("master_place_id", ids);
  if (sr.error) {
    console.log("QUERY FAILED (source_record):", JSON.stringify(sr));
    process.exit(1);
  }
  console.log(`\n[2] linked source_records: ${sr.data?.length ?? 0}`);
  for (const r of sr.data as any[]) {
    const np = r.normalized_payload ?? {};
    const rp = r.raw_payload ?? {};
    const props = rp.props ?? {};
    const rawImagelink = props?.Imagelink ?? props?.ImageLink ?? props?.imagelink ?? null;
    const rawPhotoLink = props?.PHOTO_LINK ?? null;
    console.log(`\n  source_id=${r.source_id}  active=${r.is_active}  q=${r.source_quality_score}`);
    console.log(`    external_id = ${r.external_id}`);
    console.log(`    normalized_payload.photo = ${JSON.stringify(np?.photo ?? null)}`);
    console.log(`    raw_payload.props.Imagelink = ${JSON.stringify(rawImagelink)}`);
    console.log(`    raw_payload.props.PHOTO_LINK = ${JSON.stringify(rawPhotoLink)}`);
    console.log(`    source_record.attribution = ${JSON.stringify(r.attribution ?? null)}`);
    // Surface any license/credit-ish keys we can find, in normalized + raw props
    const licenseKeys = ["license", "License", "credit", "Credit", "author", "Author", "attribution", "Attribution", "copyright", "Copyright", "rights", "photo_credit"];
    const found: Record<string, unknown> = {};
    for (const k of licenseKeys) {
      if (props[k] != null) found[`props.${k}`] = props[k];
      if (np[k] != null) found[`np.${k}`] = np[k];
      if (np?.photo && (np.photo as any)[k] != null) found[`np.photo.${k}`] = (np.photo as any)[k];
    }
    console.log(`    license/credit-ish keys present = ${Object.keys(found).length ? JSON.stringify(found) : "NONE"}`);
    if (r.source_id === "state_parks" || r.source_id === "blm") {
      console.log(`    [raw props keys] = ${JSON.stringify(Object.keys(props))}`);
    }
  }

  // 3. What the render path actually resolves — export view photo_url (the lateral)
  const view = await db
    .from("master_place_search_export")
    .select("id,photo_url,description")
    .in("id", ids);
  console.log(`\n[3] master_place_search_export (the lateral the card actually reads):`);
  if (view.error) console.log("    QUERY FAILED:", JSON.stringify(view));
  else if ((view.data?.length ?? 0) === 0) console.log("    (row NOT in export view — not searchable / out of footprint / source_count 0)");
  else for (const r of view.data as any[]) console.log(`    id=${r.id} view.photo_url=${JSON.stringify(r.photo_url)}`);

  // 4. Google identity → live-hydration path (google / google_resolved)
  const g = (sr.data as any[]).filter((r) => r.source_id === "google" || r.source_id === "google_resolved");
  console.log(`\n[4] google/google_resolved source_records (→ /api/places/details live photo): ${g.length}`);
  for (const r of g) {
    console.log(`    ${r.source_id} external_id=${r.external_id} place_id=${JSON.stringify(r.normalized_payload?.google_place_id ?? r.raw_payload?.place_id ?? null)}`);
  }
}

main().catch((e) => {
  console.error("investigation fatal:", e);
  process.exit(1);
});
