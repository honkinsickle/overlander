/**
 * READ-ONLY cross-check: does the new master_place.photo_url column agree
 * with master_place_search_export.photo_url (the pre-existing LEFT JOIN
 * LATERAL over nps/ridb normalized_payload.photo.url)?
 *
 * They are two independent resolutions of the same idea, so they can drift.
 * THREE known, deliberate differences the check must distinguish from a bug:
 *
 *   1. SOURCE SET. The column also resolves blm (raw_payload.props.PHOTO_LINK)
 *      and state_parks (raw_payload.props.Imagelink); the view's lateral does
 *      not. Rows where the column has a photo and the view does not, sourced
 *      from those two, are EXPECTED.
 *
 *   2. ROW SET. The view is filtered (is_searchable, source_count > 0, inside
 *      six_state_footprint()), so it covers fewer rows than master_place.
 *
 *   3. ⚠ is_active — THE ONE THAT ACTUALLY BITES. The view's lateral
 *      (20260821040000_search_export_description_source.sql:63-67) filters on
 *      master_place_id, source_id in ('nps','ridb') and a non-null photo url,
 *      and NOTHING ELSE — it does NOT filter is_active. The RPC
 *      (20260821070000) DOES. So the view can surface a photo from a
 *      DEACTIVATED source_record that the column deliberately excludes.
 *
 * ⚠ THE COLUMN IS **NOT** A STRUCTURAL SUPERSET OF THE VIEW'S LATERAL. An
 * earlier version of this file asserted it was — "the view's lateral is a
 * strict subset of the column's source set, so anything the view resolves the
 * column must resolve too" — and that is REFUTED by difference 3 above.
 * "0 view-only" was measured on 2026-08-21 and held only because TEST then
 * had 0 inactive nps and 0 inactive ridb rows carrying a photo url. It is a
 * property of that day's data, not of the design. See
 * docs/measurements/2026-08-21-master-place-enrichment-columns.md §4a.
 *
 * CONSEQUENCE FOR READING THIS SCRIPT'S OUTPUT: a view-only row is NOT
 * evidence that the column missed a photo. The far likelier cause is the view
 * OVER-reporting — serving a photo off a source_record that has since been
 * deactivated. Deactivation passes are routine in this corpus, so expect this
 * eventually. Diagnose it in that order; see the printed guidance below.
 *
 * Anything else — same row, both non-null, different url — is a real
 * disagreement and is listed.
 *
 * Writes nothing.
 *
 * Run (from data/):
 *   ../node_modules/.bin/tsx --env-file=.env \
 *     scripts/verify-mp-photo-url-vs-export-view-2026-08-21.ts
 */

import { getDb } from "../ingestion/lib/db.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;

async function scanAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  build: (q: any) => any,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const q: any = build(db.from(table).select(columns))
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
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

