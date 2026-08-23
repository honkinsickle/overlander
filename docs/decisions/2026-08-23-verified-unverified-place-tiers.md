# Verified / Unverified place tiers

Date: 2026-08-23

## Context

The Search and day-corridor browse surfaces apply different membership rules to
the corpus. The corridor RPC (`pois_along_corridor`, migration
`20260821050000`) excludes template-only descriptions and `needs_review` rows;
the Typesense search-hydrate path does not. A place can be corridor-invisible
and search-visible. This was flagged as D2 in
`docs/architecture/resolve-places-design.md` and left unresolved.

The inconsistency is replaced by a single concept: every place is either
Verified or Unverified, and the distinction is applied uniformly across all
surfaces.

## Definitions

**Verified** — a place has EITHER:
- a real source description (`description_source = 'source'` on
  `master_place_search_export`), OR
- an LLM-generated description (`description_source = 'llm'`, per the
  eligibility ADR `2026-08-23-llm-description-suggestion-eligibility.md`).

Live-sourced places (from Google, Foursquare, etc.) are always Verified.

**Unverified** — anything else:
- template-only description (`description_source = 'template'`)
- `needs_review = true`
- no description at all (`description_source` is null)

## Rules

1. **Visibility.** Both Verified and Unverified places are visible on every
   surface (Search, Day Detail, Day Column, day-scoped browse). No surface
   hides Unverified places entirely. This replaces the current inconsistency.

2. **Sort order.** Unverified places sort strictly after all Verified places,
   in every result set, on every surface. The existing sort logic (distance,
   relevance, prominence) is the secondary key within each tier.

3. **Suggestion eligibility.** Unverified places are never proactively
   suggested or auto-recommended as trip stops (`pois_along_corridor` and any
   future auto-suggest path). They are fully addable when a user manually
   searches for and selects one.

4. **Single source of truth.** The logic lives in `resolvePlaces()`
   (`web/src/lib/places/resolve-places.ts`) — not duplicated into the old
   per-surface endpoints. The `BrowsePlace.verified` field carries the tier
   through to any consumer.

## Interaction with existing decisions

- **LLM eligibility ADR** (`2026-08-23`): LLM descriptions count as Verified,
  matching the ADR's "LLM-only places are not excluded from trip-stop
  suggestion." Template-only places remain Unverified, matching the ADR's
  template exclusion.
- **D2 (resolve-places-design.md)**: This resolves D2. The three-door
  membership divergence is replaced by a single tier computed once and applied
  everywhere.

## Consequences

- `BrowsePlace` gains an optional `verified: "verified" | "unverified"` field.
- `resolvePlaces()` computes the tier from `description_source` (for federated
  places, surfaced via Typesense search results) and stamps it on every place.
- `SearchResult` now carries `description_source` from the Typesense index.
- `sortByVerificationTier()` and `isSuggestable()` are exported for any
  consumer that needs to apply the rules.
- This is implemented inside `resolvePlaces()` only; the old per-surface
  endpoints are NOT modified. The tier takes effect when surfaces cut over to
  `resolvePlaces()` (ADR step 3, a separate decision).
- Day-corridor scope: federated places from the `pois_along_corridor` RPC do
  not currently carry `description_source`, so corridor-scoped federated
  results have no `description_source` signal and default to Unverified. This
  is conservative and correct until the RPC is updated to surface the field.
