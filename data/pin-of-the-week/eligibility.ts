/**
 * Pin of the Week — eligibility model.
 *
 * A "Pin of the Week" candidate is a master_place that is safe and appealing
 * to feature publicly on Instagram. The rules below are grounded in the real
 * schema (see docs/content/pin-of-the-week.md for the derivation):
 *
 *  - RESOLVED PHOTO       → photo_url is a non-empty snapshot column
 *                           (backfill_master_place_photo_url; nps>ridb>blm>state).
 *  - NON-TEMPLATE DESC    → description present AND its attribution is NOT one of
 *                           the two synthetic generated sources
 *                           ('generated_template' | 'generated_llm'). This is
 *                           exactly master_place_search_export.description_source
 *                           = 'source' (genuine source-derived prose).
 *  - VERIFICATION SIGNAL  → master_place.rating/review_count are NULL corpus-wide
 *                           (no ingested source carries a rating; Google ratings
 *                           are prohibited from storage). So the grounded
 *                           "verification" proxy is: an official source
 *                           (nps | ridb) contributed at least one field, and/or
 *                           prominence_score > 0. See VERIFICATION_NOTE.
 *  - PUBLISHABLE STATE    → is_searchable = true (excludes land_status) and the
 *                           place is not CLOSED / DECOMMISSIONED / UNREACHABLE.
 *
 * This module is read-only. It never writes to master_place.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const TEST_PROJECT_REF = "znldzjdatkogdktymtvi";

/** Attribution values that mark a description as machine-generated (template or LLM). */
export const GENERATED_DESCRIPTION_SOURCES = ["generated_template", "generated_llm"] as const;

/** Sources that count as an official verification signal. */
export const OFFICIAL_SOURCES = ["nps", "ridb"] as const;

/** operational_status values that make a place unfit to feature. */
export const UNFEATURABLE_STATUS = ["CLOSED", "TEMPORARILY CLOSED", "DECOMMISSIONED", "UNREACHABLE"] as const;

export const VERIFICATION_NOTE =
  "master_place.rating is NULL corpus-wide (no source carries a numeric rating). " +
  "The verification signal used here is: official source (nps/ridb) present and/or prominence_score > 0.";

/** The subset of master_place columns the selector reads. */
export interface CandidateRow {
  id: string;
  canonical_name: string;
  primary_category: string;
  secondary_categories: string[] | null;
  state: string | null;
  description: string | null;
  photo_url: string | null;
  rating: number | null;
  review_count: number | null;
  prominence_score: number;
  source_count: number;
  attribution: Record<string, string> | null;
  operational_status: string | null;
  is_searchable: boolean;
}

export const CANDIDATE_COLUMNS =
  "id,canonical_name,primary_category,secondary_categories,state,description," +
  "photo_url,rating,review_count,prominence_score,source_count,attribution," +
  "operational_status,is_searchable";

export interface EligibilitySignals {
  hasPhoto: boolean;
  hasNonTemplateDescription: boolean;
  descriptionSource: "source" | "template" | "llm" | null;
  hasOfficialSource: boolean;
  officialSources: string[];
  hasProminence: boolean;
  hasNumericRating: boolean;
  isPublishableState: boolean;
  isSearchable: boolean;
}

export interface EvaluatedCandidate extends CandidateRow {
  signals: EligibilitySignals;
  eligible: boolean;
  /** Human-readable reasons the row was rejected (empty when eligible). */
  rejections: string[];
}

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

/** Classify a row's description exactly like master_place_search_export.description_source. */
export function descriptionSource(row: CandidateRow): EligibilitySignals["descriptionSource"] {
  const attr = row.attribution?.["description"];
  if (attr === "generated_llm") return "llm";
  if (attr === "generated_template") return "template";
  if (nonEmpty(row.description)) return "source";
  return null;
}

export function officialSourcesOf(row: CandidateRow): string[] {
  const values = Object.values(row.attribution ?? {});
  return OFFICIAL_SOURCES.filter((s) => values.includes(s));
}

