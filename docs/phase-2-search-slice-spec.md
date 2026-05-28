# Phase 2: Search Slice — Build Spec

**Phase:** 2 (Search Experience — minimal vertical slice)
**Duration:** 2–4 days
**Status:** Ready to execute
**Owner:** Adam (ACW Creative)
**Pre-reqs satisfied:** Phase 3a complete — entity-resolved master_place table validated on JT corpus, prominence_score computed, canonical_name precedence functioning, all on origin/main.

---

## 0. Mission

Stand up the first end-to-end search path: type a query, get ranked results back. Scoped deliberately to the ~200 JT master_places — this is a vertical slice to prove the search architecture (index → query → rank → display) on known-good data, *before* expanding the corridor or refining the long tail. The success moment is concrete: type "campground" near Joshua Tree and get Ryan / Hidden Valley / White Tank / Jumbo Rocks / Sheep Pass back, ranked sensibly, in under 100ms.

This phase also establishes the PR + CI workflow. Step zero locks down main and adds a CI gate; everything after is the inaugural PR through those guardrails.

Out of scope (later phases): corridor expansion (data volume), Phase 3b (polygon containment, audit CLI), natural-language/LLM query understanding, route-aware ranking, rich place cards, autocomplete-as-you-type widget polish. This slice is: index, a search function with sane ranking, and a thin query interface to see it work.

---

## 1. Acceptance criteria

1. Branch protection on `main`: PRs required, CI must pass before merge.
2. CI workflow runs on every PR: typecheck across `web` + `data` workspaces, passing on the current tree.
3. Typesense instance provisioned (cloud free tier or self-hosted) with credentials in env.
4. A sync script indexes all JT master_places into Typesense.
5. A search function takes a query string + optional geo center and returns ranked results combining text relevance, prominence, and proximity.
6. A thin query interface (a route in the web app, or a CLI command) demonstrates query → ranked results. "campground" near JT returns the 5 fixture campgrounds ranked above noise.
7. The whole thing ships as the first PR through the new guardrails: feature branch → PR → CI green → merge.

---

## 2. Step Zero — Branch protection + CI (do this first, as its own small PR)

This lands before any search code so the search work itself becomes the inaugural PR through the guardrails.

### 2.1 CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  workflow_dispatch:
jobs:
  typecheck:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm install
      - name: Typecheck web
        run: npm run -w web typecheck || npx -w web tsc --noEmit
      - name: Typecheck data
        run: npx tsc --noEmit -p data/tsconfig.json
```

Adjust the exact typecheck invocations to match the actual scripts in each workspace's package.json. If `web` has no `typecheck` script, add one (`"typecheck": "tsc --noEmit"`). The goal: this workflow would have caught the dangling-prop error that broke main early on.

Do NOT add the D4 test suite to CI in this step — it needs Supabase secrets and mutates real data. That's a later enhancement once the lightweight gate is proven. Note it as a follow-up in the PR description.

### 2.2 Branch protection

This is a GitHub settings change Adam makes in the web UI (Claude Code can't set repo admin settings):

Settings → Branches → Add branch protection rule for `main`:
- Require a pull request before merging
- Require status checks to pass before merging → select the `typecheck` check
- (Optional) Require branches to be up to date before merging

### 2.3 Ship step zero

This is itself the first PR:
- Branch: `chore/ci-and-branch-protection`
- Commit: `chore: add CI typecheck workflow`
- Open PR, confirm CI runs and passes, merge.
- Then Adam enables branch protection (the rule can only require a check that has run at least once, so the workflow must exist first).

After this, all subsequent work goes through PRs.

---

## 3. Stack additions

- **Typesense** — cloud free tier (Typesense Cloud Starter: 1 cluster) or self-hosted on a small VPS. Cloud is simpler for the slice; revisit hosting later.
- **typesense-js** client: `npm install -w data typesense` (sync script lives in the data workspace; search function may live in web or data depending on where the query interface goes).
- New env vars: `TYPESENSE_HOST`, `TYPESENSE_PORT`, `TYPESENSE_PROTOCOL`, `TYPESENSE_API_KEY` (admin key for sync), and a separate search-only key for the query path.

Document the new env vars in `.env.example` and `web/.env.example` as appropriate.

---

## 4. Deliverable 1 — Typesense collection schema + sync

**Branch:** `feat/phase2-search` (the search work is one PR; commits within it per deliverable).

### 4.1 Collection schema

Define a `places` collection. Document shape derived from master_place, denormalized and flattened for search:

```typescript
{
  name: 'places',
  fields: [
    { name: 'id', type: 'string' },                          // master_place.id
    { name: 'canonical_name', type: 'string' },
    { name: 'alternative_names', type: 'string[]', optional: true },
    { name: 'primary_category', type: 'string', facet: true },
    { name: 'secondary_categories', type: 'string[]', facet: true, optional: true },
    { name: 'overlander_tags', type: 'string[]', facet: true, optional: true },
    { name: 'description', type: 'string', optional: true },
    { name: 'location', type: 'geopoint' },                   // [lat, lng] from master_place.geometry
    { name: 'prominence_score', type: 'float' },
    { name: 'source_count', type: 'int32' },
    { name: 'has_water', type: 'bool', facet: true, optional: true },      // derived from amenities
    { name: 'has_dump_station', type: 'bool', facet: true, optional: true },
    { name: 'is_federal', type: 'bool', facet: true, optional: true },     // derived from overlander_tags
  ],
  default_sorting_field: 'prominence_score',
}
```

Keep the searchable text fields (`canonical_name`, `alternative_names`, `description`) and the filterable facets (`primary_category`, `overlander_tags`, the derived booleans). The derived booleans are conveniences for filtered search — compute them from the amenities/tags JSONB during sync.

### 4.2 Sync script

`data/search/sync-typesense.ts`:

- Reads all master_places from Supabase (for the slice, the full JT set — no pagination needed at ~200 rows; add pagination-ready structure for corridor scale later).
- Transforms each to the collection document shape. Extract lat/lng from the PostGIS geometry (use a `ST_X`/`ST_Y` or `ST_AsGeoJSON` select). Derive the boolean facets from amenities/overlander_tags.
- Creates the collection if it doesn't exist; upserts documents in a batch.
- Idempotent — safe to re-run.
- CLI-invokable: `npm run -w data search:sync`.

Commit: `feat(search): typesense collection schema and sync script`.

---

## 5. Deliverable 2 — Search function with ranking

`data/search/search.ts` (or `web/src/lib/search.ts` if the query interface is a web route — pick based on §6):

### 5.1 `search(params): Promise<SearchResult[]>`

```typescript
interface SearchParams {
  query: string;
  center?: { lat: number; lng: number };  // for proximity ranking
  categories?: string[];                    // facet filter
  overlanderTags?: string[];                // facet filter
  limit?: number;                           // default 20
}

