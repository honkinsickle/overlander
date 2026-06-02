/**
 * Entity resolution matcher for Phase 3a.
 *
 * Reads source_records from the database and decides what each one should
 * become in the master_place table. Outcomes are intentionally deferred —
 * applyMatches() in promote.ts is the only thing that mutates the
 * database. Matcher decides; promote applies.
 *
 * ──────────────────────────────────────────────────────────────────────
 * Algorithm (see also data/entity-resolution/README.md for the
 * smoke-test findings that drove these constants and thresholds):
 *
 *   matchOne(source_record) →
 *     1. If source is NPS or RIDB, check for a federal-exact anchor
 *        within 10m. If found, auto_link with confidence=1.0,
 *        method='fed_exact'.
 *     2. If source is an AMENITY_TYPE (dump_station, toilet, water,
 *        fire_pit, picnic_area, shower, charging_station), look for a
 *        parent (campground/recreation_area/facility/lodging) within
 *        100m. If found, amenity_rollup.
 *     3. Otherwise, fetch up to 10 master_place candidates within
 *        200m. Score each on `0.4 × distance + 0.4 × name + 0.2 ×
 *        category`. Auto-link at confidence ≥ 0.85, manual_review at
 *        0.6 ≤ conf < 0.85, otherwise new_master_place.
 *
 *   matchAll processes records in order so parents exist as candidates
 *   when their children (amenities, lower-priority matches) are
 *   processed. Outcomes that create new master_places get tracked
 *   in-memory so later matchOne calls within the same matchAll
 *   invocation see them — this is necessary because applyMatches
 *   runs only after matchAll returns, not interleaved with it.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Spec corollary: per phase-3a-build-spec.md §5, this file stays
 * monolithic for Phase 3a (~600 lines budget). Premature modularization
 * gets in the way of reading the algorithm end-to-end.
 */

import natural from "natural";
import { randomUUID } from "node:crypto";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { normalizeName as baseNormalizeName } from "../ingestion/lib/normalize.ts";
import { computeCorpusFingerprint, type CorpusFingerprint } from "./outcome-cache.ts";
import { clearProgress, loadProgress, saveProgress } from "./progress-cache.ts";
import {
  finalizeProfiler,
  finishSample,
  initProfiler,
  recordPlannedTiming,
  recordRpc,
  recordScoring,
  recordSearchPlanned,
  recordTrack,
  startSample,
  type RpcVariant,
} from "./profiler.ts";

const DEFAULT_CHECKPOINT_INTERVAL = 500;

