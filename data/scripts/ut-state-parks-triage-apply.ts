/**
 * Apply manual-review triage for utah_state_parks.
 *
 * All 9 pending items confirmed as LINK by Adam.
 * For each: update place_match pending→confirmed, set
 * source_record.master_place_id, recompute_master_place.
 *
 * Run:
 *   npx tsx --env-file=.env scripts/ut-state-parks-triage-apply.ts
 */

import { createClient } from "@supabase/supabase-js";
import { logger } from "../ingestion/lib/logger.ts";

const SOURCE_ID = "utah_state_parks";
const RESOLVER = "adam:ut-triage-2026-09-02";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Fetch all pending place_match rows for unlinked utah_state_parks source_records
  const { data: unlinkedSrs } = await sb
    .from("source_record")
    .select("id, name")
    .eq("source_id", SOURCE_ID)
    .is("master_place_id", null);

  if (!unlinkedSrs || unlinkedSrs.length === 0) {
    logger.info({}, "ut-triage: no unlinked source_records — nothing to do");
    return;
  }

  const srIds = unlinkedSrs.map((r) => r.id);
  const srNames = Object.fromEntries(unlinkedSrs.map((r) => [r.id, r.name]));
  logger.info({ count: srIds.length }, "ut-triage: unlinked source_records");

  const { data: pendingMatches } = await sb
    .from("place_match")
    .select("id, source_record_id, master_place_id")
    .eq("status", "pending")
    .in("source_record_id", srIds);

  if (!pendingMatches || pendingMatches.length === 0) {
    logger.info({}, "ut-triage: no pending place_match rows found");
    return;
  }

  logger.info({ count: pendingMatches.length }, "ut-triage: pending place_match rows to confirm");

  let confirmed = 0;
  for (const pm of pendingMatches) {
    const srcName = srNames[pm.source_record_id] ?? "?";

    // Get target mp name for logging
    const { data: mp } = await sb
      .from("master_place")
      .select("canonical_name")
      .eq("id", pm.master_place_id)
      .maybeSingle();

    // 1. Update place_match: pending → confirmed
    const { error: pmErr } = await sb
      .from("place_match")
      .update({
        status: "confirmed",
        resolved_by: RESOLVER,
        resolved_at: new Date().toISOString(),
        notes: `Manual triage LINK: ${srcName} → ${mp?.canonical_name ?? "?"}`,
      })
      .eq("id", pm.id);

    if (pmErr) {
      logger.error({ err: pmErr, srcName }, "ut-triage: place_match update failed");
      continue;
    }

    // 2. Set source_record.master_place_id
    const { error: srErr } = await sb
      .from("source_record")
      .update({ master_place_id: pm.master_place_id })
      .eq("id", pm.source_record_id);

    if (srErr) {
      logger.error({ err: srErr, srcName }, "ut-triage: source_record update failed");
      continue;
    }

    // 3. Recompute master_place
    const { error: rcErr } = await sb.rpc("recompute_master_place", {
      p_master_place_id: pm.master_place_id,
    });

    if (rcErr) {
      logger.warn({ err: rcErr, srcName }, "ut-triage: recompute returned error");
    }

    logger.info(
      { srcName, target: mp?.canonical_name, mpId: pm.master_place_id },
      "ut-triage: confirmed",
    );
    confirmed++;
  }

  logger.info({ confirmed }, "ut-triage: done");

  // Final counts
  const { count: totalLinked } = await sb
    .from("source_record")
    .select("*", { count: "exact", head: true })
    .eq("source_id", SOURCE_ID)
    .not("master_place_id", "is", null);

  const { count: totalUnlinked } = await sb
    .from("source_record")
    .select("*", { count: "exact", head: true })
    .eq("source_id", SOURCE_ID)
    .is("master_place_id", null);

  const { count: pmConfirmed } = await sb
    .from("place_match")
    .select("*", { count: "exact", head: true })
    .in(
      "source_record_id",
      (
        await sb
          .from("source_record")
          .select("id")
          .eq("source_id", SOURCE_ID)
      ).data?.map((r) => r.id) ?? [],
    )
    .eq("status", "confirmed");

  const { count: pmPending } = await sb
    .from("place_match")
    .select("*", { count: "exact", head: true })
    .in(
      "source_record_id",
      (
        await sb
          .from("source_record")
          .select("id")
          .eq("source_id", SOURCE_ID)
      ).data?.map((r) => r.id) ?? [],
    )
    .eq("status", "pending");

  logger.info(
    { linked: totalLinked, unlinked: totalUnlinked, pm_confirmed: pmConfirmed, pm_pending: pmPending },
    "ut-triage: final counts",
  );
}

main().catch((e) => {
  logger.error({ err: e }, "ut-triage: fatal");
  process.exit(1);
});
