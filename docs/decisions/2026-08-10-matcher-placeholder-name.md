# 2026-08-10 — Matcher zeroes name_similarity for fabricated placeholder names

[PR #200](https://github.com/honkinsickle/overlander/pull/200). Fixes an entity-resolution
defect where fabricated "no name" strings collided at perfect name similarity and
pinned distinct dispersed sites into `manual_review` at the exact 0.600 floor.

## Context

OSM's `inferName` (`data/ingestion/sources/osm.ts`) fabricates `"Unnamed <category>"`
when a node carries no `name` / `name:en` / `brand` tag — so a BLM dispersed loop of
distinct pins all ingest as `"Unnamed dispersed camping"`. A small set of community
designations (`"Designated Campsite"`, `"Designated Walk-In Campsite"`, `"Campsite"`)
are placeholders in the same way — a category, not an identity.

`scoreMatch` blends `combined_confidence = 0.4 × distance_score + 0.4 × name_similarity
+ 0.2 × category_compatibility` `[read: entity-resolution/matcher.ts]`. Two identical
fabricated strings score `jaroWinkler = 1.0`, and same-category (`dispersed_camping ↔
dispersed_camping`) scores `1.0`. For any pair **more than ~100 m apart**
`distance_score = 0`, so the blend **clamps at exactly `0.4·0 + 0.4·1.0 + 0.2·1.0 =
0.600`** — which is precisely the `manual_review` floor. Every placeholder-collision
pair therefore queued for human review even at 200–400 m separation, where the pins are
clearly distinct sites.

**Measured 2026-08-10** on the UT camping ingest (2,176 fresh rows): **945 → `manual_review`
= 43%**; 22 of 30 sampled rows pinned at conf 0.600; 27 of 30 carried identical
`"Unnamed dispersed camping"` / `"Designated Campsite"` names on both sides.

## Decision

`isPlaceholderName(name)` returns true for a null/empty name, any `"unnamed "`-prefixed
name, or a name in `PLACEHOLDER_NAME_ALLOWLIST`. `scoreMatch` **forces `name_similarity = 0`
when EITHER side is a placeholder**, rather than comparing the two fabricated strings.

- **Why zero for a fabricated name.** `"Unnamed dispersed camping"` carries no identity
  signal — it is the *absence* of a name rendered as text. Two such strings being
  byte-identical is an artifact of the fallback, not evidence the two rows are the same
  place. Scoring their similarity at 1.0 is scoring noise as signal.
- **Why placeholder-vs-real also scores 0** (not just placeholder-vs-placeholder). If
  either side lacks a real name there is nothing to compare on the name axis, so the
  whole name term is zeroed. A real `"Willow Flat"` against a fabricated `"Unnamed
  campground"` must not earn name credit for a coincidence of the fallback; the match, if
  any, has to come from distance and category.
- **Downstream routing is intended, not incidental.** With `name_similarity = 0`:
  same-source placeholder pairs fall below 0.6 → `new_master_place` (correct for distinct
  pins in a loop); cross-source close pins (`distance ≤ 100 m`, `category ≥ 0.8`) instead
  satisfy the pre-existing `close_nameless` guard and auto-link there — the path built for
  exactly "two unnamed things on top of each other from different sources."

## Consequences

- **`manual_review` 43% → 3.6%** on the WA/OR/NV re-measure — a 12× reduction; the residual
  is genuine named-site ambiguity a human should see, not placeholder noise. Later PROD
  per-state runs: **AZ 4.4%, CA 8.33%** (CA's higher rate is real-named density and is
  itself backlogged as unexplained). 9 new tests; regression guard confirms real-name pairs
  are unchanged (`Willow Flat ↔ Willow Flat` at 60 m still scores 0.70 exactly).
- **The 521 already-mislabeled TEST reviews were repaired by a targeted rewrite, NOT
  `--rematerialize`.** The fix corrects the matcher going forward, but rows already queued
  under the old score stay queued. Rematerialize was rejected: it reprocesses the whole
  corpus (violates the additive-only rule), is expensive, and would **destroy the 424
  legitimate pre-existing reviews** that had nothing to do with the placeholder collision.
  Instead `apply-placeholder-rewrite.ts` (#201) applied 521 `new_master_place` outcomes
  through the standard `apply_match_outcomes` RPC, idempotency-guarded (proceeds only when
  the SR is still unlinked and the pending `place_match` still exists), preserving all 424
  legitimate reviews **byte-identical** across every `place_match` field (verified against a
  pre-flight snapshot), and fully reversible via `undo-placeholder-rewrite.ts` with a durable
  mapping. Applied to TEST only.
- **Orthogonal defect left open:** cross-category `amenity_rollup` merges (a real-named
  `"Belle Toilets"` auto-linking to `"Belle Water"` at 20 m) share the close-pin shape but
  are not addressed by zeroing placeholder names — tracked in `BACKLOG.md`.
