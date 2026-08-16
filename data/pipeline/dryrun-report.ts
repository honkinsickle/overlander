/**
 * Per-match observability for `materialize --dry-run`.
 *
 * matchAll produces a full MatchOutcome[] with per-record confidence,
 * score components, and target MP references. On a live run applyMatches
 * consumes it; on `--dry-run` (materialize.ts) the incremental outcomes
 * cache is deliberately not saved and the array falls out of scope after
 * aggregate counts are emitted.
 *
 * This module makes those outcomes reviewable BEFORE any writes land:
 * given the outcomes + a DB client, fetch target-MP context, compute
 * per-MP source_count deltas across the whole run, flag bug-shaped
 * merges, and emit JSONL + a summary block.
 *
 * MATCHER BEHAVIOUR IS UNCHANGED. This module reads outcomes; it does
 * not alter, filter, or gate them. Aggregate outcome counts under
 * --dry-run remain byte-identical with vs. without --dry-run-report.
 *
 * WHY A NEW MODULE (not code in matcher.ts): matcher.ts is the hot
 * path. Adding an observability side-effect there would risk perf
 * regression on live runs and mix concerns. This module is only wired
 * into the dry-run branch of runResolution.
 *
 * TESTABILITY: the DB-touching outer shell (`writeDryRunReport`) is a
 * thin wrapper. The pure row-building + flag logic (`buildReport`) takes
 * fixture maps and returns rows + summary — fully unit-testable without
 * a DB or a live matchAll.
 *
 * KNOWN LIMITATION — within-run new_master_place → auto_link chain: if
 * SR1 seeds a new MP with target UUID X (planned, not-yet-in-DB) and SR2
 * later auto_links to X within the same matchAll, X won't be in `mpMap`
 * (it doesn't exist in the DB yet). The auto_link row will show
 * `target_mp_source_count_current: null` and projected count derived
 * from the seed + delta only. Rare in the incremental path but not
 * handled here — flag if it becomes common.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MatchOutcome } from "../entity-resolution/matcher.ts";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

// ── Types ───────────────────────────────────────────────────────────────

/**
 * One diagnostic row per outcome. Written to JSONL for downstream
 * inspection (jq / spreadsheet / eyeballing) without a DB dependency.
 *
 * Field names are stable — external tooling may key on them.
 */
export interface DryRunReportRow {
  outcome: "auto_link" | "manual_review" | "new_master_place" | "amenity_rollup";
  source_record_id: string;
  source_external_id: string | null;
  source_name: string | null;
  source_lng: number | null;
  source_lat: number | null;
  source_inferred_category: string | null;

  match_method: string | null;
  combined_confidence: number | null;
  distance_meters: number | null;
  name_similarity: number | null;
  category_compatibility: number | null;

  target_mp_id: string | null;
  target_mp_name: string | null;
  target_mp_category: string | null;
  target_mp_source_count_current: number | null;
  /**
   * Projected source_count on the target MP AFTER apply — computed as
   * `current + delta` where delta counts auto_link + amenity_rollup
   * outcomes anywhere in the run targeting the same MP. Manual_review
   * rows targeting an MP that receives auto_links from OTHER rows will
   * reflect that projected total (the MP's actual final state), even
   * though the manual_review itself doesn't contribute.
   *
   * new_master_place: 1 (the seed).
   * Target not in mpMap (planned within-run MP): null.
   */
  target_mp_source_count_projected: number | null;

  // Bug-shape / operational flags — see writeDryRunReport() docstring.
  flags: string[];
}

export interface DryRunReportSummary {
  total_outcomes: number;
  by_outcome: Record<string, number>;
  flagged: {
    projected_source_count_gt_20: DryRunReportRow[];
    mp_receiving_gt_3_new_srs: DryRunReportRow[];
    auto_link_low_confidence: DryRunReportRow[];
    auto_link_prefix_driven_bug2: DryRunReportRow[];
    auto_link_coord_dominant_bug1: DryRunReportRow[];
  };
}