function checkpointInterval(): number {
  const env = process.env.MATCHALL_CHECKPOINT_INTERVAL;
  if (!env) return DEFAULT_CHECKPOINT_INTERVAL;
  const n = Number.parseInt(env, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHECKPOINT_INTERVAL;
}

// ─── Constants ────────────────────────────────────────────────────────

/**
 * Amenity-type categories that should roll up into a parent place
 * (campground / recreation_area / facility / lodging) instead of
 * becoming sibling master_places.
 *
 * Source: data/entity-resolution/README.md "ER Finding: OSM amenity
 * nodes are sub-features, not siblings." The JT smoke test found
 * ~53% of OSM JT rows (62/116) were these amenity-type sub-features,
 * mostly inside named campgrounds.
 */
export const AMENITY_TYPES = [
  "dump_station",
  "toilet",
  "water",
  "fire_pit",
  "picnic_area",
  "shower",
  "charging_station",
] as const;

/**
 * Categories that can absorb an amenity rollup. The amenity's data
 * (its location, name, normalized payload) becomes information about
 * the parent master_place, not a sibling.
 */
export const AMENITY_PARENT_CATEGORIES = [
  "campground",
  "recreation_area",
  "facility",
  "lodging",
] as const;

/**
 * Category compatibility scores. Lookup is symmetric — A↔B has the
 * same score as B↔A; `lookupCompatibility` handles the symmetry.
 * Missing entries default to 0.
 *
 * Rationale per JT 3-way + 4-way overlap findings (see README):
 *
 *   campground ↔ lodging = 1.0
 *     "ER Finding: Google lodging taxonomy includes campground" —
 *     requesting includedPrimaryTypes=['lodging',...] returned 5 results
 *     with primaryType='campground'. Google's taxonomy treats them as
 *     parent/child within the same hierarchy.
 *
 *   campground ↔ facility = 1.0
 *     RIDB labels some campgrounds as FacilityTypeDescription="Facility"
 *     (e.g., Belle, White Tank, Hidden Valley). Same place, different
 *     label.
 *
 *   campground ↔ recreation_area = 0.7
 *     RIDB recareas often *contain* campgrounds (Joshua Tree NP recarea
 *     contains its campgrounds) but the recarea is the umbrella, not the
 *     specific bookable unit. Often resolved together; not always.
 *
 *   campground ↔ park_feature = 0.3
 *     NPS park_feature includes interpretive sites that are sometimes
 *     in a campground (e.g., "Ecology (Hidden Valley)") but mostly
 *     are sibling places. Weak signal.
 *
 *   campground ↔ peak = 0.0
 *     "ER Finding: peak ↔ campground must be category-incompatible" —
 *     the Hidden Valley/Chimney Rock case. A peak ~78m from a
 *     campground is NOT the same place. Hard zero prevents
 *     wrong-neighbor merges.
 *
 *   gas_station ↔ fuel = 1.0
 *     Google's gas_station == OSM's amenity=fuel. Same place,
 *     different source taxonomies.
 */
export const CATEGORY_COMPATIBILITY: Record<string, Record<string, number>> = {
  campground: {
    campground: 1.0,
    lodging: 1.0,
    facility: 1.0,
    recreation_area: 0.7,
    park_feature: 0.3,
    peak: 0.0,
  },
  lodging: {
    campground: 1.0,
    lodging: 1.0,
    facility: 0.8,
  },
  facility: {
    campground: 1.0,
    facility: 1.0,
    recreation_area: 0.8,
  },
  recreation_area: {
    recreation_area: 1.0,
    campground: 0.7,
    facility: 0.8,
    park_feature: 0.5,
  },
  gas_station: { gas_station: 1.0, fuel: 1.0 },
  fuel: { fuel: 1.0, gas_station: 1.0 },
  trailhead: { trailhead: 1.0 },
  viewpoint: { viewpoint: 1.0 },
  peak: { peak: 1.0 },
  spring: { spring: 1.0, water: 0.5 },
  // Extend as new categories emerge from corridor expansion.
};

/**
 * Trailing tokens stripped from names before Jaro-Winkler comparison.
 * Rationale: RIDB's "Sheep Pass Group" and Google's "Sheep Pass
 * Campground" describe the same place but the trailing category-noise
 * tanks raw name similarity. Stripping yields "sheep pass" on both
 * sides → similarity 1.0.
 */
const NAME_SUFFIXES_TO_STRIP = [
  "campground",
  "cg",
  "group",
  "rv park",
  "recreation area",
  "park",
  "picnic area",
];

// ─── Types ────────────────────────────────────────────────────────────

export interface SourceRecordRow {
  id: string;
  source_id: string;
  external_id: string;
  name: string;
  inferred_category: string | null;
  master_place_id: string | null;
  geometry: { type: "Point"; coordinates: [number, number] } | string;
}

export interface MasterPlaceCandidate {
  id: string;
  canonical_name: string;
  primary_category: string;
  distance_m: number;
}

export interface MatchScore {
  distance_meters: number;
  name_similarity: number;
  category_compatibility: number;
  combined_confidence: number;
}

/**
 * The decision matcher emits per source_record. promote.ts consumes
 * this and applies the database mutations.
 *
 * The `target` field on `new_master_place` is a pre-allocated UUID
 * (randomUUID) — matcher generates it client-side so later iterations
 * within the same matchAll() can reference it as a candidate.
 */
export type MatchOutcome =
  | { kind: "amenity_rollup"; source_record_id: string; target: string }
  | {
      kind: "auto_link";
      source_record_id: string;
      target: string;
      confidence: number;
      method: "deterministic" | "fed_exact" | "name_dominant";
      score: MatchScore | null;
    }
  | {
      kind: "manual_review";
      source_record_id: string;
      target: string;
      confidence: number;
      score: MatchScore;
      /**
       * Which rule routed this to manual review:
       *   close_nameless    — Mode C (high-cat + low-name + close distance)
       *   blended_residual  — fallback (0.6 ≤ blended conf < 0.85)
       * Stored as place_match.match_method so the 3b audit CLI can group
       * pending rows by why-they're-pending without re-running the matcher.
       */
      method: "close_nameless" | "blended_residual";
    }
  | {
      kind: "new_master_place";
      source_record_id: string;
      target: string;
      seed_category: string;
      seed_geometry: [number, number];
      seed_name: string;
    };

// ─── Helpers ──────────────────────────────────────────────────────────

const jaroWinkler = natural.JaroWinklerDistance;

/**
 * Strip trailing category noise and lowercase for similarity comparison.
 * Wraps the base normalizeName (lowercase + collapse whitespace +
 * trim punctuation) with category-suffix removal.
 */
export function normalizeName(name: string): string {
  let cleaned = baseNormalizeName(name);
  // Strip suffixes one at a time, repeating because some names have
  // multiple stackable suffixes ("Sheep Pass Group Campground" →
  // "sheep pass group" → "sheep pass").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of NAME_SUFFIXES_TO_STRIP) {
      const needle = " " + suffix;
      if (cleaned.endsWith(needle)) {
        cleaned = cleaned.slice(0, -needle.length);
        changed = true;
      }
    }
  }
  return cleaned.trim();
}

/**
 * Symmetric category-compatibility lookup. Tries A→B first, then
 * B→A; returns 0 if neither direction is mapped (the safe default —
 * unknown pair is treated as incompatible).
 */
export function lookupCompatibility(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  return CATEGORY_COMPATIBILITY[a]?.[b] ?? CATEGORY_COMPATIBILITY[b]?.[a] ?? 0;
}

/**
 * Haversine distance in meters between two [lng, lat] points.
 * Used only for the in-memory planned-master_place lookup; DB-side
 * candidate retrieval uses PostGIS ST_Distance via the RPC.
 */
export function haversineMeters(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
}

function parsePoint(geom: SourceRecordRow["geometry"]): [number, number] | null {
  if (typeof geom === "object" && geom !== null && "coordinates" in geom) {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length >= 2) return [c[0]!, c[1]!];
  }
  if (typeof geom === "string") {
    try {
      const g = JSON.parse(geom) as { coordinates?: [number, number] };
      if (g.coordinates) return g.coordinates;
    } catch {
      return null;
    }
  }
  return null;
}

// ─── In-memory planning ───────────────────────────────────────────────
//
// matchAll generates outcomes from current DB state. If matchOne returns
// new_master_place during matchAll, applyMatches won't run until matchAll
// finishes — so naively, subsequent matchOne calls couldn't find that
// new master_place as a candidate. We bridge the gap by recording planned
// master_places in module-scoped state and merging them with DB candidates
// inside findCandidates.
//
// State is reset at the start of every matchAll() call. matchOne can be
// called solo too, but loses the cross-record awareness.

interface PlannedMasterPlace {
  id: string;
  source_id: string;
  source_record_id: string;
  canonical_name: string;
  primary_category: string;
  geometry: [number, number];
}

let plannedMasterPlaces: PlannedMasterPlace[] = [];

