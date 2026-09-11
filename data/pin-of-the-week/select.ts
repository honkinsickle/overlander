/**
 * Pin of the Week — SELECT stage (TEST-only).
 *
 * Returns ONE eligible master_place per call. By default it uses the ranked
 * selector (weighted toward geographic/category diversity vs the last N featured
 * picks, never repeating an already-featured place). It can also select a place
 * MANUALLY by id or name — manual picks go through the exact same eligibility
 * checks and can be committed the same way.
 *
 * Modes:
 *   (default)         ranked algorithmic pick
 *   --place-id <uuid> manual: select this exact place
 *   --search "<name>" manual: look up by name (case-insensitive substring).
 *                     One match → selects it; several → lists them to pick from.
 *   --count           print eligibility statistics only (no selection, no writes)
 *
 * Flags:
 *   --commit    stamp featured_at = now() on the selected place via the
 *               set_master_place_featured_at() RPC (the ONLY write this does)
 *   --recent N  how many recent picks drive diversity weighting (default 8)
 *   --json      machine-readable output only (no human summary)
 *
 * A manually-chosen place that fails eligibility (no photo / templated or missing
 * description / unpublishable) is REPORTED and the command exits non-zero — it
 * never silently proceeds.
 *
 * Run:  npm run -w data potw:select
 *       npm run -w data potw:select -- --place-id <uuid> [--commit] [--json]
 *       npm run -w data potw:select -- --search "gold bluffs"
 *       npm run -w data potw:select -- --count
 */

import { getDb } from "../ingestion/lib/db.ts";
import {
  assertTestProject,
  fetchEvaluatedById,
  fetchEvaluatedCandidates,
  searchEvaluatedByName,
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
  placeId: string | null;
  search: string | null;
}