// Fixture-friendly context maps consumed by the pure buildReport().
export interface SrContext {
  id: string;
  external_id: string | null;
  name: string | null;
  inferred_category: string | null;
  /** Either GeoJSON Point-shaped or a raw string; parsePoint handles both. */
  geometry: { type: "Point"; coordinates: [number, number] } | string | null;
}
export interface MpContext {
  id: string;
  canonical_name: string | null;
  primary_category: string | null;
  source_count: number;
}

// ── Pure helpers (unit-testable) ────────────────────────────────────────

/**
 * Which outcome kinds add a source_record link to a target MP.
 * `auto_link` and `amenity_rollup` both drive source_count++.
 * `manual_review` does NOT link (source stays unlinked with a pending
 * place_match). `new_master_place` creates a fresh MP with count=1.
 */
function outcomeLinksToExistingMP(o: MatchOutcome): boolean {
  return o.kind === "auto_link" || o.kind === "amenity_rollup";
}

/**
 * Compute the +N delta per existing target MP that would land if all
 * outcomes were applied. Only counts `auto_link` and `amenity_rollup`.
 * Exported for tests.
 */
export function computeProjectedDeltas(
  outcomes: readonly MatchOutcome[],
): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const o of outcomes) {
    if (!outcomeLinksToExistingMP(o)) continue;
    // Both auto_link and amenity_rollup carry a `target` field.
    // (new_master_place's `target` is a fresh UUID for a not-yet-existing MP,
    // so it doesn't belong here — we filter it above.)
    const t = (o as { target: string }).target;
    deltas.set(t, (deltas.get(t) ?? 0) + 1);
  }
  return deltas;
}

/**
 * Longest shared case-insensitive prefix, in characters. Used only by
 * the bug-2-shape heuristic. Pure; exported for tests.
 */
export function sharedPrefixLength(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return i;
}

/**
 * Bug-2 shape: shared prefix ≥6 chars AND divergent suffix. "Divergent"
 * = the two names' shared prefix accounts for less than half of both
 * strings AND the overall Jaro-Winkler-adjacent name_similarity is
 * moderate-not-high (< 0.9). This is a heuristic — it flags candidates,
 * doesn't declare bugs.
 *
 * Exact identity is NOT a bug shape (identical names are the intended
 * name_dominant success path).
 */
export function looksPrefixDrivenBug2(
  srName: string | null | undefined,
  mpName: string | null | undefined,
  nameSimilarity: number | null | undefined,
): boolean {
  if (!srName || !mpName) return false;
  const a = srName.trim();
  const b = mpName.trim();
  if (a.length < 6 || b.length < 6) return false;
  if (a.toLowerCase() === b.toLowerCase()) return false;
  const pfx = sharedPrefixLength(a, b);
  if (pfx < 6) return false;
  // Prefix accounts for less than half of the longer name → divergent suffix
  const longer = Math.max(a.length, b.length);
  if (pfx / longer >= 0.5) return false;
  // Name similarity moderate-not-high — the outcome linked despite
  // divergence, which is the bug shape.
  if ((nameSimilarity ?? 1) >= 0.9) return false;
  return true;
}

/**
 * Bug-1 shape: coord-dominant merge with weak name similarity.
 * distance ≤ 50m AND name_similarity < 0.7 on an auto_link outcome.
 */
export function looksCoordDominantBug1(row: DryRunReportRow): boolean {
  if (row.outcome !== "auto_link") return false;
  if (row.distance_meters == null || row.distance_meters > 50) return false;
  if (row.name_similarity == null || row.name_similarity >= 0.7) return false;
  return true;
}

/**
 * Build the per-row flag list. All three bug-shape flags gate to
 * `auto_link` outcomes only — the operator wants merges that landed,
 * not pending review or amenity rollups. `projected_source_count_gt_20`
 * fires on ANY outcome that touches an MP whose projected total > 20
 * (see the WriteReportArgs docstring for semantics). The delta-based
 * `mp_receiving_gt_3_new_srs` flag is set in a separate MP-level pass
 * (buildReport), not row-locally, because it depends on the run-wide
 * accumulator.
 */