async function main(): Promise<void> {
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`Target project ref: ${ref}`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`refusing to run against ${ref}`);
  const db = getDb();

  const col = await scanAll<{ id: string; photo_url: string | null }>(
    db,
    "master_place",
    "id, photo_url",
    (q: any) => q.not("photo_url", "is", null),
    "master_place.photo_url",
  );
  const view = await scanAll<{ id: string; photo_url: string | null }>(
    db,
    "master_place_search_export",
    "id, photo_url",
    (q: any) => q.not("photo_url", "is", null),
    "export view photo_url",
  );

  const colMap = new Map(col.map((r) => [r.id, r.photo_url as string]));
  const viewMap = new Map(view.map((r) => [r.id, r.photo_url as string]));

  let agree = 0;
  const differ: Array<[string, string, string]> = [];
  for (const [id, v] of viewMap) {
    const c = colMap.get(id);
    if (c === undefined) continue;
    if (c === v) agree += 1;
    else differ.push([id, c, v]);
  }
  const inColOnly = [...colMap.keys()].filter((id) => !viewMap.has(id));
  const inViewOnly = [...viewMap.keys()].filter((id) => !colMap.has(id));

  console.log("\n=== master_place.photo_url vs master_place_search_export.photo_url ===");
  console.log(`master_place rows with photo_url        ${colMap.size}`);
  console.log(`export-view rows with photo_url         ${viewMap.size}`);
  console.log(`present in both, url identical          ${agree}`);
  console.log(`present in both, url DIFFERENT          ${differ.length}`);
  console.log(`column only (view filters or blm/sp)    ${inColOnly.length}`);
  // Label deliberately does NOT say "column missing a photo" — that is the
  // refuted diagnosis (see header, difference 3). Diagnosed below, not assumed.
  console.log(`view only (diagnosed below, not a defect)  ${inViewOnly.length}`);

  for (const [id, c, v] of differ.slice(0, 10)) {
    console.log(`  DIFFER ${id}\n    column: ${c}\n    view:   ${v}`);
  }
  if (differ.length > 10) console.log(`  … ${differ.length - 10} more`);

  // A view-only row is NOT prima facie a column defect — see difference 3 in
  // this file's header. The view's lateral does not filter is_active and the
  // RPC does, so the leading hypothesis is the VIEW over-reporting off a
  // deactivated source_record. Rather than assert either way, probe it: for
  // each view-only row, does an INACTIVE nps/ridb source_record carry that
  // exact url? If yes, the view is over-reporting and the column is right.
  if (inViewOnly.length === 0) {
    console.log(
      "\n0 view-only rows — MEASURED, not guaranteed. The column is not a\n" +
        "  structural superset of the view's lateral (the lateral does not filter\n" +
        "  is_active, the RPC does). This holds only while no inactive nps/ridb\n" +
        "  source_record carries a photo url.",
    );
  } else {
    console.log(`\n⚠ ${inViewOnly.length} view-only row(s) — diagnosing before blaming either side:`);
    let staleInView = 0;
    let unexplained = 0;
    for (const id of inViewOnly) {
      const res = await db
        .from("source_record")
        .select("source_id, external_id, is_active, normalized_payload")
        .eq("master_place_id", id)
        .in("source_id", ["nps", "ridb"]);
      if (res.error || res.data == null) {
        console.log("QUERY FAILED (view-only diagnosis):", JSON.stringify(res));
        throw new Error("view-only diagnosis failed");
      }
      const rows = res.data as {
        is_active: boolean;
        normalized_payload: Record<string, unknown> | null;
      }[];
      const url = viewMap.get(id);
      const inactiveCarrier = rows.some((r) => {
        const p = r.normalized_payload?.photo as { url?: unknown } | null | undefined;
        return !r.is_active && typeof p?.url === "string" && p.url.trim() === url;
      });
      if (inactiveCarrier) staleInView += 1;
      else unexplained += 1;
    }
    console.log(
      `  ${staleInView}/${inViewOnly.length}: the url comes from an INACTIVE nps/ridb\n` +
        "    source_record. The VIEW is over-reporting — it has no is_active filter.\n" +
        "    The column is CORRECT to omit these. Fix belongs in the view, not here.",
    );
    console.log(
      `  ${unexplained}/${inViewOnly.length}: NOT explained by a deactivated source.\n` +
        "    Only these are candidates for a real column defect — investigate them.",
    );
    for (const id of inViewOnly.slice(0, 10)) console.log(`    ${id} -> ${viewMap.get(id)}`);
  }

  // Characterise the column-only rows so "expected" isn't just asserted.
  // Chunked at 50 ids: PostgREST puts .in() lists in the URL and a larger
  // chunk overflows the server's header limit.
  if (inColOnly.length > 0) {
    const bySource = new Map<string, Set<string>>();
    for (let i = 0; i < inColOnly.length; i += 50) {
      const chunk = inColOnly.slice(i, i + 50);
      const res = await db
        .from("source_record")
        .select("master_place_id, source_id")
        .in("master_place_id", chunk)
        .eq("is_active", true);
      if (res.error || res.data == null) {
        console.log("QUERY FAILED (column-only characterisation):", JSON.stringify(res));
        throw new Error("column-only characterisation failed");
      }
      for (const r of res.data as { master_place_id: string; source_id: string }[]) {
        if (!bySource.has(r.source_id)) bySource.set(r.source_id, new Set());
        bySource.get(r.source_id)!.add(r.master_place_id);
      }
    }
    console.log(
      `\ncolumn-only rows — active source_ids present across ALL ${inColOnly.length} of them (population, not a sample):`,
    );
    for (const [s, ids] of [...bySource].sort((a, b) => b[1].size - a[1].size)) {
      console.log(`  ${s.padEnd(16)} ${ids.size}`);
    }
  }

  // Explain the "present in both, url DIFFERENT" rows rather than assume.
  // Hypothesis: the view's lateral orders ONLY by `case source_id`, so when a
  // master_place links MORE THAN ONE photo-carrying source_record from the
  // SAME source, its pick is Postgres-arbitrary; the column adds
  // source_quality_score DESC, external_id ASC and is therefore a total order.
  // If the hypothesis holds, every differing row has >= 2 photo-carrying
  // nps-or-ridb source_records.
  if (differ.length > 0) {
    let multi = 0;
    let single = 0;
    for (const [id] of differ) {
      const res = await db
        .from("source_record")
        .select("source_id, external_id, normalized_payload")
        .eq("master_place_id", id)
        .eq("is_active", true)
        .in("source_id", ["nps", "ridb"]);
      if (res.error || res.data == null) {
        console.log("QUERY FAILED (differ characterisation):", JSON.stringify(res));
        throw new Error("differ characterisation failed");
      }
      const withPhoto = (res.data as { normalized_payload: Record<string, unknown> | null }[]).filter(
        (r) => {
          const p = r.normalized_payload?.photo as { url?: unknown } | null | undefined;
          return typeof p?.url === "string" && p.url.trim().length > 0;
        },
      );
      if (withPhoto.length > 1) multi += 1;
      else single += 1;
    }
    console.log(
      `\ndiffering rows explained: ${multi}/${differ.length} link MORE THAN ONE photo-carrying\n` +
        `  nps/ridb source_record (the export view's lateral has no tie-breaker within a\n` +
        `  source, so its pick is arbitrary; the column's is deterministic).\n` +
        `  ${single}/${differ.length} do NOT fit that explanation` +
        (single > 0 ? " — investigate before trusting this column." : "."),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
