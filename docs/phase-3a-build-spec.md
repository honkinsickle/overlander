# Phase 3a: Core Entity Resolution — Build Spec

**Phase:** 3a of Phase 3 (Entity Resolution)
**Duration:** 1–2 days
**Status:** Ready to execute
**Owner:** Adam (ACW Creative)
**Pre-reqs satisfied:** Phase 1 schema deployed, 4 sources flowing in JT bbox, field_precedence seeded (55 rows), `data/entity-resolution/README.md` documents all ER findings to date.

---

## 1. Mission

Turn the ~207 JT source_records into a properly deduplicated master_place table. The 5 4-way JT campground matches (Ryan, Hidden Valley, White Tank, Jumbo Rocks, Sheep Pass) are the canonical fixture set — each must resolve to exactly one master_place with all its linked source records. ~50 OSM amenity nodes must roll up into their nearest campground via the amenity-rollup path, not become orphan master_places. Single-source records (Pinto Mountains Wilderness, OSM peaks) must become their own master_places.

This is the first end-to-end validation of the federation pattern. If matcher.ts works on JT, the architecture is sound and the corridor expansion is mostly a data-volume problem.

---

## 2. Acceptance criteria

End-of-phase state, in priority order:

1. All Phase 1 SQL function deferrals implemented (`resolve_field`, `compute_prominence`, `recompute_master_place`, `recompute_aggregated_fields`).
2. `data/entity-resolution/matcher.ts` produces correct match decisions for all 207 JT source_records.
3. `data/entity-resolution/promote.ts` applies match decisions to the database transactionally.
4. Unit test suite passes from a clean DB state: 5 campground master_places exist with expected source coverage, ~50 amenity nodes rolled up, no "Unnamed dump station" orphan master_places, Chimney Rock is NOT merged into Hidden Valley.
5. One commit per deliverable, conventional message format. README updated if any new findings emerge during implementation.

---

## 3. Out of scope (defer to Phase 3b)

- Park-class polygon containment (OSM "Joshua Tree National Park" node being 58km from NPS centroid). Phase 3a uses distance only.
- Manual-audit CLI (`audit-cli.ts`). Phase 3a relies on unit tests; CLI is for production corpus audits in 3b.
- Nightly orchestrator (`orchestrator.ts`). Phase 3a is invoked from the test suite; production scheduling waits.
- LLM-assisted matching for the manual-review queue (0.6 ≤ confidence < 0.85). Phase 3a routes these to `place_match` with `status='pending'` and stops there.
- Automatic recompute triggers on `place_match` status changes. Recompute is called explicitly by `promote.ts`. No SQL triggers.

---

## 4. Deliverable 1 — SQL migration

**Filename:** `supabase/migrations/20260527130000_phase3a_recompute_functions.sql`

**Implements four functions** (the three deferred from Phase 1 plus the new aggregated-fields helper):

### 4.1 `resolve_field(p_master_place_id UUID, p_field_name TEXT) RETURNS JSONB`

Per spec §10.2. Picks the linked source_record with the lowest priority value in `field_precedence` that has a non-null value for the field. Returns `{value, source}` JSONB. Marked `STABLE`.

### 4.2 `compute_prominence(p_master_place_id UUID) RETURNS FLOAT`

Per spec §10.4. Combines:
- Source diversity: `COUNT(DISTINCT source_id) * 2.0`
- Summed review count across sources: `* 0.5`
- Official source boost: `+3` if any record from `nps` or `ridb`
- Recency penalty: `-1` if newest source_record older than 12 months
Returns `GREATEST(score, 0)`. Marked `STABLE`.

### 4.3 `recompute_aggregated_fields(p_master_place_id UUID) RETURNS VOID`

New helper not in original spec. Handles the three aggregated fields (`alternative_names`, `secondary_categories`, `overlander_tags`) that are UNION across all linked source_records, not single-source-wins. Reads `source_record.normalized_payload->'<field>'` from all active linked records, deduplicates, writes back to `master_place.<field>`. JSONB array union semantics.

### 4.4 `recompute_master_place(p_master_place_id UUID) RETURNS VOID`

Per spec §10.3, with three changes:

