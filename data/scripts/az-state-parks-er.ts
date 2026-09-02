/**
 * Entity resolution for `arizona_state_parks`.
 *
 * Two phases, structurally the same as OR but with a different Phase-1
 * mechanism — AZ has no coordinates in the visitor scrape, so spatial
 * pre-link (point-in-polygon) is impossible. Instead, the ingester
 * records the intended GIS park id in
 * `normalized_payload.provenance.matched_gis_park_external_id` (plus
 * `intended_master_place_id` if the GIS park was already linked to a
 * master_place at ingest time). Phase 1 replays that intent as a
 * direct place_match; Phase 2 falls through to standard matchAll.
 *
 *   1. Direct link: for every unlinked arizona_state_parks
 *      source_record with a stored intended_master_place_id, insert a
 *      place_match with match_method='ingest_time_name_link' and
 *      status='confirmed'. This lets the two known name-variant pairs
 *      (San Rafael, Sonoita Creek) auto-link deterministically even if
 *      raw trigram similarity would sit below the auto-link floor.
 *   2. Standard matchAll → applyMatches for anything left (rows whose
 *      matched GIS park had no master_place at ingest time — the AZ
 *      corpus has 2/34 such park units at time of writing).
 *
 * Run:
 *   npx tsx --env-file=.env scripts/az-state-parks-er.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { matchAll } from "../entity-resolution/matcher.ts";
import { applyMatches } from "../entity-resolution/promote.ts";
import { logger } from "../ingestion/lib/logger.ts";

const SOURCE_ID = "arizona_state_parks";
const DRY_RUN = process.argv.includes("--dry-run");

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface UnlinkedRow {
  id: string;
  external_id: string;
  name: string;
  inferred_category: string | null;
  intended_master_place_id: string | null;
  matched_gis_park_external_id: string | null;
}

async function fetchUnlinked(): Promise<UnlinkedRow[]> {
  const rows: UnlinkedRow[] = [];
  for (let off = 0; ; off += 1000) {
    const p = await sb
      .from("source_record")
      .select("id, external_id, name, inferred_category, normalized_payload")
      .eq("source_id", SOURCE_ID)
      .is("master_place_id", null)
      .order("id")
      .range(off, off + 999);
    if (p.error || p.data == null) {
      throw new Error(`az-er: fetch unlinked failed: ${JSON.stringify(p.error)}`);
    }
    for (const r of p.data as Array<Record<string, unknown>>) {
      const prov = (r.normalized_payload as { provenance?: Record<string, unknown> } | null)
        ?.provenance ?? {};
      rows.push({
        id: r.id as string,
        external_id: r.external_id as string,
        name: r.name as string,
        inferred_category: (r.inferred_category as string | null) ?? null,
        intended_master_place_id:
          (prov.intended_master_place_id as string | null | undefined) ?? null,
        matched_gis_park_external_id:
          (prov.matched_gis_park_external_id as string | null | undefined) ?? null,
      });
    }
    if (p.data.length < 1000) break;
  }
  return rows;
}

async function fetchGisMasterPlaceName(mpId: string): Promise<string | null> {
  const r = await sb
    .from("master_place")
    .select("canonical_name")
    .eq("id", mpId)
    .maybeSingle();
  if (r.error) {
    logger.warn({ err: r.error, mpId }, "az-er: fetchGisMasterPlaceName failed");
    return null;
  }
  return (r.data?.canonical_name as string | null) ?? null;
}

async function applyDirectLink(row: UnlinkedRow, mpName: string | null): Promise<void> {
  if (DRY_RUN) return;
  const mpId = row.intended_master_place_id!;

  const u = await sb.from("source_record").update({ master_place_id: mpId }).eq("id", row.id);
  if (u.error) throw new Error(`az-er: link update failed for ${row.id}: ${u.error.message}`);

  const i = await sb.from("place_match").insert({
    source_record_id: row.id,
    master_place_id: mpId,
    distance_meters: 0,
    name_similarity: 0,
    category_compatibility: 0,
    combined_confidence: 1.0,
    match_method: "ingest_time_name_link",
    status: "confirmed",
    resolved_by: "auto:arizona_state_parks_er",
    resolved_at: new Date().toISOString(),
    notes: `Ingest-time name link: ${row.name} → ${mpName ?? "(unknown mp name)"} (via ${row.matched_gis_park_external_id ?? "unknown gis id"})`,
  });
  if (i.error && !i.error.message.includes("duplicate")) {
    throw new Error(`az-er: place_match insert failed: ${i.error.message}`);
  }

  const r = await sb.rpc("recompute_master_place", { p_master_place_id: mpId });
  if (r.error) logger.warn({ err: r.error, mpId }, "az-er: recompute_master_place returned error");
}

async function main() {
  logger.info({ dryRun: DRY_RUN, sourceId: SOURCE_ID }, "az-er: starting");

  const unlinked = await fetchUnlinked();
  logger.info({ unlinked: unlinked.length }, "az-er: fetched unlinked source_records");

  const direct: UnlinkedRow[] = [];
  const remainder: UnlinkedRow[] = [];
  for (const r of unlinked) {
    if (r.intended_master_place_id) direct.push(r);
    else remainder.push(r);
  }
  logger.info(
    { direct: direct.length, remainder: remainder.length },
    "az-er: phase 1 partition (has intended_master_place_id vs not)",
  );

  for (const r of direct) {
    try {
      const mpName = await fetchGisMasterPlaceName(r.intended_master_place_id!);
      await applyDirectLink(r, mpName);
    } catch (err) {
      logger.error({ err, row: r }, "az-er: direct link apply failed");
    }
  }
  logger.info({ applied: direct.length, dryRun: DRY_RUN }, "az-er: phase 1 apply complete");

  if (remainder.length === 0) {
    logger.info({}, "az-er: nothing left for phase 2");
    return;
  }
  logger.info({ n: remainder.length }, "az-er: phase 2 — running matchAll on remainder");
  const outcomes = await matchAll(remainder.map((m) => m.id));
  logger.info({ outcomes: outcomes.length }, "az-er: matchAll returned");

  if (DRY_RUN) {
    const byKind: Record<string, number> = {};
    for (const o of outcomes) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    logger.info({ byKind }, "az-er: dry-run — outcome breakdown (not applied)");
    return;
  }

  const result = await applyMatches(outcomes);
  logger.info({ result }, "az-er: applyMatches complete");
}

main().catch((e) => {
  logger.error({ err: e }, "az-er: fatal");
  process.exit(1);
});