function parseArgs(argv: string[]): Args {
  const recentIdx = argv.indexOf("--recent");
  const recent = recentIdx >= 0 ? Number(argv[recentIdx + 1]) : 8;
  if (!Number.isFinite(recent) || recent < 0) throw new Error("--recent must be a non-negative number");
  const placeIdIdx = argv.indexOf("--place-id");
  const searchIdx = argv.indexOf("--search");
  const placeId = placeIdIdx >= 0 ? argv[placeIdIdx + 1] ?? null : null;
  const search = searchIdx >= 0 ? argv[searchIdx + 1] ?? null : null;
  if (placeIdIdx >= 0 && !placeId) throw new Error("--place-id requires a uuid");
  if (searchIdx >= 0 && !search) throw new Error('--search requires a name, e.g. --search "gold bluffs"');
  if (placeId && search) throw new Error("use only one of --place-id / --search");
  return {
    count: argv.includes("--count"),
    commit: argv.includes("--commit"),
    json: argv.includes("--json"),
    recent,
    placeId,
    search,
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

function freshnessVsRecent(
  c: EvaluatedCandidate,
  recent: RecentPick[],
): { freshState: boolean; freshCategory: boolean } {
  const recentStates = new Set(recent.map((p) => p.state).filter((s): s is string => s != null));
  const recentCategories = new Set(recent.map((p) => p.primary_category));
  return {
    freshState: c.state != null && !recentStates.has(c.state),
    freshCategory: !recentCategories.has(c.primary_category),
  };
}

function scoreCandidates(eligible: EvaluatedCandidate[], recent: RecentPick[]): Scored[] {
  return eligible
    .map((candidate) => {
      const { freshState, freshCategory } = freshnessVsRecent(candidate, recent);
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

function baseFields(c: EvaluatedCandidate): Record<string, unknown> {
  return {
    id: c.id,
    canonical_name: c.canonical_name,
    primary_category: c.primary_category,
    state: c.state,
    photo_url: c.photo_url,
    description: c.description,
    prominence_score: c.prominence_score,
    source_count: c.source_count,
    official_sources: c.signals.officialSources,
  };
}

/** Stamp featured_at via the RPC, if --commit. Shared by ranked + manual paths. */
async function commitIfRequested(
  db: ReturnType<typeof getDb>,
  c: EvaluatedCandidate,
  args: Args,
  columnMissing: boolean,
): Promise<void> {
  if (!args.commit) return;
  if (columnMissing) throw new Error("--commit requires the featured_at column; apply the migration first.");
  const { error } = await db.rpc("set_master_place_featured_at", { p_master_place_id: c.id });
  if (error) throw new Error(`set_master_place_featured_at failed: ${JSON.stringify(error)}`);
}

/** Print a selected candidate (json or human). Shared by ranked + manual paths. */
function emit(
  c: EvaluatedCandidate,
  selection: Record<string, unknown>,
  freshState: boolean,
  freshCategory: boolean,
  args: Args,
  manual: boolean,
): void {
  if (args.json) {
    console.log(JSON.stringify({ ...selection, committed: args.commit }, null, 2));
    return;
  }
  const tag = manual
    ? ` (manual${args.commit ? ", marked featured" : ""})`
    : args.commit
      ? " (marked featured)"
      : "";
  console.log(`\n📌 Pin of the Week candidate${tag}:\n`);
  console.log(`  ${c.canonical_name}  [${c.primary_category}${c.state ? ` · ${c.state}` : ""}]`);
  console.log(`  id: ${c.id}`);
  console.log(`  prominence: ${c.prominence_score}  official: ${c.signals.officialSources.join(", ") || "none"}`);
  console.log(`  diversity: fresh_state=${freshState} fresh_category=${freshCategory}`);
  console.log(`  photo: ${c.photo_url}`);
  console.log(`\n${JSON.stringify(selection, null, 2)}`);
  if (!args.commit) console.log(`\n(dry run — pass --commit to stamp featured_at)`);
}

/** Manual selection by --place-id / --search. Returns true if it handled output. */
async function runManual(
  db: ReturnType<typeof getDb>,
  args: Args,
  picks: RecentPick[],
  featuredIds: Set<string>,
  columnMissing: boolean,
): Promise<void> {
  let candidate: EvaluatedCandidate | null;

  if (args.placeId) {
    candidate = await fetchEvaluatedById(db, args.placeId);
    if (!candidate) throw new Error(`no master_place with id ${args.placeId}`);
  } else {
    const matches = await searchEvaluatedByName(db, args.search as string);
    if (matches.length === 0) throw new Error(`no master_place matches "${args.search}"`);
    if (matches.length > 1) {
      console.log(`\nMultiple matches for "${args.search}" — re-run with --place-id <uuid>:\n`);
      for (const m of matches) {
        const status = m.eligible ? "eligible" : `INELIGIBLE (${m.rejections.join("; ")})`;
        console.log(`  ${m.id}  ${m.canonical_name}  [${m.primary_category}${m.state ? ` · ${m.state}` : ""}]  — ${status}`);
      }
      console.log("");
      return;
    }
    candidate = matches[0];
  }

  // Same eligibility gate as everywhere else — never silently proceed.
  if (!candidate.eligible) {
    console.error(`\n❌ ${candidate.canonical_name} (${candidate.id}) is NOT eligible for Pin of the Week:`);
    for (const r of candidate.rejections) console.error(`   - ${r}`);
    console.error("");
    process.exit(1);
  }

  const { freshState, freshCategory } = freshnessVsRecent(candidate, picks);
  const selection = {
    ...baseFields(candidate),
    selection: {
      source: "manual",
      fresh_state_vs_recent: freshState,
      fresh_category_vs_recent: freshCategory,
      recent_picks_considered: picks.length,
      already_featured: featuredIds.has(candidate.id),
    },
  };

  await commitIfRequested(db, candidate, args, columnMissing);
  emit(candidate, selection, freshState, freshCategory, args, true);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertTestProject();
  const db = getDb();

  const { picks, featuredIds, columnMissing } = await fetchRecentPicks(db, args.recent);

  // Manual selection — targeted fetch, no full-corpus scan.
  if (args.placeId || args.search) {
    await runManual(db, args, picks, featuredIds, columnMissing);
    return;
  }

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
    ...baseFields(c),
    selection: {
      score: winner.score,
      fresh_state_vs_recent: winner.freshState,
      fresh_category_vs_recent: winner.freshCategory,
      recent_picks_considered: picks.length,
      eligible_pool_size: eligible.length,
    },
  };

  await commitIfRequested(db, c, args, columnMissing);
  emit(c, selection, winner.freshState, winner.freshCategory, args, false);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