export function evaluate(row: CandidateRow): EvaluatedCandidate {
  const descSource = descriptionSource(row);
  const officialSources = officialSourcesOf(row);
  const isUnfeaturable =
    row.operational_status != null &&
    (UNFEATURABLE_STATUS as readonly string[]).includes(row.operational_status);

  const signals: EligibilitySignals = {
    hasPhoto: nonEmpty(row.photo_url),
    hasNonTemplateDescription: descSource === "source",
    descriptionSource: descSource,
    hasOfficialSource: officialSources.length > 0,
    officialSources,
    hasProminence: row.prominence_score > 0,
    hasNumericRating: row.rating != null,
    isPublishableState: !isUnfeaturable,
    isSearchable: row.is_searchable === true,
  };

  const rejections: string[] = [];
  if (!signals.isSearchable) rejections.push("not searchable (land_status)");
  if (!signals.hasPhoto) rejections.push("no resolved photo");
  if (!signals.hasNonTemplateDescription) {
    rejections.push(`description not source-derived (${descSource ?? "none"})`);
  }
  if (!(signals.hasOfficialSource || signals.hasProminence)) {
    rejections.push("no verification signal (no official source and prominence_score = 0)");
  }
  if (!signals.isPublishableState) rejections.push(`unpublishable status: ${row.operational_status}`);

  return { ...row, signals, eligible: rejections.length === 0, rejections };
}

/**
 * Scan the full master_place table on the connected project and evaluate every
 * row. The TEST corpus is small (~2k rows) so a full paginated scan is exact and
 * avoids PostgREST jsonb-filter / null-count traps (see CLAUDE.md RUNBOOK).
 */
export async function fetchEvaluatedCandidates(db: SupabaseClient): Promise<EvaluatedCandidate[]> {
  const PAGE = 1000;
  const out: EvaluatedCandidate[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await db
      .from("master_place")
      .select(CANDIDATE_COLUMNS)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    // Null-count / silent-failure trap guard (CLAUDE.md RUNBOOK).
    if (res.error || res.data == null) {
      throw new Error(`master_place scan failed at offset ${from}: ${JSON.stringify(res)}`);
    }
    const rows = res.data as unknown as CandidateRow[];
    for (const row of rows) out.push(evaluate(row));
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Fetch and evaluate one place by id. Returns null if no such row. */
export async function fetchEvaluatedById(
  db: SupabaseClient,
  id: string,
): Promise<EvaluatedCandidate | null> {
  const res = await db.from("master_place").select(CANDIDATE_COLUMNS).eq("id", id).limit(1);
  if (res.error || res.data == null) throw new Error(`fetch by id failed: ${JSON.stringify(res)}`);
  if (res.data.length === 0) return null;
  return evaluate(res.data[0] as unknown as CandidateRow);
}

/**
 * Name lookup for manual selection: case-insensitive substring match on
 * canonical_name. This is an UNINDEXED sequential scan over master_place (no
 * trigram index exists), so it is fine for occasional manual/CLI use but is NOT
 * suitable for a hot path. Capped with a small limit.
 */
export async function searchEvaluatedByName(
  db: SupabaseClient,
  name: string,
  limit = 12,
): Promise<EvaluatedCandidate[]> {
  const pattern = `%${name.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const res = await db
    .from("master_place")
    .select(CANDIDATE_COLUMNS)
    .ilike("canonical_name", pattern)
    .order("prominence_score", { ascending: false })
    .limit(limit);
  if (res.error || res.data == null) throw new Error(`name search failed: ${JSON.stringify(res)}`);
  return (res.data as unknown as CandidateRow[]).map(evaluate);
}

/** Guard: refuse to run against anything but the TEST project. */
export function assertTestProject(): void {
  const url = process.env.SUPABASE_URL ?? "";
  const ref = url.match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  if (ref !== TEST_PROJECT_REF) {
    throw new Error(
      `refusing to run against non-TEST project "${ref}". Pin of the Week is TEST-only (${TEST_PROJECT_REF}).`,
    );
  }
}