function baseFlagsFor(row: DryRunReportRow): string[] {
  const flags: string[] = [];
  if (row.outcome !== "auto_link") return flags;
  if (row.combined_confidence != null && row.combined_confidence < 0.7) {
    flags.push("low_confidence_auto_link");
  }
  if (looksCoordDominantBug1(row)) flags.push("bug1_coord_dominant_weak_name");
  if (looksPrefixDrivenBug2(row.source_name, row.target_mp_name, row.name_similarity)) {
    flags.push("bug2_prefix_driven_divergent_suffix");
  }
  return flags;
}

function parsePoint(g: SrContext["geometry"]): [number, number] | null {
  if (!g) return null;
  if (typeof g !== "string" && g.type === "Point" && Array.isArray(g.coordinates)) {
    const [lng, lat] = g.coordinates;
    if (typeof lng === "number" && typeof lat === "number") return [lng, lat];
  }
  return null;
}

// ── Pure report builder (fixture-testable, no DB) ──────────────────────

/**
 * Given outcomes + fixture-provided SR and MP context maps, produce the
 * per-outcome DryRunReportRow[] + summary. Pure; no I/O.
 *
 * KEY INVARIANTS this preserves:
 *   1. `target_mp_source_count_projected` reflects the MP's ACTUAL final
 *      state after all outcomes are applied, regardless of which
 *      outcome's row you read. A manual_review row targeting MP X with
 *      current=5 that also receives 3 auto_links from other SRs shows
 *      projected=8 — same value the auto_link rows show.
 *   2. Flags are stable strings; downstream tools may string-match.
 *   3. `mp_receiving_gt_3_new_srs` is a DELTA flag (count of new SRs
 *      auto_link'd + rolled-up onto the MP in THIS RUN > 3). Distinct
 *      from `projected_source_count_gt_20` which is a TOTAL flag.
 *      A large pre-existing MP receiving one new SR triggers neither.
 */