/**
 * Tracks which source_ids have already been linked to a given master_place
 * during the current matchAll() invocation. Used by the same-source guard
 * (see name_dominant + close_nameless rules). Includes both planned MPs
 * (seeded via new_master_place) and any DB-existing MPs that received an
 * auto_link or amenity_rollup outcome earlier in this matchAll.
 *
 * Keys: master_place_id (string). Values: Set of source_id strings linked
 * via this matchAll's outcomes so far. manual_review outcomes do NOT add
 * to this map — those records remain unlinked.
 */
let plannedLinks: Map<string, Set<string>> = new Map();

/**
 * Pre-fetched DB-side source_record → master_place_id linkage. Populated
 * once at the start of matchAll via initMatchAllCaches() with a single
 * bulk query. masterPlaceHasSource consults this + plannedLinks instead
 * of doing per-candidate DB lookups (was N+1; now O(1) post-fetch).
 *
 * Keys: master_place_id. Values: Set of source_ids already linked in DB.
 */
let dbLinks: Map<string, Set<string>> = new Map();

/**
 * Per-matchAll source_record cache. Populated up-front from matchAll's
 * record fetch, used by fetchSourceRecord to short-circuit. Previously
 * each matchOne could call fetchSourceRecord ~4 times (top of matchOne,
 * + 3 findCandidates invocations); now all but the first are cache hits.
 */
let sourceRecordCache: Map<string, SourceRecordRow> = new Map();

/**
 * Rematerialize-mode flag: when master_place is empty at matchAll start,
 * every findCandidates RPC variant is guaranteed to return 0 rows (the
 * spatial join has nothing to join against). Skipping the RPC entirely
 * eliminates the dominant cost — the 2026-05-29 baseline profile measured
 * RPC roundtrip = 95.6% of matchOne time, with every sampled call
 * returning 0 db_count across all three variants.
 *
 * Set once in matchAll() based on a single COUNT(master_place) query;
 * read in findCandidates(). Reset to false in resetPlanning() so a
 * subsequent matchAll() invocation re-evaluates against current state.
 *
 * Correctness: searchPlanned() continues to work against
 * plannedMasterPlaces as matchAll populates it, so cross-record matches
 * still happen (fed_exact via planned, amenity_rollup via planned,
 * standard via planned). The DB-side candidate channel is a dead channel
 * during rematerialize — this just removes the round-trip overhead of
 * confirming that.
 */
let skipRpcs = false;

function resetPlanning(): void {
  plannedMasterPlaces = [];
  plannedLinks = new Map();
  dbLinks = new Map();
  sourceRecordCache = new Map();
  skipRpcs = false;
}

function trackOutcomeLink(sourceId: string, outcome: MatchOutcome): void {
  const t = performance.now();
  if (outcome.kind === "manual_review") {
    recordTrack(performance.now() - t);
    return;
  }
  const set = plannedLinks.get(outcome.target) ?? new Set<string>();
  set.add(sourceId);
  plannedLinks.set(outcome.target, set);
  recordTrack(performance.now() - t);
}

/**
 * Page-by-page accumulator into a master_place_id → Set<source_id> map.
 *
 * Exported for testability — callers in production wrap the DB call;
 * tests inject a synthetic `fetchPage` to verify the pagination loop
 * terminates correctly across the PostgREST 1000-row default cap.
 *
 * Termination: loops until `fetchPage` returns fewer than PAGE rows.
 * Assumes the underlying query is stable across page reads (which it
 * is during matchAll — the source_record table isn't being mutated
 * concurrently).
 */
const LINK_PAGE_SIZE = 1000;

export async function paginateLinkedSourceRecords(
  fetchPage: (
    offset: number,
    limit: number,
  ) => Promise<Array<{ master_place_id: string | null; source_id: string }>>,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  let offset = 0;
  while (true) {
    const batch = await fetchPage(offset, LINK_PAGE_SIZE);
    for (const row of batch) {
      if (!row.master_place_id) continue;
      const existing = out.get(row.master_place_id) ?? new Set<string>();
      existing.add(row.source_id);
      out.set(row.master_place_id, existing);
    }
    if (batch.length < LINK_PAGE_SIZE) break;
    offset += LINK_PAGE_SIZE;
  }
  return out;
}

/**
 * URL-budget-safe chunk size for `.in("id", [...])` fetches. ~200 UUIDs keeps
 * the request URL well under PostgREST's length cap. A single unbatched `.in()`
 * over a large delta (~3K ids) overruns that cap and returns 400 Bad Request —
 * the large-delta materialize blocker this batching resolves (see
 * `fetchUnresolvedByIds` and `pipeline/materialize.ts`).
 */
export const ID_FETCH_CHUNK = 200;

/**
 * Code-unit (UTF-16) string comparison, replacing the server-side
 * `ORDER BY external_id ASC` once the fetch is split across chunks.
 *
 * Code-unit compare is correct for ASCII external_ids and matches Postgres's
 * byte-order (C collation) exactly. All current sources build external_id as
 * `<source>:<type>:<id>` from ASCII codes/numeric ids (never free-text names),
 * so the inputs are ASCII by construction. Deliberately NOT `localeCompare` —
 * that is locale-aware (case/punctuation folding) and would diverge here.
 *
 * Caveat: the `external_id` column has no explicit `COLLATE`, so it inherits
 * the database's default collation (libc `en_US.UTF-8` on Supabase, not `C`).
 * Under a libc/ICU collation the server-side order can differ from code-unit
 * order for ASCII strings in punctuation/case edge cases. This does NOT
 * threaten determinism (the in-app sort is deterministic), and `external_id`
 * is only the last-resort tiebreaker after `source_quality_score DESC` — it
 * ranks same-quality (typically same-source) records. If a future source
 * introduces non-ASCII external_ids, or exact parity with the DB tiebreak
 * order ever matters, this ordering must be reconciled with the column's
 * collation.
 */
