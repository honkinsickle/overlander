/**
 * Pin of the Week — SELECT stage (TEST-only).
 *
 * Returns ONE eligible master_place per call, weighted toward geographic
 * (state) and category diversity relative to the last N featured picks, and
 * never repeats a place that has already been featured (featured_at IS NOT NULL).
 *
 * Modes:
 *   (default)   print the selected candidate as JSON
 *   --count     print eligibility statistics only (no selection, no writes)
 *   --commit    stamp featured_at = now() on the selected place via the
 *               set_master_place_featured_at() RPC (the ONLY write this does)
 *   --recent N  how many recent picks drive diversity weighting (default 8)
 *   --json      machine-readable output only (no human summary)
 *
 * Run:  npm run -w data potw:select -- --count
 *       npm run -w data potw:select
 *       npm run -w data potw:select -- --commit
 */

import { getDb } from "../ingestion/lib/db.ts";
import {
  assertTestProject,
  fetchEvaluatedCandidates,
  VERIFICATION_NOTE,
  type EvaluatedCandidate,
} from "./eligibility.ts";

const DIVERSITY_STATE_BONUS = 100;
const DIVERSITY_CATEGORY_BONUS = 50;

interface RecentPick {
  id: string;
  state: string | null;
  primary_category: string;
  featured_at: string;
}

interface Args {
  count: boolean;
  commit: boolean;
  json: boolean;
  recent: number;
}

function parseArgs(argv: string[]): Args {
  const recentIdx = argv.indexOf("--recent");
  const recent = recentIdx >= 0 ? Number(argv[recentIdx + 1]) : 8;
  if (!Number.isFinite(recent) || recent < 0) throw new Error("--recent must be a non-negative number");
  return {
    count: argv.includes("--count"),
    commit: argv.includes("--commit"),
    json: argv.includes("--json"),
    recent,
  };
}

/** Fetch the last N featured picks. Tolerates the featured_at column not existing yet. */
async function fetchRecentPicks(
  db: ReturnType<typeof getDb>,
  n: number,
): Promise<{ picks: RecentPick[]; featuredIds: Set<string>; columnMissing: boolean }> {
  // All featured ids (for the never-repeat guard) — id only, cheap.
  const all = await db.from("master_place").select("id").not("featured_at", "is", null);
  if (all.error) {
    // 42703 = undefined_column: featured_at migration not applied yet.
    if (all.error.code === "42703") {
      return { picks: [], featuredIds: new Set(), columnMissing: true };
    }
    throw new Error(`featured-id query failed: ${JSON.stringify(all)}`);
  }
  const featuredIds = new Set((all.data ?? []).map((r) => (r as { id: string }).id));

  if (n === 0) return { picks: [], featuredIds, columnMissing: false };
  const recent = await db
    .from("master_place")
    .select("id,state,primary_category,featured_at")
    .not("featured_at", "is", null)
    .order("featured_at", { ascending: false })
    .limit(n);
  if (recent.error) throw new Error(`recent-picks query failed: ${JSON.stringify(recent)}`);
  return { picks: (recent.data ?? []) as RecentPick[], featuredIds, columnMissing: false };
}

interface Scored {
  candidate: EvaluatedCandidate;
  score: number;
  freshState: boolean;
  freshCategory: boolean;
}

function scoreCandidates(
  eligible: EvaluatedCandidate[],
  recent: RecentPick[],
): Scored[] {
  const recentStates = new Set(recent.map((p) => p.state).filter((s): s is string => s != null));
  const recentCategories = new Set(recent.map((p) => p.primary_category));
  return eligible
    .map((candidate) => {
      const freshState = candidate.state != null && !recentStates.has(candidate.state);
      const freshCategory = !recentCategories.has(candidate.primary_category);
      const score =
        candidate.prominence_score +
        (freshState ? DIVERSITY_STATE_BONUS : 0) +
        (freshCategory ? DIVERSITY_CATEGORY_BONUS : 0);
      return { candidate, score, freshState, freshCategory };
    })
    // Highest score first; deterministic tie-break by id so a call is reproducible.
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
}

function tally<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertTestProject();
  const db = getDb();

  const { picks, featuredIds, columnMissing } = await fetchRecentPicks(db, args.recent);
  const evaluated = await fetchEvaluatedCandidates(db);
  const eligibleAll = evaluated.filter((c) => c.eligible);
  const eligible = eligibleAll.filter((c) => !featuredIds.has(c.id));

  if (args.count) {
    const rejectionTally = tally(
      evaluated.filter((c) => !c.eligible).flatMap((c) => c.rejections),
      (r) => r,
    );
    const report = {
      project: process.env.SUPABASE_URL?.match(/\/\/([^.]+)\./)?.[1],
      featured_at_column_present: !columnMissing,
      totals: {
        master_place_rows: evaluated.length,
        eligible_before_featured_exclusion: eligibleAll.length,
        already_featured: featuredIds.size,
        eligible_now: eligible.length,
        with_numeric_rating: evaluated.filter((c) => c.signals.hasNumericRating).length,
      },
      rejection_reasons: rejectionTally,
      eligible_by_state: tally(eligible, (c) => c.state ?? "(null)"),
      eligible_by_category: tally(eligible, (c) => c.primary_category),
      verification_note: VERIFICATION_NOTE,
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (eligible.length === 0) {
    throw new Error(
      "No eligible Pin of the Week candidates. Run with --count to see why " +
        "(and whether the featured_at column / featured history is the cause).",
    );
  }

  const scored = scoreCandidates(eligible, picks);
  const winner = scored[0];
  const c = winner.candidate;

  const selection = {
    id: c.id,
    canonical_name: c.canonical_name,
    primary_category: c.primary_category,
    state: c.state,
    photo_url: c.photo_url,
    description: c.description,
    prominence_score: c.prominence_score,
    source_count: c.source_count,
    official_sources: c.signals.officialSources,
    selection: {
      score: winner.score,
      fresh_state_vs_recent: winner.freshState,
      fresh_category_vs_recent: winner.freshCategory,
      recent_picks_considered: picks.length,
      eligible_pool_size: eligible.length,
    },
  };

  if (args.commit) {
    if (columnMissing) throw new Error("--commit requires the featured_at column; apply the migration first.");
    const { error } = await db.rpc("set_master_place_featured_at", { p_master_place_id: c.id });
    if (error) throw new Error(`set_master_place_featured_at failed: ${JSON.stringify(error)}`);
  }

  if (args.json) {
    console.log(JSON.stringify({ ...selection, committed: args.commit }, null, 2));
    return;
  }

  console.log(`\n📌 Pin of the Week candidate${args.commit ? " (marked featured)" : ""}:\n`);
  console.log(`  ${c.canonical_name}  [${c.primary_category}${c.state ? ` · ${c.state}` : ""}]`);
  console.log(`  id: ${c.id}`);
  console.log(`  prominence: ${c.prominence_score}  official: ${c.signals.officialSources.join(", ") || "none"}`);
  console.log(`  diversity: fresh_state=${winner.freshState} fresh_category=${winner.freshCategory}`);
  console.log(`  photo: ${c.photo_url}`);
  console.log(`\n${JSON.stringify(selection, null, 2)}`);
  if (!args.commit) console.log(`\n(dry run — pass --commit to stamp featured_at)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
