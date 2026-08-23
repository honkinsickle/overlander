# Search cutover to `resolvePlaces()` — plan (investigation only)

**Status:** PLAN ONLY, 2026-08-23. No code changed. This is the first of four
planned surface cutovers (Search → Date Detail → Day Column → Day-scoped browse).
Search is first because it is the most self-contained.

**Scope of this doc:** what the `/api/search-area` cutover would change, whether the
built `resolvePlaces()` actually produces Search-compatible output, whether the three
now-resolved decisions (#254 / #255-256 / #257) are correctly reflected for Search's
case, a rollback plan, and what blocks doing it safely.

Evidence convention per `trip-resolution.md`. Every current-behaviour claim below is
tagged `[read source]` / `[measured 2026-08-23]` and was re-read in full this session,
not recalled. Companion: `resolve-places-design.md` (the service design, D1–D9).

> **⚠ HEADLINE FINDING — there is one real blocker.** The Verified/Unverified tiering
> (#255/#256) is **non-functional on the `bbox` (Search) path of `resolvePlaces()` as
> built.** Every federated Search result would classify as `unverified`. The resolver's
> own bbox tier tests pass only because their fake `hydratePlacesByIds` behaves
> **unlike the real one** in exactly the two ways that matter. Details in §4. This must
> be fixed before a Search cutover that honours #255/#256. Everything else is mechanical.

---

## 1. The route handler change — thin wrapper, not full replacement

`GET /api/search-area` `[read source: web/src/app/api/search-area/route.ts]` today does
four things the service deliberately does **not**:

1. Parses + validates `bbox` / `q` / `categories`; 400s on bad input.
2. Owns an **in-process LRU cache** (15 min, 200 entries, keyed rounded-bbox + q + sorted
   categories) that **caches only on full success** (`failedSources.length === 0`).
3. Gates `sourceErrors` behind `?debug=1` / `SEARCH_DEBUG_ERRORS=1` (a Supabase error can
   name table internals).
4. Shapes the response: `{ source: "search-area", places, counts: {live, federated},
   failedSources, sourceErrors? }`.

`resolvePlaces()` owns none of these by design — it has **no cache, no env reads, no
route concerns** (`resolve-places.ts` header; design §D6). So the cutover is a **thin
wrapper**: keep 1–4 in the route, and replace only the inline live/federated/merge body
(route lines ~170–256) with a single call:

```ts
const { places, counts, failedSources, sourceErrors } = await resolvePlaces({
  scope: { kind: "bbox", bbox, query: q ?? undefined, categories: categories ?? undefined },
  includeErrorDetail: debug,
  signal: req.signal,
  // NOTE: do NOT pass `limit` — see below. Do NOT pass `enrich` — see §4 (#257).
});
```

`resolvePlaces` then owns the fanout (LIVE `discover()` + FEDERATED Typesense →
`hydratePlacesByIds`), the merge, canonical-id dedupe, and the tier sort. The route
re-wraps cache + debug-gate + response shape around it.

**Two wrapper details that are behaviour-preserving only if handled deliberately:**

- **Do NOT pass `limit`.** `[read source]` The route today caps only the Typesense half
  at `LIMIT = 24` (via `search({limit})`) and leaves the merged live+federated set
  **uncapped**. `resolvePlaces` uses `input.limit` as **both** the Typesense `per_page`
  **and** a post-merge `.slice(0, limit)`. Omitting `limit` → `resolveFederated` falls
  back to `DEFAULT_TYPESENSE_LIMIT = 24` (same Typesense cap) and skips the post-merge
  slice (same uncapped merge). Passing `limit: 24` would **newly** truncate the merged
  set to 24 — a visible regression when live adds results past the corpus 24.
- **`counts` shape differs** — route emits `{live, federated}`; resolver emits
  `{live, federated, deduped}`. The client ignores `counts` entirely (§3), so pass it
  through or trim it; either is safe. Cosmetic.

**One semantic difference to spot-check (not a blocker):** on the *category* live path
the route registers `onSourceError: (id) => failedSources.add(id)` **without** a message,
while `resolvePlaces` always records the message (gated by `includeErrorDetail`). The
resolver is the *more* consistent of the two. The client only uses `failedSources` to
choose "corpus-down" vs "partial results" wording (`every(s => s === "corpus")`), and the
federated half is named `"corpus"` in both — so the note still renders correctly. Confirm
in the end-to-end verify (§6), don't assume.

---

## 2. Existing test coverage — insufficient to catch a regression as-is

- **Zero tests cover the wired route or the client** `[measured 2026-08-23]`. There is no
  `route.test.ts` under `app/api/search-area/`, and no test for `find-nearby-panel.tsx`.
  (The two `components/trip/*.test.ts` files — day-column drift and day-detail spine — are
  unrelated.)
- **`resolve-places.test.ts` (the service, ~47 tests) exercises the logic in isolation
  through a dependency seam with fakes.** It is real coverage of merge / dedupe / scope
  branching — but see §4: its **bbox tier tests validate a fake that does not match the
  real `hydratePlacesByIds`**, so they give false confidence on exactly the behaviour the
  cutover most needs.
- **Web tests do not run in CI** `[read source: .github/workflows/ci.yml, web/package.json]`.
  The `test` job runs `npm run -w data test`; `web/package.json` has **no `test` script**.
  The resolver tests run only via `npx tsx --test` when someone runs them locally, so
  "verified by tests" does not gate the merge.

**Needed before cutover:** (a) the §4 fix plus a resolver bbox tier test whose fake
`hydratePlacesByIds` mirrors the real contract; (b) a scripted TEST verification of the
**wired** path against real Typesense + Supabase (design §5 gap 2 — the service has
**never** run end-to-end). Because CI won't run web unit tests, (b) is the real gate.

---

## 3. Client-consumer compatibility — no mismatch in consumed fields

The only client consumer is `find-nearby-panel.tsx`'s `SearchAreaResults`
`[read source]`. It reads exactly two fields off the response:

```ts
const { places, failedSources = [] } = (await res.json()) as {
  places: BrowsePlace[]; failedSources?: string[];
};
```

`resolvePlaces` returns both, and `BrowsePlace` is returned **unchanged** (same type,
`resolve-places.ts` header + design §4e). It ignores `source`, `counts`, `sourceErrors`.
Downstream field usage checked:

- **`LocationBrowseCard` reads `place.source === "master_place"`** to flag federated rows
  `[read source: location-browse-card.tsx:142]`. `resolvePlaces` stamps `source` on
  **every** place (live→`"live"`, federated→`"master_place"`; design §D7). `isFederated`
  therefore stays correct; live places newly carry `source: "live"` (was `undefined`), and
  nothing branches on that value. **No behaviour change.**
- **`place.verified` is not rendered by the card** `[measured 2026-08-23 — grep: no hits
  in location-browse-card.tsx]`. So the only *visible* effect of the tier field on Search
  today is the **sort order** (`sortByVerificationTier`, verified-first). Keep this in mind
  for §4 — the bug there manifests as ordering, not a badge.

**Id stability — verified safe.** The real `hydratePlacesByIds` already returns
`id: mp:<uuid>` (via `mapMasterPlaceRow`, `federated.ts:175`), and `canonicalizePlaceId`
is a **no-op** on a well-formed `mp:<lowercase-uuid>` and on live `gpl/…`/`node/…` ids
`[read source: place-id.ts]`. UUIDs are lowercased by canonicalization, but Postgres
already emits lowercase, so no id string actually changes at cutover. Marker↔card linking
inside the panel is internally consistent anyway (markers and cards are both built from
the one `places` array, `find-nearby-panel.tsx:640/778`), and `onAdd`→waypoint carries
`place.id` unchanged. **No id-shape regression.**

---

## 4. Are #254 / #255-256 / #257 correctly reflected for Search? — one is NOT

### #254 (category mapping) — ✅ correctly reflected, upstream of both paths

#254 narrowed `SLIDE_TO_PRIMARY_CATEGORY.camping` and moved `facility`→`interest`,
`recreation_area`→`scenic` in `trip-browse/federated.ts`. Search's `categories` are the
**corpus `primary_category`** vocabulary, and the client builds them **from that same
`SLIDE_TO_PRIMARY_CATEGORY`** for its filter-row chips
`[read source: find-nearby-panel.tsx:35,351]`. So #254 already flows into today's route
and into a resolver cutover identically — it is upstream of both. The `bbox` path passes
`categories` straight to Typesense `search()` and maps to live buckets via
`LIVE_SLIDE_FOR_PRIMARY`; **the route's copy and the resolver's copy of that map are
byte-identical** `[measured 2026-08-23: 38 keys each, empty symmetric diff]`, and #254 did
not touch it. **No cutover change needed.** (Maintenance risk only: the two
`LIVE_SLIDE_FOR_PRIMARY` copies are hand-synced — the resolver's carries a "keep in sync"
comment. Not a blocker; worth folding the route's copy into the shared module during
cutover so there is one.)

### #257 (no auto-hydration for Search) — ✅ correctly reflected

`resolvePlaces` `enrich` defaults **OFF** (`resolve-places.ts` §4c, design §D3). Search
never auto-hydrated `[read source]`. The wrapper simply **must not pass `enrich`** — then
Search keeps its no-live-Google-Details behaviour exactly. Confirmed by the enrich default
and the §D3 resolution. **No change needed beyond "don't pass `enrich`."**

### #255 / #256 (Verified/Unverified tiers) — ❌ NOT reflected on the Search (`bbox`) path

This is the blocker. The tier system was **built into `resolvePlaces()`**, but the `bbox`
data path never actually feeds it real `description_source`, so it silently degrades to
"everything unverified."

**Mechanism, traced end to end `[read source]`:**

1. The real `hydratePlacesByIds` builds its row **without** `description_source` — its
   base `SELECT` on `master_place` and its geo `SELECT` on `master_place_search_export`
   (`id,lng,lat,photo_url`) both omit it, and the `row` object handed to
   `mapMasterPlaceRow` has no `description_source` key `[hydrate.ts:71,81,114-143]`.
2. `mapMasterPlaceRow` **always** sets `verified` — `description_source === 'source'||'llm'
   ? 'verified' : 'unverified'` `[federated.ts:230-233]`. With `description_source`
   undefined, that is **`"unverified"` for every hydrated place.**
3. In `resolvePlaces`, `stamp()` for a federated place does
   `else if (p.verified) { verified = p.verified }` — i.e. it **preserves** whatever
   hydrate set. Since hydrate always sets `"unverified"` (truthy), stamp **short-circuits
   and never consults** the `descriptionSources` map that `resolveFederated` painstakingly
   populated from the Typesense hits `[resolve-places.ts:259-268, 496-499]`.
4. Even if step 3 didn't short-circuit, the map is keyed by the **bare** Typesense
   `hit.id` (a bare uuid), while `stamp` looks it up with `p.id = "mp:<uuid>"` (real
   hydrate's id form) → **key mismatch → null → unverified.**

**Why the tests don't catch it.** The bbox tier tests
(`resolve-places.test.ts:524-596`) use `hydratePlacesByIds: async () => [place(UUID)]` —
a fake that (a) returns a **bare-uuid** id (accidentally matching the descriptionSources
key) and (b) **omits the `verified` field** (so stamp reaches its `else` branch). The real
function does the opposite on both counts. The tests validate a dependency that behaves
unlike production — the exact "apparatus doesn't match the subject" trap in CLAUDE.md's
RUNBOOK. The corridor path is fine (its `fetchFederatedPois`→`mapMasterPlaceRow` gets
`description_source` from the RPC row), which is why this went unnoticed.

**Consequence at cutover:** every federated Search result sorts **below every live
result** regardless of true tier, and the #255/#256 Verified/Unverified distinction that
Search is supposed to honour is simply wrong. No visible badge today (§3), so the symptom
is ordering — quiet, but wrong.

**Fix (recommended — single-source the classification):** thread `description_source`
through `hydratePlacesByIds`. It already lives on `master_place_search_export`
(the Typesense sync source, added for #256) — add it to the geo `SELECT`, set
`row.description_source`, and let `mapMasterPlaceRow` classify. Then:
- Both the current route **and** the resolver bbox path get correct tiers from one place.
- `resolveFederated`'s parallel `descriptionSources` map and `stamp`'s bbox-derivation
  branch become **redundant and should be deleted** (the corridor path already relies on
  `mapMasterPlaceRow`; unify on it).
- Add a resolver bbox tier test whose fake `hydratePlacesByIds` **mirrors the real
  contract** — returns `mp:<uuid>` ids and a `verified` field — so this gap cannot reopen.

This touches **shared code** (`hydrate.ts` is used by today's route too), but it is
corrective and additive: it also fixes the current route, which today ships every
federated Search result as `verified: "unverified"` (invisible only because nothing sorts
on it yet). Flagged as shared-code per web/CLAUDE.md.

*(Alternative, narrower: fix `stamp` to canonicalize the map key and prefer the Typesense
`description_source` over a hydrate-provided `"unverified"`. Rejected as the primary
recommendation — it leaves classification split across two mechanisms and fights the fact
that `mapMasterPlaceRow` already owns `verified`. Single-sourcing in hydrate is cleaner.)*

---

## 5. Rollback plan

No feature flag guards `/api/search-area` today. The cutover is a route-internal swap, so
two clean options:

- **(a) Revert the PR.** The thin-wrapper change is one route file (plus the §4 hydrate
  fix). `git revert` restores the exact prior body; the route keeps its own cache and
  response shape, so the blast radius is one file. Fast, but needs a redeploy.
- **(b) Env flag in the route — recommended for this first cutover.** Gate the body on
  `SEARCH_AREA_USE_RESOLVER` (old inline body vs `resolvePlaces` call), default **off**,
  flip in Vercel. Mirrors the existing `USE_FEDERATED_POIS` pattern the codebase already
  uses, and lets rollback happen **without a redeploy** — appropriate because the service
  has never run end-to-end in production (§6). Remove the flag once the four surfaces have
  all cut over and settled.

Either way the cache + response shaping stay at the route, so a revert/flip is isolated.

---

## 6. What blocks a safe cutover today

1. **BLOCKER — #255/#256 bbox tier path is non-functional (§4).** Fix `hydrate.ts` to
   carry `description_source`, delete the now-redundant resolver bbox-tier plumbing, and
   add a real-contract resolver test. Without this, cutover ships wrong ordering and
   defeats the tier work.
2. **BLOCKER-ish — the service has never run end-to-end** (design §5 gap 2). It is
   verified only against fakes. Stand up a scripted TEST verification of the **wired**
   route (real Typesense + `hydratePlacesByIds` + Supabase, TEST project) exercising:
   free-text, category tiles, an all-overland category set (federated-only), a
   source-down case (`failedSources` wording), and the post-fix verified ordering.
   Because web unit tests don't gate CI (#3 below), **this script is the real gate.**
3. **GAP (pre-existing, not introduced) — web tests don't run in CI.** The §4 unit test
   protects local runs only; rely on the §6.2 script + Adam's review for the merge gate.
4. **MECHANICAL — wrapper details:** don't pass `limit`, don't pass `enrich`, decide
   `counts` passthrough, fold the duplicated `LIVE_SLIDE_FOR_PRIMARY` into the shared
   module. All named in §1/§4; none block once decided.

**Bottom line:** Search is genuinely the right first surface — client contract matches,
ids are stable, #254 and #257 are already honoured. But the cutover is **not a pure route
swap**: it needs the §4 hydrate fix (shared code) and a real end-to-end verification first.
Sequence: fix hydrate + resolver test → TEST verify script green → thin-wrapper the route
behind an env flag → verify in TEST → hand to Adam.