export function buildReport(
  outcomes: readonly MatchOutcome[],
  srMap: ReadonlyMap<string, SrContext>,
  mpMap: ReadonlyMap<string, MpContext>,
): { rows: DryRunReportRow[]; summary: DryRunReportSummary } {
  const deltas = computeProjectedDeltas(outcomes);

  // Row build
  const rows: DryRunReportRow[] = [];
  for (const o of outcomes) {
    const sr = srMap.get(o.source_record_id);
    const point = sr ? parsePoint(sr.geometry) : null;
    // Every MatchOutcome variant carries `target` — auto_link, amenity_rollup,
    // manual_review, and new_master_place (new_master_place's target is a
    // pre-allocated UUID for the MP the seed will create; the others' targets
    // point at existing MPs, except for within-run cross-links to a planned
    // UUID — see the KNOWN LIMITATION in the module docstring).
    const targetId = (o as { target: string }).target;
    const isExistingMpLink =
      o.kind === "auto_link" || o.kind === "amenity_rollup" || o.kind === "manual_review";
    const mp = isExistingMpLink ? mpMap.get(targetId) : undefined;

    const scoreOutcome =
      o.kind === "auto_link" || o.kind === "manual_review" ? o : null;
    const score = scoreOutcome?.score ?? null;

    const currentSC = mp?.source_count ?? null;
    // Projected reflects the ACTUAL final state of the target MP after all
    // outcomes apply. auto_link/rollup outcomes on this MP contribute to
    // `delta`; manual_review does not contribute but the projected value
    // for THIS row still reflects the MP's final state so the report is
    // consistent across all rows targeting the same MP.
    const projectedSC: number | null = mp
      ? (currentSC ?? 0) + (deltas.get(targetId) ?? 0)
      : o.kind === "new_master_place"
      ? 1
      : null;

    const row: DryRunReportRow = {
      outcome: o.kind,
      source_record_id: o.source_record_id,
      source_external_id: sr?.external_id ?? null,
      source_name: sr?.name ?? null,
      source_lng: point?.[0] ?? null,
      source_lat: point?.[1] ?? null,
      source_inferred_category: sr?.inferred_category ?? null,

      match_method:
        (o as { method?: string }).method ??
        (o.kind === "new_master_place" ? "new" : null),
      combined_confidence: scoreOutcome?.confidence ?? (score?.combined_confidence ?? null),
      distance_meters: score?.distance_meters ?? null,
      name_similarity: score?.name_similarity ?? null,
      category_compatibility: score?.category_compatibility ?? null,

      target_mp_id: isExistingMpLink ? targetId : (o.kind === "new_master_place" ? targetId : null),
      target_mp_name: mp?.canonical_name ?? (o.kind === "new_master_place" ? o.seed_name : null),
      target_mp_category: mp?.primary_category ?? (o.kind === "new_master_place" ? o.seed_category : null),
      target_mp_source_count_current: currentSC,
      target_mp_source_count_projected: projectedSC,

      flags: [],
    };
    row.flags = baseFlagsFor(row);
    // Projected-total flag — fires when the FINAL MP source_count > 20.
    if (projectedSC != null && projectedSC > 20) row.flags.push("projected_source_count_gt_20");
    rows.push(row);
  }

  // MP-level flag pass: `mp_receiving_gt_3_new_srs` is a DELTA-based
  // flag (count of new SRs auto_link'd + rolled-up on the MP > 3 in this
  // run). Applied to every row that contributes to a flagged MP so the
  // JSONL is straightforward to filter, but the summary tracks DISTINCT
  // MPs — the flag is fundamentally per-MP.
  const flaggedTargets = new Set<string>();
  for (const [mpId, delta] of deltas.entries()) {
    if (delta > 3) flaggedTargets.add(mpId);
  }
  for (const row of rows) {
    if (row.target_mp_id && flaggedTargets.has(row.target_mp_id)) {
      row.flags.push("mp_receiving_gt_3_new_srs");
    }
  }

  // Summary
  const byOutcome: Record<string, number> = {};
  for (const r of rows) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;

  const summary: DryRunReportSummary = {
    total_outcomes: rows.length,
    by_outcome: byOutcome,
    flagged: {
      projected_source_count_gt_20: rows.filter((r) => r.flags.includes("projected_source_count_gt_20")),
      mp_receiving_gt_3_new_srs: rows.filter((r) => r.flags.includes("mp_receiving_gt_3_new_srs")),
      auto_link_low_confidence: rows.filter((r) => r.flags.includes("low_confidence_auto_link")),
      auto_link_prefix_driven_bug2: rows.filter((r) => r.flags.includes("bug2_prefix_driven_divergent_suffix")),
      auto_link_coord_dominant_bug1: rows.filter((r) => r.flags.includes("bug1_coord_dominant_weak_name")),
    },
  };

  return { rows, summary };
}

// ── DB-touching outer shell (thin — wraps buildReport) ─────────────────

type SrRow = SrContext;
type MpRow = MpContext;

/**
 * Batched .in('id', chunk) fetch. 100-per-chunk keeps the PostgREST URL
 * comfortably under length limits at UUID scale (100 × 36 chars ≈ 3.6KB
 * plus overhead — well within 8KB). Errors on a chunk log + skip the
 * chunk; the report keeps going with null enrichment for those rows.
 */