function compareExternalId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Row shape for the ID-list fetch — SourceRecordRow plus the quality score
 *  needed for in-app ordering (server-side ORDER BY is lost once the fetch is
 *  split across chunks). The extra field is harmless to downstream consumers
 *  that treat the result as SourceRecordRow. */
type UnresolvedRow = SourceRecordRow & { source_quality_score: number };

/**
 * Fetch still-unresolved (`master_place_id IS NULL`) source_records by id,
 * chunking the `.in("id", …)` filter into `ID_FETCH_CHUNK`-sized batches so the
 * request URL never exceeds PostgREST's length cap. This is the ID-list
 * (incremental / large-delta) path of matchAll; the full-corpus path keeps its
 * server-side, range-paginated ORDER BY untouched.
 *
 * Because each chunk is an independent query, the per-chunk DB order cannot
 * carry the global order matchAll relies on. The concatenated rows are
 * re-sorted in-app by `(source_quality_score DESC, external_id ASC)` —
 * reproducing exactly the single-query `ORDER BY` so seed-source assignment and
 * amenity-rollup distances stay byte-identical to the unbatched path. The
 * subsequent tier/fedRank sort in matchAll is stable and preserves this order
 * within each bucket.
 *
 * `fetchChunk` is injectable for unit tests; production uses the default
 * Supabase-backed fetch (which applies the `master_place_id IS NULL` filter per
 * chunk). Returns `[]` without any fetch for an empty id list.
 */
export async function fetchUnresolvedByIds(
  ids: string[],
  fetchChunk: (idChunk: string[]) => Promise<UnresolvedRow[]> = defaultFetchUnresolvedChunk,
): Promise<SourceRecordRow[]> {
  if (ids.length === 0) return [];
  const rows: UnresolvedRow[] = [];
  for (let i = 0; i < ids.length; i += ID_FETCH_CHUNK) {
    const chunk = ids.slice(i, i + ID_FETCH_CHUNK);
    rows.push(...(await fetchChunk(chunk)));
  }
  rows.sort(
    (a, b) =>
      b.source_quality_score - a.source_quality_score ||
      compareExternalId(a.external_id, b.external_id),
  );
  return rows;
}

async function defaultFetchUnresolvedChunk(idChunk: string[]): Promise<UnresolvedRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from("source_record")
    .select(
      "id, source_id, external_id, name, inferred_category, master_place_id, geometry, source_quality_score",
    )
    .in("id", idChunk)
    .is("master_place_id", null);
  if (error) throw error;
  return (data ?? []) as UnresolvedRow[];
}

/**
 * Bulk-load DB linkage state at the start of matchAll. After this, every
 * masterPlaceHasSource call is purely in-memory.
 *
 * Idempotent: callable multiple times; later calls overwrite the map.
 * Reset alongside other planning state in resetPlanning.
 *
 * Pagination: PostgREST's default 1000-row cap silently truncated the
 * previous unpaginated form. The fix exposes the inner pagination via
 * the testable `paginateLinkedSourceRecords` helper above. `.order("id")`
 * is defensive even though the table is static during matchAll.
 */