1. Calls `recompute_aggregated_fields()` for the three union-semantic fields before the per-field precedence resolution.
2. The per-field loop covers exactly these 13 precedence-managed fields: `canonical_name`, `description`, `amenities`, `hours`, `contact`, `access`, `services`, `capacity`, `seasonality`, `cell_signal`, plus `geometry` and `geometry_polygon` (handled specially since they're PostGIS types, not JSONB).
3. After all fields resolved, calls `compute_prominence()` and writes `prominence_score`.

Geometry handling note: `geometry` and `geometry_polygon` are not stored in `normalized_payload` JSONB but as proper PostGIS columns on `source_record`. The function needs a separate code path for these — query `source_record.geometry` and `source_record.geometry_polygon` directly using the same precedence rules.

**No triggers.** Recompute is invoked explicitly by `promote.ts` after match application, not automatically by row changes.

**No new indexes.** Existing indexes from Phase 1 migrations are sufficient.

---

## 5. Deliverable 2 — `data/entity-resolution/matcher.ts`

Three exported functions plus shared constants. Keep everything in one file for Phase 3a — premature modularization. If the file grows past ~600 lines, revisit in 3b.

### 5.1 Constants (top of file)

```typescript
// Amenity-type categories that should roll up into a parent campground/recarea/facility
// instead of becoming sibling master_places. See data/entity-resolution/README.md
// for the JT smoke-test finding (53% of OSM JT rows were amenity-type sub-features).
export const AMENITY_TYPES = [
  'dump_station', 'toilet', 'water', 'fire_pit',
  'picnic_area', 'shower', 'charging_station'
] as const;

// Parent categories that can absorb an amenity rollup
export const AMENITY_PARENT_CATEGORIES = [
  'campground', 'recreation_area', 'facility', 'lodging'
] as const;

// Category compatibility matrix. Symmetric — A↔B has the same score as B↔A.
// Values not present default to 0.
//
// Rationale per JT 3-way and 4-way overlap findings (see README):
//   - campground ↔ lodging = 1.0  (Google's lodging type includes campground as a child)
//   - campground ↔ facility = 1.0  (RIDB labels what NPS calls campground as facility)
//   - campground ↔ recreation_area = 0.7  (RIDB recareas often contain campgrounds; not always)
//   - campground ↔ park_feature = 0.3  (NPS park_feature near a campground is sometimes related, often not)
//   - campground ↔ peak = 0.0  (Hidden Valley/Chimney Rock case: peaks near campgrounds are NOT them)
//   - gas_station ↔ fuel = 1.0  (Google's gas_station == OSM's fuel)
//
// Encoded as a one-way map; lookup symmetrically in scoreMatch.
export const CATEGORY_COMPATIBILITY: Record<string, Record<string, number>> = {
  campground:      { campground: 1.0, lodging: 1.0, facility: 1.0, recreation_area: 0.7, park_feature: 0.3, peak: 0.0 },
  lodging:         { campground: 1.0, lodging: 1.0, facility: 0.8 },
  facility:        { campground: 1.0, facility: 1.0, recreation_area: 0.8 },
  recreation_area: { recreation_area: 1.0, campground: 0.7, facility: 0.8, park_feature: 0.5 },
  gas_station:     { gas_station: 1.0, fuel: 1.0 },
  fuel:            { fuel: 1.0, gas_station: 1.0 },
  trailhead:       { trailhead: 1.0 },
  viewpoint:       { viewpoint: 1.0 },
  peak:            { peak: 1.0 },
  spring:          { spring: 1.0, water: 0.5 },
  // Extend as new categories emerge from corridor expansion
};

// Suffixes to strip during name normalization for similarity matching
const NAME_SUFFIXES_TO_STRIP = [
  'campground', 'cg', 'group', 'rv park',
  'recreation area', 'park', 'picnic area'
];
```

### 5.2 `findCandidates(sourceRecordId: string): Promise<MasterPlaceCandidate[]>`

Returns master_places within 200m of the source_record, ordered by distance ASC, limited to 10. Single SQL query via `ST_DWithin`:

```sql
SELECT m.id, m.canonical_name, m.primary_category, m.geometry,
       ST_Distance(s.geometry::geography, m.geometry::geography) AS distance_m
FROM source_record s
JOIN master_place m
  ON ST_DWithin(s.geometry::geography, m.geometry::geography, 200)
WHERE s.id = $1
ORDER BY distance_m ASC
LIMIT 10;
```

Returns empty array if no candidates. The radius is wider than the 100m used for amenity-rollup because some 4-way matches drift up to 350m (Sheep Pass).

### 5.3 `scoreMatch(source: SourceRecord, candidate: MasterPlaceCandidate): MatchScore`

Pure function — no DB calls. Computes:

```typescript
interface MatchScore {
  distance_meters: number;
  name_similarity: number;        // 0–1 Jaro-Winkler on normalized names
  category_compatibility: number; // 0–1 from CATEGORY_COMPATIBILITY
  combined_confidence: number;    // weighted blend per spec §9.1
}

function scoreMatch(source, candidate): MatchScore {
  const distance_meters = candidate.distance_m;

  const name_similarity = jaroWinkler(
    normalizeName(source.name),
    normalizeName(candidate.canonical_name)
  );

  const category_compatibility = lookupCompatibility(
    source.inferred_category,
    candidate.primary_category
  );

  const distance_score = 1 - Math.min(distance_meters, 100) / 100;
  const combined_confidence =
      0.4 * distance_score
    + 0.4 * name_similarity
    + 0.2 * category_compatibility;

  return { distance_meters, name_similarity, category_compatibility, combined_confidence };
}
```

`normalizeName`: lowercase, collapse whitespace, strip punctuation, remove trailing suffixes from `NAME_SUFFIXES_TO_STRIP`.

`lookupCompatibility(a, b)`: returns `CATEGORY_COMPATIBILITY[a]?.[b] ?? CATEGORY_COMPATIBILITY[b]?.[a] ?? 0` (symmetric lookup).

`jaroWinkler`: from the already-installed `natural` package.

### 5.4 `matchOne(sourceRecordId: string): Promise<MatchOutcome>`

The routing logic. Returns a discriminated union:

```typescript
type MatchOutcome =
  | { kind: 'amenity_rollup'; target: string }
  | { kind: 'auto_link'; target: string; confidence: number; method: 'deterministic' | 'fed_exact' }
  | { kind: 'manual_review'; target: string; confidence: number }
  | { kind: 'new_master_place' };
```

Logic in order:

1. **Fetch source_record.** If `master_place_id IS NOT NULL`, throw — already resolved.

2. **NPS↔RIDB exact-match shortcut.** If `source.source_id` is `nps` or `ridb`, query for any existing master_place within 10m that already has a linked source_record from the other federal source (RIDB or NPS respectively). If found, return `{ kind: 'auto_link', target, confidence: 1.0, method: 'fed_exact' }`. These share the Recreation.gov backing feed and are guaranteed to be the same place.

3. **Amenity-rollup path.** If `source.inferred_category ∈ AMENITY_TYPES`, query for master_places within 100m where `primary_category ∈ AMENITY_PARENT_CATEGORIES`, ordered by distance. If at least one exists, return `{ kind: 'amenity_rollup', target: nearest.id }`. The amenity is absorbed into the parent's `amenities` JSONB on recompute; no `place_match` row, no sibling master_place.

4. **Standard scoring.** Call `findCandidates(sourceRecordId)`. If empty, return `{ kind: 'new_master_place' }`. Otherwise compute `scoreMatch` for each, pick max `combined_confidence`:
   - ≥ 0.85 → `{ kind: 'auto_link', target, confidence, method: 'deterministic' }`
   - 0.6 ≤ x < 0.85 → `{ kind: 'manual_review', target, confidence }`
   - < 0.6 → `{ kind: 'new_master_place' }`

### 5.5 `matchAll(sourceRecordIds?: string[]): Promise<MatchOutcome[]>`

Convenience wrapper. If no IDs provided, queries all `source_record` rows where `master_place_id IS NULL`. Calls `matchOne` for each in order. Returns the array of outcomes.

**Order matters.** Process records by decreasing prominence of their parent category — campgrounds first, then facilities/recareas, then amenities. This ensures parent master_places exist by the time amenities are processed, so the amenity-rollup query finds them.

---

## 6. Deliverable 3 — `data/entity-resolution/promote.ts`

This is the application layer. Matcher decides; promote applies. The SQL functions transform; they don't decide. Three layers of separation, each with one responsibility.

### 6.1 `applyMatches(outcomes: MatchOutcome[]): Promise<ApplyResult>`

Wraps all mutations in a single transaction (Supabase RPC or raw SQL — whichever is cleanest with the existing `db.ts` shape). For each outcome:

- **`auto_link`**: `UPDATE source_record SET master_place_id = $target WHERE id = $source_id`. `INSERT INTO place_match (source_record_id, master_place_id, distance_meters, name_similarity, category_compatibility, combined_confidence, match_method, status, resolved_by, resolved_at) VALUES (..., 'deterministic' OR 'fed_exact', 'confirmed', 'auto', NOW())`. Add `target` to recompute queue.

- **`amenity_rollup`**: `UPDATE source_record SET master_place_id = $target`. `INSERT INTO place_match (..., match_method='amenity_rollup', status='confirmed', resolved_by='auto')`. Add `target` to recompute queue. The amenity becomes visible to the parent via the aggregated-fields path when recompute runs.

- **`manual_review`**: `INSERT INTO place_match (..., status='pending', resolved_by=NULL)`. **Do not link source_record.** It stays unresolved until human review.

- **`new_master_place`**: `INSERT INTO master_place (canonical_name, primary_category, geometry, ...)` populated from the source_record. `UPDATE source_record SET master_place_id = $new_id`. `INSERT INTO place_match (..., distance_meters=0, combined_confidence=1.0, match_method='deterministic', status='confirmed', resolved_by='auto')`. Add `new_id` to recompute queue.

After all mutations applied, iterate over the recompute queue (deduplicated) and call `recompute_master_place(id)` for each.

Returns:

```typescript
interface ApplyResult {
  auto_linked: number;
  amenity_rolled_up: number;
  manual_review_queued: number;
  new_master_places: number;
  errors: Array<{ source_record_id: string; error: string }>;
}
```

---

## 7. Deliverable 4 — `data/entity-resolution/test-fixtures.ts`

Encodes ground truth for the JT smoke test corpus. Both positive examples (expected 4-way merges) and negative examples (expected to NOT merge).

```typescript
export const JT_POSITIVE_FIXTURES = [
  { canonical_name: 'Ryan Campground',          expected_source_ids: ['nps', 'ridb', 'google', 'osm'] },
  { canonical_name: 'Hidden Valley Campground', expected_source_ids: ['nps', 'ridb', 'google'] },        // Chimney Rock peak should NOT merge
  { canonical_name: 'White Tank Campground',    expected_source_ids: ['nps', 'ridb', 'google', 'osm'] },
  { canonical_name: 'Jumbo Rocks Campground',   expected_source_ids: ['nps', 'ridb', 'google', 'osm'] },
  { canonical_name: 'Sheep Pass Campground',    expected_source_ids: ['nps', 'ridb', 'google', 'osm'] },
];

export const JT_NEGATIVE_FIXTURES = [
  // Single-source records that must become their own master_places
  { external_id_pattern: 'ridb:%pinto%',  reason: 'Pinto Mountains Wilderness — BLM, no other source has it' },
  { external_id_pattern: 'osm:node:%',    inferred_category: 'peak', expected_solo: true,
    reason: 'OSM peaks are unique to OSM; no merges expected' },
];

export const JT_AMENITY_ROLLUP_FIXTURES = [
  // Specific amenity-rollup assertions
  { amenity_name: 'Unnamed dump station', near_campground: 'Ryan Campground',
    expected_rollup: true, max_distance_m: 100 },
  { amenity_name: 'Chimney Rock', near_campground: 'Hidden Valley Campground',
    expected_rollup: false, reason: 'peak ↔ campground compatibility = 0' },
];
```

---

## 8. Deliverable 5 — `data/entity-resolution/test.ts`

Vitest spec. Hits real Supabase (the same dev project — separate test project would require provisioning), but wraps each test in a transaction that rolls back on completion to avoid polluting state.

**Pattern:**

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { supabase } from '../ingestion/lib/db';
import { matchAll } from './matcher';
import { applyMatches } from './promote';
import { JT_POSITIVE_FIXTURES, JT_NEGATIVE_FIXTURES, JT_AMENITY_ROLLUP_FIXTURES } from './test-fixtures';

describe('Phase 3a entity resolution — JT corpus', () => {
  let savepoint: string;

  beforeAll(async () => {
    // Verify JT source_records exist and are unresolved
    const { count } = await supabase
      .from('source_record')
      .select('id', { count: 'exact', head: true })
      .is('master_place_id', null);
    expect(count).toBeGreaterThan(150); // expecting ~207
  });

  afterEach(async () => {
    // Roll back: unlink source_records, delete place_match rows from this run,
    // delete any master_places created during the test
    await supabase.rpc('reset_phase3a_test_state');  // helper migration
  });

  it('resolves all 5 JT campgrounds to single master_places with expected sources', async () => {
    const outcomes = await matchAll();
    await applyMatches(outcomes);

    for (const fixture of JT_POSITIVE_FIXTURES) {
      const { data: mp } = await supabase
        .from('master_place')
        .select('id, canonical_name')
        .ilike('canonical_name', fixture.canonical_name)
        .single();
      expect(mp).toBeTruthy();

      const { data: sources } = await supabase
        .from('source_record')
        .select('source_id')
        .eq('master_place_id', mp.id);

      const sourceIds = sources.map(s => s.source_id).sort();
      expect(sourceIds).toEqual(fixture.expected_source_ids.sort());
    }
  });

  it('rolls up amenity nodes into parent campgrounds, not as siblings', async () => {
    const outcomes = await matchAll();
    await applyMatches(outcomes);

    // No "Unnamed dump station" should be its own master_place
    const { count } = await supabase
      .from('master_place')
      .select('id', { count: 'exact', head: true })
      .ilike('canonical_name', '%dump station%');
    expect(count).toBe(0);
  });

  it('does NOT merge Chimney Rock into Hidden Valley Campground (category incompatible)', async () => {
    const outcomes = await matchAll();
    await applyMatches(outcomes);

    const { data: chimney } = await supabase
      .from('source_record')
      .select('master_place_id, name')
      .ilike('name', '%chimney rock%')
      .single();

    const { data: hiddenValley } = await supabase
      .from('master_place')
      .select('id')
      .ilike('canonical_name', 'hidden valley campground')
      .single();

    expect(chimney.master_place_id).not.toBe(hiddenValley.id);
  });

  it('creates solo master_places for single-source records', async () => {
    const outcomes = await matchAll();
    await applyMatches(outcomes);

    const { data: pinto } = await supabase
      .from('source_record')
      .select('master_place_id, name')
      .ilike('external_id', 'ridb:%pinto%')
      .single();
    expect(pinto.master_place_id).toBeTruthy();

    const { count } = await supabase
      .from('source_record')
      .select('id', { count: 'exact', head: true })
      .eq('master_place_id', pinto.master_place_id);
    expect(count).toBe(1);
  });

  it('routes ambiguous matches (0.6 ≤ conf < 0.85) to manual review without linking', async () => {
    const outcomes = await matchAll();
    await applyMatches(outcomes);

    const { data: pending } = await supabase
      .from('place_match')
      .select('*')
      .eq('status', 'pending');

    // Assert that the source_records referenced by pending rows are NOT linked
    for (const row of pending) {
      const { data: sr } = await supabase
        .from('source_record')
        .select('master_place_id')
        .eq('id', row.source_record_id)
        .single();
      expect(sr.master_place_id).toBeNull();
    }
  });
});
```

The `reset_phase3a_test_state` RPC is a helper that:
1. Sets `source_record.master_place_id = NULL` for all rows with non-null values that were set after a known timestamp (or simply: deletes all rows from `master_place` created during this test session and unlinks the affected source_records).
2. Deletes `place_match` rows created during this test session.

This is a simpler alternative to real transactional rollback (which Supabase JS client doesn't support cleanly across multiple queries).

---

## 9. Execution order

1. SQL migration (`20260527130000_phase3a_recompute_functions.sql`) + the helper RPC for test reset. Apply via `npm run -w data db:push-verify` (CLAUDE.md "Migration workflow"). Verify all four functions callable.
   **Commit:** `feat(data): SQL functions for master_place recompute + field resolution`.

2. `matcher.ts` with constants and the four exported functions.
   **Commit:** `feat(er): matcher with amenity-rollup and federal-exact-match shortcuts`.

3. `promote.ts` with `applyMatches`.
   **Commit:** `feat(er): match application layer with transactional recompute`.

4. `test-fixtures.ts` + `test.ts`.
   **Commit:** `test(er): JT corpus fixtures and end-to-end resolution test`.

5. Run the suite. If passing, commit any necessary README updates.
   **Commit (if needed):** `docs(er): Phase 3a implementation notes`.

After each commit, stop and report row counts, test results, and any unexpected behavior. Do not push to origin until all 5 deliverables are committed and the test suite passes.

---

## 10. Constraints

- Code style follows existing CLAUDE.md conventions: strict TypeScript, zod for any new payload validation, structured logging via pino, no `any`.
- SQL functions marked `STABLE` where they don't mutate (resolve_field, compute_prominence) and `VOLATILE` where they do (recompute_*).
- `matcher.ts` algorithm code must be readable as documentation — when the reader asks "why is `lodging ↔ campground` = 1.0?", the answer is in an inline comment referencing the README finding.
- No new dependencies without justification. `natural` (Jaro-Winkler) is already installed.
- Do not implement park-class polygon containment, the audit CLI, the nightly orchestrator, or LLM-assisted matching. Those are 3b.