async function batchedFetch<T extends { id: string }>(
  db: SupabaseClient,
  table: string,
  ids: readonly string[],
  select: string,
  label: string,
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (ids.length === 0) return out;
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const r = await db.from(table).select(select).in("id", chunk);
    if (r.error || r.data == null) {
      logger.warn({ err: r.error, label, chunk: i / chunkSize, size: chunk.length }, "dryrun-report: batch fetch failed — chunk skipped");
      continue;
    }
    for (const row of r.data as unknown as T[]) {
      out.set(row.id, row);
    }
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────

export interface WriteReportArgs {
  outcomes: readonly MatchOutcome[];
  outputPath: string;
  db?: SupabaseClient;
}

export interface WriteReportResult {
  rows: number;
  summary: DryRunReportSummary;
  outputPath: string;
}

/**
 * Enrich outcomes with SR + target-MP context, delegate to the pure
 * `buildReport`, write per-row JSONL and a final summary block to
 * `outputPath`. Idempotent: overwrites `outputPath` if it exists.
 */
export async function writeDryRunReport(args: WriteReportArgs): Promise<WriteReportResult> {
  const { outcomes, outputPath } = args;
  const db = args.db ?? getDb();

  logger.info(
    { outputPath, outcomes: outcomes.length },
    "dryrun-report: enriching outcomes for per-match review",
  );

  const srIds = Array.from(new Set(outcomes.map((o) => o.source_record_id)));
  const existingMpTargets = Array.from(
    new Set(
      outcomes
        .filter((o) => o.kind === "auto_link" || o.kind === "amenity_rollup" || o.kind === "manual_review")
        .map((o) => (o as { target: string }).target),
    ),
  );

  const srMap = await batchedFetch<SrRow>(
    db,
    "source_record",
    srIds,
    "id,external_id,name,inferred_category,geometry",
    "sr_context",
  );
  const mpMap = await batchedFetch<MpRow>(
    db,
    "master_place",
    existingMpTargets,
    "id,canonical_name,primary_category,source_count",
    "mp_context",
  );

  const { rows, summary } = buildReport(outcomes, srMap, mpMap);

  // Write JSONL + trailing summary block.
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "");
  for (const r of rows) appendFileSync(outputPath, JSON.stringify(r) + "\n");

  // Summary counts: emit rows AND distinct MPs for the MP-level flags so
  // "how many rows would land on hot MPs" and "how many MPs are hot" are
  // both surfaced.
  const distinctAffectedMps = (rowsSubset: DryRunReportRow[]): number =>
    new Set(rowsSubset.map((r) => r.target_mp_id).filter((x): x is string => Boolean(x))).size;
  appendFileSync(
    outputPath,
    "\n" +
      "# ─── SUMMARY ───\n" +
      "# " +
      JSON.stringify({
        total_outcomes: summary.total_outcomes,
        by_outcome: summary.by_outcome,
        flagged_counts: {
          projected_source_count_gt_20_rows: summary.flagged.projected_source_count_gt_20.length,
          projected_source_count_gt_20_distinct_mps: distinctAffectedMps(summary.flagged.projected_source_count_gt_20),
          mp_receiving_gt_3_new_srs_rows: summary.flagged.mp_receiving_gt_3_new_srs.length,
          mp_receiving_gt_3_new_srs_distinct_mps: distinctAffectedMps(summary.flagged.mp_receiving_gt_3_new_srs),
          auto_link_low_confidence: summary.flagged.auto_link_low_confidence.length,
          auto_link_prefix_driven_bug2: summary.flagged.auto_link_prefix_driven_bug2.length,
          auto_link_coord_dominant_bug1: summary.flagged.auto_link_coord_dominant_bug1.length,
        },
      }) +
      "\n",
  );

  logger.info(
    {
      outputPath,
      rows: rows.length,
      flagged: {
        projected_gt_20_rows: summary.flagged.projected_source_count_gt_20.length,
        mp_receiving_gt_3_rows: summary.flagged.mp_receiving_gt_3_new_srs.length,
        low_conf_auto: summary.flagged.auto_link_low_confidence.length,
        bug2_prefix: summary.flagged.auto_link_prefix_driven_bug2.length,
        bug1_coord: summary.flagged.auto_link_coord_dominant_bug1.length,
      },
    },
    "dryrun-report: written",
  );

  return { rows: rows.length, summary, outputPath };
}
