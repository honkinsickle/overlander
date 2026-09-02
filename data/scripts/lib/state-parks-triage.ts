/**
 * Shared manual-review triage runner for the state-park visitor-content
 * sources (CA / WA / OR / NV).
 *
 * These four states had triage applied by hand during their original PR
 * follow-ups — their links carry `resolved_by` stamps
 * (`adam:nv-triage-2026-09-02`, `auto:oregon_state_parks_triage_2026-09-02`,
 * or nothing at all) that correspond to no committed script. This is that
 * missing tooling, for the quarterly refresh rounds.
 *
 * It deliberately does NOT re-apply the historical decisions — TEST already
 * reflects those, and every state currently has an empty pending queue.
 *
 * Shape follows `az-state-parks-triage-apply.mjs`, which is the better of the
 * two existing templates: decision-driven and dry-run-by-default, where
 * `ut-state-parks-triage-apply.ts` can only blanket-confirm every pending item.
 * Two departures from AZ: this is `.ts` (AZ's `.mjs` sits outside
 * `tsc --noEmit` and gets no type checking), and decisions are supplied from a
 * JSON file rather than hardcoded, so the script survives its round.
 *
 * Workflow:
 *   1. `--list`             dump the pending queue for review
 *   2. Adam decides         produce a decisions JSON (schema below)
 *   3. `--apply f.json`     dry-run preview
 *   4. `--apply f.json --write`   write
 *
 * Decisions file: `[{ "external_id": "...", "action": "link" | "relink" |
 * "reject", "target_mp_id": "<uuid, relink only>", "notes": "..." }]`
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../ingestion/lib/logger.ts";

export interface TriageConfig {
  sourceId: string;
  /** Stamp written to `place_match.resolved_by`. Include the date of the round. */
  resolver: string;
  label: string;
}

export type TriageAction = "link" | "relink" | "reject";

export interface TriageDecision {
  external_id: string;
  action: TriageAction;
  /** Required for `relink` — the master_place the record should point at. */
  target_mp_id?: string;
  notes?: string;
}

interface PendingItem {
  placeMatchId: string;
  sourceRecordId: string;
  externalId: string;
  sourceName: string;
  proposedMpId: string;
  proposedMpName: string;
  combinedConfidence: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Every unlinked source_record for this source with a pending place_match. */
export async function fetchPending(sb: SupabaseClient, cfg: TriageConfig): Promise<PendingItem[]> {
  const srs = await sb
    .from("source_record")
    .select("id, external_id, name")
    .eq("source_id", cfg.sourceId)
    .is("master_place_id", null);
  if (srs.error || srs.data == null) {
    throw new Error(`${cfg.label}: source_record fetch failed: ${JSON.stringify(srs.error)}`);
  }
  if (srs.data.length === 0) return [];

  const byId = new Map(srs.data.map((r) => [String(r.id), r]));
  const ids = [...byId.keys()];

  const out: PendingItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const pm = await sb
      .from("place_match")
      .select("id, source_record_id, master_place_id, combined_confidence")
      .eq("status", "pending")
      .in("source_record_id", ids.slice(i, i + 200));
    if (pm.error || pm.data == null) {
      throw new Error(`${cfg.label}: place_match fetch failed: ${JSON.stringify(pm.error)}`);
    }
    for (const m of pm.data) {
      const mp = await sb
        .from("master_place")
        .select("canonical_name")
        .eq("id", m.master_place_id)
        .maybeSingle();
      const sr = byId.get(String(m.source_record_id));
      out.push({
        placeMatchId: String(m.id),
        sourceRecordId: String(m.source_record_id),
        externalId: String(sr?.external_id ?? "?"),
        sourceName: String(sr?.name ?? "?"),
        proposedMpId: String(m.master_place_id),
        proposedMpName: String(mp.data?.canonical_name ?? "?"),
        combinedConfidence: typeof m.combined_confidence === "number" ? m.combined_confidence : null,
      });
    }
  }
  return out;
}

export function printPending(cfg: TriageConfig, items: PendingItem[]): void {
  console.log(`\n── pending manual review — ${cfg.sourceId} — ${items.length} item(s)\n`);
  if (items.length === 0) {
    console.log("  (queue empty — nothing to triage)\n");
    return;
  }
  for (const it of items) {
    console.log(`  ${it.externalId}`);
    console.log(`     source     : ${it.sourceName}`);
    console.log(`     proposed mp: ${it.proposedMpId}  (${it.proposedMpName})`);
    console.log(`     confidence : ${it.combinedConfidence ?? "n/a"}`);
    console.log();
  }
  console.log("  Produce a decisions JSON, then: --apply <file> [--write]\n");
}

export interface TriageResult {
  linked: number;
  relinked: number;
  rejected: number;
  skipped: number;
  failed: number;
}

/**
 * Apply decisions. `write` is false by default — the caller must opt in.
 *
 * `reject` marks the match rejected and leaves the source_record unlinked; the
 * new master_place is then created by re-running that state's ER script, whose
 * phase 2 routes the record through `matchAll`/`applyMatches`. Deliberately not
 * reimplemented here — `promote.ts` owns master_place creation.
 */