async function initMatchAllCaches(records: SourceRecordRow[]): Promise<void> {
  // 1) source_record cache from matchAll's already-fetched records.
  for (const r of records) sourceRecordCache.set(r.id, r);

  // 2) DB-side linkage cache via a paginated bulk query.
  const db = getDb();
  dbLinks = await paginateLinkedSourceRecords(async (offset, limit) => {
    const { data, error } = await db
      .from("source_record")
      .select("master_place_id, source_id")
      .not("master_place_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []) as Array<{ master_place_id: string | null; source_id: string }>;
  });
}

function recordPlanned(
  source: SourceRecordRow,
  targetId: string,
  point: [number, number],
): void {
  const t = performance.now();
  plannedMasterPlaces.push({
    id: targetId,
    source_id: source.source_id,
    source_record_id: source.id,
    canonical_name: source.name,
    primary_category: source.inferred_category ?? "unknown",
    geometry: point,
  });
  recordPlannedTiming(performance.now() - t);
}

/**
 * Rebuild in-memory planning state from a checkpoint's outcomes so a
 * resumed matchAll behaves identically to a fresh one.
 *
 * Called after initMatchAllCaches (which populates sourceRecordCache)
 * and before the for-loop resumes. Iterates outcomes in their original
 * order to recreate plannedMasterPlaces (for new_master_place outcomes)
 * and plannedLinks (for every non-manual_review outcome).
 *
 * Throws if a checkpointed outcome references a source_record_id that
 * isn't in the current corpus — the fingerprint check should prevent
 * this, so reaching this throw indicates corruption or an unexpected
 * corpus mutation.
 */
function replayPlannedState(outcomes: MatchOutcome[]): void {
  for (const o of outcomes) {
    const src = sourceRecordCache.get(o.source_record_id);
    if (!src) {
      throw new Error(
        `progress replay: source_record ${o.source_record_id} not in current corpus`,
      );
    }
    if (o.kind === "new_master_place") {
      recordPlanned(src, o.target, o.seed_geometry);
    }
    if (o.kind !== "manual_review") {
      trackOutcomeLink(src.source_id, o);
    }
  }
}

function searchPlanned(
  sourcePoint: [number, number],
  radiusM: number,
  categoryFilter?: readonly string[],
): MasterPlaceCandidate[] {
  return plannedMasterPlaces
    .filter((p) => !categoryFilter || categoryFilter.includes(p.primary_category))
    .map((p) => ({
      id: p.id,
      canonical_name: p.canonical_name,
      primary_category: p.primary_category,
      distance_m: haversineMeters(sourcePoint, p.geometry),
    }))
    .filter((c) => c.distance_m <= radiusM);
}

// ─── Core functions ───────────────────────────────────────────────────

async function fetchSourceRecord(id: string): Promise<SourceRecordRow> {
  const cached = sourceRecordCache.get(id);
  if (cached) return cached;
  const db = getDb();
  const { data, error } = await db
    .from("source_record")
    .select("id, source_id, external_id, name, inferred_category, master_place_id, geometry")
    .eq("id", id)
    .single();
  if (error) throw error;
  const row = data as SourceRecordRow;
  sourceRecordCache.set(id, row);
  return row;
}

/**
 * Same-source guard helper. Returns true if `sourceId` is already linked
 * to the given master_place, either via a planned outcome in the current
 * matchAll (in-memory) or via the pre-fetched DB linkage cache.
 *
 * Synchronous since the perf pass — both lookups are now in-memory. The
 * DB cache (`dbLinks`) is populated once at the start of matchAll by
 * initMatchAllCaches().
 *
 * Used by name_dominant and close_nameless rules to prevent chain-business
 * false merges. Example: if a master_place already has an OSM record
 * (Shell gas station #1), an incoming OSM record for Shell gas station #2
 * within 500m with identical name + category should NOT auto-link to the
 * first — it's a different physical store. The same-source guard forces
 * the second record to fall through to blended scoring (and, for distant
 * separate stations, to a new master_place).
 */
function masterPlaceHasSource(masterPlaceId: string, sourceId: string): boolean {
  if (plannedLinks.get(masterPlaceId)?.has(sourceId)) return true;
  if (dbLinks.get(masterPlaceId)?.has(sourceId)) return true;
  return false;
}

/**
 * Find master_places within `radiusM` of the source_record's geometry.
 * Includes both DB-persisted master_places (via the find_master_place_candidates
 * RPC) and in-memory planned master_places from earlier matchOne calls
 * in this matchAll invocation.
 *
 * Default radius is 500m, widened from spec §5.2's original 200m after
 * the JT campground diagnostic measured cross-source drift up to 347m
 * (Jumbo Rocks NPS↔Google) on pairs that are genuinely the same place.
 * Callers pass tighter radii for specific purposes: 100m for amenity
 * rollup, 10m for federal exact-match.
 */
/**
 * Profiling: infer the RPC variant from the caller's radius. The matcher's
 * three call sites pass distinct radii (10/100/500), so this is unambiguous.
 * If a future call site introduces a fourth radius, it falls through to
 * "standard" — accuracy of the profile, not correctness, would suffer.
 */
function inferRpcVariant(radiusM: number): RpcVariant {
  if (radiusM === 10) return "fed_exact";
  if (radiusM === 100) return "amenity";
  return "standard";
}

export async function findCandidates(
  sourceRecordId: string,
  radiusM = 500,
  categoryFilter?: readonly string[],
): Promise<MasterPlaceCandidate[]> {
  const db = getDb();
  // Rematerialize-mode skip: when master_place is empty, the RPC's spatial
  // join has nothing to join against — every variant returns 0 rows. Bypass
  // the round-trip entirely and let searchPlanned() supply candidates from
  // the in-memory plannedMasterPlaces list that matchAll populates as it
  // progresses. See the `skipRpcs` module-state comment for the rationale.
  let dbCandidates: MasterPlaceCandidate[] = [];
  if (!skipRpcs) {
    const rpcStart = performance.now();
    const { data, error } = await db.rpc("find_master_place_candidates", {
      p_source_record_id: sourceRecordId,
      p_radius_meters: radiusM,
      p_category_filter: categoryFilter ? [...categoryFilter] : null,
    });
    if (error) throw error;
    recordRpc(
      inferRpcVariant(radiusM),
      performance.now() - rpcStart,
      data?.length ?? 0,
    );
    dbCandidates = (data ?? []) as MasterPlaceCandidate[];
  }

  let plannedCandidates: MasterPlaceCandidate[] = [];
  if (plannedMasterPlaces.length > 0) {
    const sr = await fetchSourceRecord(sourceRecordId);
    const point = parsePoint(sr.geometry);
    if (point) {
      const planStart = performance.now();
      plannedCandidates = searchPlanned(point, radiusM, categoryFilter);
      recordSearchPlanned(performance.now() - planStart, plannedCandidates.length);
    }
  }

  return [...dbCandidates, ...plannedCandidates]
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 10);
}

/**
 * Pure scoring function (no I/O). The weighted blend per spec §9.1:
 *
 *   combined_confidence = 0.4 × distance_score
 *                       + 0.4 × name_similarity
 *                       + 0.2 × category_compatibility
 *
 *   distance_score = 1 - min(distance_meters, 100) / 100
 *
 * The 100m clipping deliberately zeroes out the distance contribution
 * beyond 100m — pairs further apart must rely on name + category to
 * cross the 0.85 auto-link threshold. See README "ER Finding: Google
 * coordinate drift varies 8m–216m" for why this cutoff matters: pairs
 * that are genuinely the same place can sit > 100m apart (Sheep Pass
 * NPS↔RIDB at 248m), and the scoring needs to handle them via the
 * other two channels.
 *
 * NB: at 200m+ apart with perfect name + category, combined_confidence
 * lands at exactly 0.6 — the manual_review floor. This is intentional
 * per spec: when distance is genuinely uninformative, the algorithm
 * defers to humans rather than auto-linking. Confirm or refute via
 * the audit CLI in 3b.
 */
export function scoreMatch(
  source: { name: string; inferred_category: string | null },
  candidate: MasterPlaceCandidate,
): MatchScore {
  const distance_meters = candidate.distance_m;

  const name_similarity = jaroWinkler(
    normalizeName(source.name),
    normalizeName(candidate.canonical_name),
  );

  const category_compatibility = lookupCompatibility(
    source.inferred_category,
    candidate.primary_category,
  );

  const distance_score = 1 - Math.min(distance_meters, 100) / 100;
  const combined_confidence =
    0.4 * distance_score + 0.4 * name_similarity + 0.2 * category_compatibility;

  return {
    distance_meters,
    name_similarity,
    category_compatibility,
    combined_confidence,
  };
}