interface SearchResult {
  id: string;
  canonical_name: string;
  primary_category: string;
  location: { lat: number; lng: number };
  prominence_score: number;
  source_count: number;
  distance_m?: number;                      // if center provided
  text_match_score: number;
  highlights?: object;                      // Typesense highlight ranges for matched substrings
}
```

### 5.2 Ranking

Typesense ranks by text match first, then by `sort_by`. For the slice, use a composite sort that blends text relevance, prominence, and (when a center is given) proximity:

- `query_by: canonical_name,alternative_names,description` with field weights (name highest, description lowest).
- `sort_by`: when a center is provided, `_text_match:desc,_geo_distance(location, lat, lng):asc,prominence_score:desc`. Without a center, `_text_match:desc,prominence_score:desc`.
- For categorical queries ("campground", "gas"), Typesense's text match on the category-bearing fields plus prominence ordering does the work. For named queries ("Ryan Campground"), text match dominates and the right place surfaces first.

Keep the ranking simple and legible for the slice. The point is to prove the path works and feels sane on the JT data, not to perfect the ranking weights — that tuning comes with real query logs.

### 5.3 Acceptance check (informal, run by hand)

- `search({ query: 'campground', center: JT_CENTER })` returns the 5 fixture campgrounds in the top results, ranked above amenity noise.
- `search({ query: 'Ryan' })` returns Ryan Campground first.
- `search({ query: 'water', center: JT_CENTER })` returns water POIs near the center.
- Latency under ~100ms for these (JT-scale data).

Commit: `feat(search): ranked search function over typesense index`.

---

## 6. Deliverable 3 — Thin query interface

Pick the lighter option that gets you to "see it work":

**Option A — web route (preferred if quick).** A minimal search page/route in the existing dashboard: a search input, results list rendered with the existing design system (Space Mono for data, Barlow for body, amber accent), each result showing canonical_name, category, distance, source_count. Wire the input to the search function (debounced). This is the demonstrable version — you can show someone.

**Option B — CLI (fallback if the web wiring is heavy).** `npm run -w data search:query -- "campground" --near 33.92,-115.97` prints ranked results to the terminal. Proves the path without UI work.

Recommendation: Option A if the dashboard's current structure makes adding a route cheap (it should — it's already a Next.js app). Option B if anything about the web wiring would balloon the slice. The slice's value is proving the architecture; don't let UI polish expand it. Either way, this is where you first type a query and watch ranked results come back.

Commit: `feat(search): query interface (web route | cli)`.

---

## 7. Ship the PR

- All Deliverable 1–3 commits on `feat/phase2-search`.
- Open PR against main. CI (typecheck) runs and must pass.
- Read the diff. Merge.
- This is the inaugural PR through the new guardrails — the workflow itself is part of what this phase validates.

---

## 8. Execution order

1. **Step zero** — CI workflow on its own branch `chore/ci-and-branch-protection`, PR, merge, then Adam enables branch protection. (Section 2.)
2. **Provision Typesense**, add env vars. (Section 3.)
3. **Deliverable 1** — collection schema + sync, on `feat/phase2-search`. (Section 4.)
4. **Deliverable 2** — search function + ranking. (Section 5.)
5. **Deliverable 3** — query interface. (Section 6.)
6. **Open the PR**, CI green, review diff, merge. (Section 7.)

Stop and report after step zero (confirm CI runs + branch protection live), and again after the search PR is ready for review.

---

## 9. Constraints

- Existing CLAUDE.md conventions: strict TypeScript, no `any`, structured logging, zod for any new external payload validation.
- JT scope only. Structure the sync for pagination (corridor-ready) but don't expand the data set in this phase.
- Don't tune ranking weights beyond "sane defaults that pass the informal acceptance checks" — real tuning needs query logs, which come later.
- Don't build autocomplete-as-you-type, rich cards, NL/LLM query understanding, or route-aware ranking. Those are explicitly later phases.
- Search-only Typesense API key on the query path (never the admin key in client-facing code). If the query interface is a web route that runs client-side, the search key must be scoped search-only; if server-side, still prefer the scoped key.
- The sync script and search function should be corridor-scale-ready in structure (pagination, batching) even though they run on JT data now — so corridor expansion is a data change, not a code change.

---

## 10. What this proves

When this slice merges, you'll have typed a query and watched ranked results come back over your real federated data for the first time. That's the moment the foundation becomes a product. It also tells you whether the ranking *feels* right on known data — which is the cheapest possible place to discover ranking problems, before corridor scale buries them in volume. And it establishes the PR + CI discipline that every phase after this runs through.
