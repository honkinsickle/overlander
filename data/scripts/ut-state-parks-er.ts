/**
 * Entity resolution for `utah_state_parks`.
 *
 * Three phases:
 *
 *   1. Direct link with RIDB preference: for every unlinked
 *      utah_state_parks source_record with a stored
 *      intended_master_place_id, check whether the target mp has RIDB
 *      attribution. If not, search for a RIDB-backed mp with a
 *      matching name nearby and redirect to it. Insert a place_match
 *      with match_method='ingest_time_name_link' and
 *      status='confirmed'.
 *
 *      Why: the state_parks GIS records are often linked to their own
 *      low-prominence (prom=2) mp, separate from the higher-quality
 *      RIDB-sourced mp (prom=5+) for the same park. The prompt
 *      explicitly requires preferring the RIDB target.
 *
 *   2. Standard matchAll → applyMatches for anything left (rows whose
 *      matched GIS park had no master_place at ingest time).
 *
 * Run:
 *   npx tsx --env-file=.env scripts/ut-state-parks-er.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { matchAll } from "../entity-resolution/matcher.ts";
import { applyMatches } from "../entity-resolution/promote.ts";
import { logger } from "../ingestion/lib/logger.ts";

const SOURCE_ID = "utah_state_parks";
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

interface MpInfo {
  id: string;
  canonical_name: string;
  primary_category: string | null;
  prominence_score: number;
  attribution: Record<string, string> | null;
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
      throw new Error(`ut-er: fetch unlinked failed: ${JSON.stringify(p.error)}`);
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

async function fetchMpInfo(mpId: string): Promise<MpInfo | null> {
  const r = await sb
    .from("master_place")
    .select("id, canonical_name, primary_category, prominence_score, attribution")
    .eq("id", mpId)
    .maybeSingle();
  if (r.error || !r.data) return null;
  return r.data as MpInfo;
}

async function findRidbAlternative(baseName: string, excludeId: string): Promise<MpInfo | null> {
  const { data } = await sb
    .from("master_place")
    .select("id, canonical_name, primary_category, prominence_score, attribution")
    .eq("state", "UT")
    .ilike("canonical_name", `%${baseName}%State Park%`)
    .neq("id", excludeId)
    .limit(10);

  if (!data) return null;
  const ridbHit = data.find((mp) => {
    const vals = mp.attribution ? Object.values(mp.attribution) : [];
    return vals.includes("ridb");
  });
  return ridbHit ? (ridbHit as MpInfo) : null;
}

function hasRidbAttribution(mp: MpInfo): boolean {
  if (!mp.attribution) return false;
  return Object.values(mp.attribution).includes("ridb");
}

function extractBaseName(name: string): string {
  return name
    .replace(/\s+State\s+Park.*/i, "")
    .replace(/\s+State\s+Recreation.*/i, "")
    .trim();
}

async function applyLink(
  row: UnlinkedRow,
  mpId: string,
  notes: string,
): Promise<void> {
  if (DRY_RUN) return;

  const u = await sb.from("source_record").update({ master_place_id: mpId }).eq("id", row.id);
  if (u.error) throw new Error(`ut-er: link update failed for ${row.id}: ${u.error.message}`);

  const i = await sb.from("place_match").insert({
    source_record_id: row.id,
    master_place_id: mpId,
    distance_meters: 0,
    name_similarity: 0,
    category_compatibility: 0,
    combined_confidence: 1.0,
    match_method: "ingest_time_name_link",
    status: "confirmed",
    resolved_by: "auto:utah_state_parks_er",
    resolved_at: new Date().toISOString(),
    notes,
  });
  if (i.error && !i.error.message.includes("duplicate")) {
    throw new Error(`ut-er: place_match insert failed: ${i.error.message}`);
  }

  const r = await sb.rpc("recompute_master_place", { p_master_place_id: mpId });
  if (r.error) logger.warn({ err: r.error, mpId }, "ut-er: recompute_master_place returned error");
}