/**
 * Federal exact-match shortcut. Returns the target master_place id if
 * the source is NPS or RIDB AND there's a master_place within 10m
 * already seeded by the *other* federal source.
 *
 * Source: README "ER Finding: NPS↔RIDB share coordinates at ~0m for
 * federally-bookable campgrounds." Recreation.gov is the reservation
 * backend for NPS-managed campgrounds; both sources draw from the same
 * canonical coordinate. When the shortcut hits, confidence is 1.0 — no
 * scoring needed. When it misses (≥10m apart), fall through to
 * standard scoring.
 *
 * NB: per the smoke-test data, this catches Belle, White Tank, and
 * Hidden Valley campgrounds (NPS↔RIDB at 0m). Ryan is at 14m — just
 * outside the 10m window — and falls through. Sheep Pass (248m) and
 * Jumbo Rocks (341m) also fall through. The standard scoring path
 * needs to handle the latter four via name + category.
 */
async function findFederalAnchor(
  source: SourceRecordRow,
): Promise<{ id: string; method: "fed_exact" } | null> {
  if (source.source_id !== "nps" && source.source_id !== "ridb") return null;
  const partner = source.source_id === "nps" ? "ridb" : "nps";
  const point = parsePoint(source.geometry);
  if (!point) return null;

  // Check planned master_places first — these are the ones created earlier
  // in this matchAll invocation but not yet in the DB.
  const plannedHit = plannedMasterPlaces.find(
    (p) => p.source_id === partner && haversineMeters(point, p.geometry) <= 10,
  );
  if (plannedHit) return { id: plannedHit.id, method: "fed_exact" };

  // Find master_places within 10m, then check whether any has a linked
  // source_record from the partner federal source via the in-memory cache
  // (dbLinks + plannedLinks). No per-candidate DB queries — masterPlaceHasSource
  // is sync after the perf pass.
  const candidates = await findCandidates(source.id, 10);
  if (candidates.length === 0) return null;

  for (const c of candidates) {
    if (masterPlaceHasSource(c.id, partner)) {
      return { id: c.id, method: "fed_exact" };
    }
  }
  return null;
}

/**
 * Decide what should happen to a single source_record.
 *
 * Throws if the source_record is already linked to a master_place
 * (caller should re-fetch). Throws if the geometry can't be parsed.
 *
 * For new_master_place outcomes, allocates a UUID client-side via
 * randomUUID() and records it in plannedMasterPlaces so subsequent
 * matchOne calls in the same matchAll can find it. promote.ts uses
 * the allocated UUID when inserting the master_place.
 */