export async function applyDecisions(
  sb: SupabaseClient,
  cfg: TriageConfig,
  decisions: readonly TriageDecision[],
  write: boolean,
): Promise<TriageResult> {
  const pending = await fetchPending(sb, cfg);
  const byExternalId = new Map(pending.map((p) => [p.externalId, p]));
  const res: TriageResult = { linked: 0, relinked: 0, rejected: 0, skipped: 0, failed: 0 };

  for (const d of decisions) {
    const item = byExternalId.get(d.external_id);
    if (!item) {
      logger.warn({ externalId: d.external_id }, `${cfg.label}: no pending item — skipping`);
      res.skipped += 1;
      continue;
    }
    if (d.action === "relink" && !d.target_mp_id) {
      logger.error({ externalId: d.external_id }, `${cfg.label}: relink requires target_mp_id`);
      res.failed += 1;
      continue;
    }

    const targetMpId = d.action === "relink" ? d.target_mp_id! : item.proposedMpId;
    const verb = d.action.toUpperCase();
    console.log(
      `  ${write ? "APPLY " : "DRYRUN"} ${verb.padEnd(6)} ${item.sourceName} → ` +
        `${d.action === "reject" ? "(rejected, stays unlinked)" : targetMpId}`,
    );
    if (!write) {
      if (d.action === "link") res.linked += 1;
      else if (d.action === "relink") res.relinked += 1;
      else res.rejected += 1;
      continue;
    }

    try {
      if (d.action === "reject") {
        const u = await sb
          .from("place_match")
          .update({
            status: "rejected",
            resolved_by: cfg.resolver,
            resolved_at: new Date().toISOString(),
            notes: d.notes ?? `Manual triage REJECT: ${item.sourceName} ≠ ${item.proposedMpName}`,
          })
          .eq("id", item.placeMatchId);
        if (u.error) throw new Error(u.error.message);
        res.rejected += 1;
        continue;
      }

      const pmUpdate: Record<string, unknown> = {
        status: "confirmed",
        match_method: "manual_triage",
        resolved_by: cfg.resolver,
        resolved_at: new Date().toISOString(),
        notes: d.notes ?? `Manual triage ${verb}: ${item.sourceName} → ${targetMpId}`,
      };
      if (d.action === "relink") pmUpdate.master_place_id = targetMpId;

      const pmRes = await sb.from("place_match").update(pmUpdate).eq("id", item.placeMatchId);
      if (pmRes.error) throw new Error(`place_match: ${pmRes.error.message}`);

      const srRes = await sb
        .from("source_record")
        .update({ master_place_id: targetMpId })
        .eq("id", item.sourceRecordId);
      if (srRes.error) throw new Error(`source_record: ${srRes.error.message}`);

      const rc = await sb.rpc("recompute_master_place", { p_master_place_id: targetMpId });
      if (rc.error) logger.warn({ err: rc.error, targetMpId }, `${cfg.label}: recompute returned error`);

      if (d.action === "link") res.linked += 1;
      else res.relinked += 1;
    } catch (err) {
      logger.error({ err, externalId: d.external_id }, `${cfg.label}: apply failed`);
      res.failed += 1;
    }
  }
  return res;
}

/** Entry point every per-state triage script calls. Reads flags from argv. */
export async function runStateParksTriage(
  sb: SupabaseClient,
  cfg: TriageConfig,
  readDecisions: (path: string) => unknown,
): Promise<void> {
  const argv = process.argv;
  const applyIdx = argv.indexOf("--apply");
  const write = argv.includes("--write");

  if (applyIdx === -1) {
    printPending(cfg, await fetchPending(sb, cfg));
    return;
  }

  const path = argv[applyIdx + 1];
  if (!path) throw new Error(`${cfg.label}: --apply requires a decisions JSON path`);

  const parsed = readDecisions(path);
  if (!Array.isArray(parsed)) throw new Error(`${cfg.label}: decisions file must be a JSON array`);
  const decisions: TriageDecision[] = [];
  for (const d of parsed) {
    if (!isRecord(d) || typeof d.external_id !== "string" || typeof d.action !== "string") {
      throw new Error(`${cfg.label}: bad decision entry: ${JSON.stringify(d)}`);
    }
    if (d.action !== "link" && d.action !== "relink" && d.action !== "reject") {
      throw new Error(`${cfg.label}: unknown action "${d.action}"`);
    }
    decisions.push({
      external_id: d.external_id,
      action: d.action,
      target_mp_id: typeof d.target_mp_id === "string" ? d.target_mp_id : undefined,
      notes: typeof d.notes === "string" ? d.notes : undefined,
    });
  }

  console.log(`\n── ${cfg.sourceId} triage — ${decisions.length} decision(s), ${write ? "WRITING" : "dry-run"}\n`);
  const result = await applyDecisions(sb, cfg, decisions, write);
  console.log(`\n  ${JSON.stringify(result)}`);
  if (!write) console.log("  (dry-run — re-run with --write to apply)\n");
}
