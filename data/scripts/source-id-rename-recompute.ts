/**
 * Refresh `master_place.attribution` after the source_id rename.
 *
 * `attribution` stores WHICH SOURCE contributed each field, by source_id value.
 * Renaming `source_record.source_id` leaves every affected master_place holding
 * the OLD name in attribution — stale, and per the schema invariants
 * attribution is the source of truth for field provenance. It must never be
 * written directly, only rebuilt by `recompute_master_place()`, which is what
 * this does.
 *
 * Safe by construction: `data/scripts/source-id-rename-tiebreak-sim.ts` proved
 * no resolved VALUE changes owner (source_id is only resolve_field's third
 * ORDER BY key and nothing ties these sources on priority+quality), so
 * recompute re-labels attribution without moving any field to a new source.
 *
 * Target is whichever project `SUPABASE_URL` points at — run it once per
 * environment, right after the rename migration lands there.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/source-id-rename-recompute.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { logger } from "../ingestion/lib/logger.ts";

const SOURCES = ["california_state_parks", "washington_state_parks"] as const;
const DRY_RUN = process.argv.includes("--dry-run");

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function affectedMasterPlaces(sourceId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (let off = 0; ; off += 1000) {
    const r = await sb
      .from("source_record")
      .select("master_place_id")
      .eq("source_id", sourceId)
      .not("master_place_id", "is", null)
      .order("id")
      .range(off, off + 999);
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [${sourceId}]: ${JSON.stringify(r.error)}`);
    for (const x of r.data) if (typeof x.master_place_id === "string") ids.add(x.master_place_id);
    if (r.data.length < 1000) break;
  }
  return [...ids];
}

async function main(): Promise<void> {
  const target = process.env.SUPABASE_URL ?? "(unset)";
  logger.info({ target, dryRun: DRY_RUN }, "rename-recompute: starting");

  for (const sourceId of SOURCES) {
    const ids = await affectedMasterPlaces(sourceId);
    logger.info({ sourceId, masterPlaces: ids.length }, "rename-recompute: affected");
    if (ids.length === 0 || DRY_RUN) continue;

    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      const r = await sb.rpc("recompute_master_place", { p_master_place_id: id });
      if (r.error) {
        failed += 1;
        logger.warn({ err: r.error, id }, "rename-recompute: recompute failed");
      } else {
        ok += 1;
      }
    }
    logger.info({ sourceId, ok, failed }, "rename-recompute: done");
  }

  // Confirm no attribution anywhere still names the old identifiers.
  for (const [oldName, newName] of [
    ["state_parks_web", "california_state_parks"],
    ["state_parks_web_wa", "washington_state_parks"],
  ] as const) {
    const ids = await affectedMasterPlaces(newName);
    let stale = 0;
    let fresh = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const r = await sb.from("master_place").select("attribution").in("id", ids.slice(i, i + 200));
      if (r.error || r.data == null) throw new Error(`QUERY FAILED: ${JSON.stringify(r.error)}`);
      for (const row of r.data) {
        const a = row.attribution;
        if (typeof a !== "object" || a === null) continue;
        const vals = Object.values(a as Record<string, unknown>);
        if (vals.includes(oldName)) stale += 1;
        if (vals.includes(newName)) fresh += 1;
      }
    }
    console.log(`  ${newName}: attribution referencing '${oldName}' = ${stale} (must be 0) · referencing '${newName}' = ${fresh}`);
  }
}

main().catch((e: unknown) => {
  logger.error({ err: e }, "rename-recompute: fatal");
  process.exit(1);
});