export async function matchOne(sourceRecordId: string): Promise<MatchOutcome> {
  const source = await fetchSourceRecord(sourceRecordId);
  if (source.master_place_id != null) {
    throw new Error(
      `matchOne: source_record ${sourceRecordId} is already linked to master_place ${source.master_place_id}`,
    );
  }
  const point = parsePoint(source.geometry);
  if (!point) {
    throw new Error(`matchOne: source_record ${sourceRecordId} has no parseable geometry`);
  }

  // Step 1: federal exact-match shortcut.
  const anchor = await findFederalAnchor(source);
  if (anchor) {
    logger.debug({ source_record_id: source.id, target: anchor.id }, "matcher: fed_exact hit");
    const outcome: MatchOutcome = {
      kind: "auto_link",
      source_record_id: source.id,
      target: anchor.id,
      confidence: 1.0,
      method: "fed_exact",
      score: null,
    };
    trackOutcomeLink(source.source_id, outcome);
    return outcome;
  }

  // Step 2: amenity rollup. Only applies if this source's category is
  // an amenity-type AND a parent place exists within 100m.
  if (
    source.inferred_category &&
    (AMENITY_TYPES as readonly string[]).includes(source.inferred_category)
  ) {
    const parents = await findCandidates(source.id, 100, AMENITY_PARENT_CATEGORIES);
    if (parents.length > 0) {
      logger.debug(
        { source_record_id: source.id, target: parents[0]!.id, distance_m: parents[0]!.distance_m },
        "matcher: amenity_rollup",
      );
      const outcome: MatchOutcome = {
        kind: "amenity_rollup",
        source_record_id: source.id,
        target: parents[0]!.id,
      };
      trackOutcomeLink(source.source_id, outcome);
      return outcome;
    }
    // If no parent within 100m, fall through. The amenity will most likely
    // become its own master_place — a standalone dump station with no
    // nearby campground is, factually, its own place.
  }

  // Fetch standard candidates (500m radius). Rules 3, 4, and 5 all use
  // this same list — fetched once, evaluated by rule in order.
  const candidates = await findCandidates(source.id);
  if (candidates.length === 0) {
    const newId = randomUUID();
    recordPlanned(source, newId, point);
    const outcome: MatchOutcome = {
      kind: "new_master_place",
      source_record_id: source.id,
      target: newId,
      seed_category: source.inferred_category ?? "unknown",
      seed_geometry: point,
      seed_name: source.name,
    };
    trackOutcomeLink(source.source_id, outcome);
    logger.debug({ source_record_id: source.id, target: newId }, "matcher: new (no candidates)");
    return outcome;
  }

  // Score every candidate once. Distance-ASC ordering preserved from the RPC.
  // Profiler captures the end-to-end "scoring + rule evaluation" window for
  // each return path below.
  const scoringStart = performance.now();
  const scored = candidates.map((c) => ({ c, score: scoreMatch(source, c) }));

  // Step 3: name_dominant auto_link.
  //
  // Diagnostic on the JT campground fixtures (see README "Phase 3a
  // diagnostic: cross-source distance modes A/B") found that named
  // cross-source pairs drift up to 347m apart with identical
  // post-suffix-strip names and matching categories — too far for the
  // blended scoring (which caps distance contribution at 100m) to
  // auto-link. Mode A (60–100m): conf ~0.65. Mode B (200–350m): conf ~0.6.
  //
  // The name+category signal is high-confidence on its own when the
  // name normalizes to identity and the categories are taxonomically
  // compatible. The same-source guard (see masterPlaceHasSource) blocks
  // chain-business false merges where two distinct OSM Shell gas
  // stations within 500m would otherwise auto-link to each other.
  for (const { c, score } of scored) {
    if (score.distance_meters > 500) continue;
    if (score.name_similarity < 0.85) continue;
    if (score.category_compatibility < 0.8) continue;
    if (masterPlaceHasSource(c.id, source.source_id)) continue;
    logger.debug(
      {
        source_record_id: source.id,
        target: c.id,
        distance_m: score.distance_meters,
        name_sim: score.name_similarity,
        cat_compat: score.category_compatibility,
        confidence: score.combined_confidence,
      },
      "matcher: name_dominant auto_link",
    );
    const outcome: MatchOutcome = {
      kind: "auto_link",
      source_record_id: source.id,
      target: c.id,
      confidence: score.combined_confidence,
      method: "name_dominant",
      score,
    };
    recordScoring(performance.now() - scoringStart);
    trackOutcomeLink(source.source_id, outcome);
    return outcome;
  }

  // Step 4: close_nameless manual_review.
  //
  // Diagnostic Mode C: OSM tags some campgrounds with non-semantic
  // names (campsite numbers "1"–"6" at Sheep Pass instead of the
  // campground name). At 39m from the cluster with category=campground
  // and name_sim=0, blended scoring lands at conf=0.444 — below
  // manual_review's 0.6 floor, so they'd become orphan master_places.
  //
  // close_nameless captures these: tight 100m radius (close enough to
  // be inside the same campground polygon), high category compat
  // (parent-child), low name similarity. Routes to human review rather
  // than auto-merging blindly.
  for (const { c, score } of scored) {
    if (score.distance_meters > 100) continue;
    if (score.name_similarity >= 0.85) continue;
    if (score.category_compatibility < 0.8) continue;
    if (masterPlaceHasSource(c.id, source.source_id)) continue;
    logger.debug(
      {
        source_record_id: source.id,
        target: c.id,
        distance_m: score.distance_meters,
        name_sim: score.name_similarity,
      },
      "matcher: close_nameless manual_review",
    );
    const outcome: MatchOutcome = {
      kind: "manual_review",
      source_record_id: source.id,
      target: c.id,
      confidence: score.combined_confidence,
      score,
      method: "close_nameless",
    };
    // Note: manual_review is intentionally NOT tracked in plannedLinks —
    // the source_record stays unlinked until human review.
    recordScoring(performance.now() - scoringStart);
    trackOutcomeLink(source.source_id, outcome);
    return outcome;
  }

  // Step 5: blended scoring (fallback). The original spec formula:
  //   0.4 × distance_score (clipped at 100m) + 0.4 × name + 0.2 × category.
  // Auto-link ≥ 0.85, manual_review ≥ 0.6, else new.
  let best: { candidate: MasterPlaceCandidate; score: MatchScore } | null = null;
  for (const { c, score } of scored) {
    if (!best || score.combined_confidence > best.score.combined_confidence) {
      best = { candidate: c, score };
    }
  }
  const { candidate, score } = best!;

  if (score.combined_confidence >= 0.85) {
    logger.debug(
      { source_record_id: source.id, target: candidate.id, confidence: score.combined_confidence },
      "matcher: blended auto_link",
    );
    const outcome: MatchOutcome = {
      kind: "auto_link",
      source_record_id: source.id,
      target: candidate.id,
      confidence: score.combined_confidence,
      method: "deterministic",
      score,
    };
    recordScoring(performance.now() - scoringStart);
    trackOutcomeLink(source.source_id, outcome);
    return outcome;
  }
  if (score.combined_confidence >= 0.6) {
    logger.debug(
      { source_record_id: source.id, target: candidate.id, confidence: score.combined_confidence },
      "matcher: blended manual_review",
    );
    const outcome: MatchOutcome = {
      kind: "manual_review",
      source_record_id: source.id,
      target: candidate.id,
      confidence: score.combined_confidence,
      score,
      method: "blended_residual",
    };
    recordScoring(performance.now() - scoringStart);
    trackOutcomeLink(source.source_id, outcome);
    return outcome;
  }
  const newId = randomUUID();
  recordPlanned(source, newId, point);
  logger.debug(
    { source_record_id: source.id, target: newId, best_confidence: score.combined_confidence },
    "matcher: new (low confidence)",
  );
  const outcome: MatchOutcome = {
    kind: "new_master_place",
    source_record_id: source.id,
    target: newId,
    seed_category: source.inferred_category ?? "unknown",
    seed_geometry: point,
    seed_name: source.name,
  };
  recordScoring(performance.now() - scoringStart);
  trackOutcomeLink(source.source_id, outcome);
  return outcome;
}

/**
 * Process source_records in batch. Resets in-memory planning at the start
 * so repeat invocations don't leak state.
 *
 * ─ Processing order ─
 * Parents (campground / recreation_area / facility / lodging) go first
 * so they exist as candidates when their amenities are processed.
 * Within parents, NPS/RIDB sources go before others so the federal
 * pair clusters early and the fed_exact shortcut has its best chance
 * of firing. Non-amenity siblings (peak, viewpoint, trailhead, etc.)
 * go in the middle tier. Amenity-type sources (dump_station, toilet,
 * etc.) go last.
 */