async function main() {
  logger.info({ dryRun: DRY_RUN, sourceId: SOURCE_ID }, "ut-er: starting");

  const unlinked = await fetchUnlinked();
  logger.info({ unlinked: unlinked.length }, "ut-er: fetched unlinked source_records");

  const direct: UnlinkedRow[] = [];
  const remainder: UnlinkedRow[] = [];
  for (const r of unlinked) {
    if (r.intended_master_place_id) direct.push(r);
    else remainder.push(r);
  }
  logger.info(
    { direct: direct.length, remainder: remainder.length },
    "ut-er: phase 1 partition (has intended_master_place_id vs not)",
  );

  // Phase 1: direct link with RIDB preference
  let phase1Linked = 0;
  let phase1Redirected = 0;
  let phase1Direct = 0;

  for (const r of direct) {
    try {
      const intendedMp = await fetchMpInfo(r.intended_master_place_id!);
      if (!intendedMp) {
        logger.warn({ name: r.name, mpId: r.intended_master_place_id }, "ut-er: intended mp not found — skipping to Phase 2");
        remainder.push(r);
        continue;
      }

      let targetMpId = intendedMp.id;
      let targetMpName = intendedMp.canonical_name;
      let notes: string;

      if (hasRidbAttribution(intendedMp)) {
        // Already RIDB-backed — use directly
        notes = `Ingest-time name link: ${r.name} → ${targetMpName} (RIDB-backed, via ${r.matched_gis_park_external_id ?? "unknown gis id"})`;
        phase1Direct++;
      } else {
        // Check for a RIDB alternative
        const baseName = extractBaseName(intendedMp.canonical_name);
        const ridbAlt = await findRidbAlternative(baseName, intendedMp.id);
        if (ridbAlt) {
          targetMpId = ridbAlt.id;
          targetMpName = ridbAlt.canonical_name;
          notes = `Ingest-time name link with RIDB redirect: ${r.name} → ${targetMpName} (redirected from ${intendedMp.canonical_name} [prom=${intendedMp.prominence_score}] to RIDB [prom=${ridbAlt.prominence_score}], via ${r.matched_gis_park_external_id ?? "unknown gis id"})`;
          phase1Redirected++;
          logger.info(
            { web: r.name, from: intendedMp.canonical_name, to: targetMpName },
            "ut-er: RIDB redirect",
          );
        } else {
          // No RIDB alternative — use the state_parks mp as-is
          notes = `Ingest-time name link: ${r.name} → ${targetMpName} (state_parks-only, no RIDB alt, via ${r.matched_gis_park_external_id ?? "unknown gis id"})`;
          phase1Direct++;
        }
      }

      logger.info(
        { web: r.name, target_mp: targetMpName, mpId: targetMpId },
        "ut-er: phase 1 linking",
      );
      await applyLink(r, targetMpId, notes);
      phase1Linked++;
    } catch (err) {
      logger.error({ err, row: r }, "ut-er: direct link apply failed");
    }
  }

  logger.info(
    { linked: phase1Linked, directToRidb: phase1Direct, redirected: phase1Redirected, dryRun: DRY_RUN },
    "ut-er: phase 1 apply complete",
  );

  if (remainder.length === 0) {
    logger.info({}, "ut-er: nothing left for phase 2");
    return;
  }
  logger.info({ n: remainder.length }, "ut-er: phase 2 — running matchAll on remainder");
  const outcomes = await matchAll(remainder.map((m) => m.id));
  logger.info({ outcomes: outcomes.length }, "ut-er: matchAll returned");

  if (DRY_RUN) {
    const byKind: Record<string, number> = {};
    for (const o of outcomes) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    logger.info({ byKind }, "ut-er: dry-run — outcome breakdown (not applied)");
    return;
  }

  const result = await applyMatches(outcomes);
  logger.info({ result }, "ut-er: applyMatches complete");
}

main().catch((e) => {
  logger.error({ err: e }, "ut-er: fatal");
  process.exit(1);
});