export async function matchAll(sourceRecordIds?: string[]): Promise<MatchOutcome[]> {
  resetPlanning();
  const db = getDb();

  // Deterministic ordering: source_quality_score DESC pushes high-authority
  // sources (NPS=0.95, RIDB=0.9, Google=0.85, OSM=0.4) to the front of
  // their tier. Without this, PostgREST returns rows in physical-storage
  // order which can shift between runs and make seed-source assignment
  // (and downstream amenity_rollup distances) non-deterministic. external_id
  // ASC is a last-resort tiebreaker.
  let records: SourceRecordRow[];
  if (sourceRecordIds && sourceRecordIds.length > 0) {
    // ID-list path: chunk the `.in("id", …)` so a large delta doesn't overrun
    // PostgREST's URL-length cap. fetchUnresolvedByIds re-sorts the
    // concatenated chunks by (source_quality_score DESC, external_id ASC) to
    // reproduce the single-query ORDER BY the comment above relies on.
    records = await fetchUnresolvedByIds(sourceRecordIds);
  } else {
    // Paginate to bypass PostgREST's 1000-row default cap. Corridor scale
    // (~8K records) silently truncated to 1000 with the unpaginated form.
    records = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await db
        .from("source_record")
        .select("id, source_id, external_id, name, inferred_category, master_place_id, geometry")
        .is("master_place_id", null)
        .order("source_quality_score", { ascending: false })
        .order("external_id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const batch = (data ?? []) as SourceRecordRow[];
      records.push(...batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
  }

  const tier = (r: SourceRecordRow): number => {
    const cat = r.inferred_category ?? "";
    if ((AMENITY_PARENT_CATEGORIES as readonly string[]).includes(cat)) return 0;
    if ((AMENITY_TYPES as readonly string[]).includes(cat)) return 2;
    return 1;
  };
  const fedRank = (r: SourceRecordRow): number =>
    r.source_id === "nps" || r.source_id === "ridb" ? 0 : 1;

  records.sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    return fedRank(a) - fedRank(b);
  });

  // Populate per-matchAll caches: source_record cache (from the records
  // we just fetched) + DB-side linkage cache (one bulk query). Both
  // eliminate per-matchOne DB roundtrips downstream.
  await initMatchAllCaches(records);

  // Detect rematerialize mode and set the skipRpcs guard. When
  // master_place is empty, all three findCandidates RPC variants are
  // pre-determined to return 0 rows — skipping them saves the ~67min
  // of pure round-trip latency measured in the 2026-05-29 baseline
  // profile. searchPlanned still runs against plannedMasterPlaces.
  // Single COUNT(*) query at matchAll setup; re-evaluated per matchAll
  // invocation (resetPlanning clears the flag).
  const { count: masterPlaceCount } = await db
    .from("master_place")
    .select("id", { count: "exact", head: true });
  skipRpcs = (masterPlaceCount ?? 0) === 0;
  logger.info(
    { skipRpcs, master_place_count: masterPlaceCount ?? 0 },
    skipRpcs
      ? "matcher: master_place empty — skipping all findCandidates RPCs (rematerialize mode)"
      : "matcher: master_place populated — using RPCs for candidate lookup",
  );

  // Incremental checkpointing — only for the full-corpus path. The
  // ID-list path is used for incremental sync (small batches) where
  // resume isn't worth the bookkeeping.
  const isFullCorpusRun = !sourceRecordIds || sourceRecordIds.length === 0;
  let fingerprint: CorpusFingerprint | null = null;
  let completedIds: Set<string> = new Set();
  const outcomes: MatchOutcome[] = [];

  if (isFullCorpusRun) {
    fingerprint = await computeCorpusFingerprint();
    const resumed = loadProgress(fingerprint);
    if (resumed && resumed.length > 0) {
      outcomes.push(...resumed);
      completedIds = new Set(resumed.map((o) => o.source_record_id));
      replayPlannedState(resumed);
      logger.info(
        { resumed: resumed.length, total: records.length },
        "matcher: resuming from checkpoint",
      );
    }
  }

  // Profiler: env-gated, sampled. No-op when MATCHALL_PROFILE != 'true'.
  // See data/entity-resolution/profiler.ts.
  initProfiler();

  const interval = checkpointInterval();
  let sinceLastCheckpoint = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (completedIds.has(r.id)) continue;
    const cached = sourceRecordCache.get(r.id);
    startSample(
      r.id,
      cached?.source_id ?? "?",
      cached?.inferred_category ?? null,
      i,
      plannedMasterPlaces.length,
    );
    const matchOneStart = performance.now();
    try {
      const outcome = await matchOne(r.id);
      outcomes.push(outcome);
      finishSample(outcome.kind, performance.now() - matchOneStart);
    } catch (err) {
      logger.error(
        { err, source_record_id: r.id, name: r.name },
        "matcher: matchOne failed",
      );
      finishSample("error", performance.now() - matchOneStart);
    }
    sinceLastCheckpoint++;
    if (isFullCorpusRun && fingerprint && sinceLastCheckpoint >= interval) {
      saveProgress(outcomes, fingerprint);
      sinceLastCheckpoint = 0;
    }
  }

  finalizeProfiler();
  if (isFullCorpusRun) clearProgress();
  logger.info(
    {
      total: outcomes.length,
      auto_link: outcomes.filter((o) => o.kind === "auto_link").length,
      amenity_rollup: outcomes.filter((o) => o.kind === "amenity_rollup").length,
      manual_review: outcomes.filter((o) => o.kind === "manual_review").length,
      new_master_place: outcomes.filter((o) => o.kind === "new_master_place").length,
    },
    "matcher: matchAll complete",
  );
  return outcomes;
}
