# 2026-08-28 — editorial_food: multi-publisher road-trip food source

## Context

Extends the pattern from
[`docs/decisions/2026-08-28-family-destinations-test-only-editorial-source.md`](./2026-08-28-family-destinations-test-only-editorial-source.md)
(single publisher — `family_destinations`) to a fleet of California
road-trip food articles from different publishers.

Adam identified 7 candidate URLs and asked for the full AO-parity
pipeline again. Discovery pass fetched 5 of the 7 cleanly:

- beyondthejourney.net — 21 rows, ~100-word descriptions, per-stop photos
- familyvacationsus.com — 16 rows, ~80-word descriptions, no photos
- altaonline.com (Alta Journal) — 5 rows, ~40-word descriptions, per-stop photos
- provokelifestyle.in — 27 rows, very short blurbs, mostly no photos
- everafterinthewoods.com — 11 rows, 100+-word descriptions, per-stop photos

Two failed to fetch (HTTP 403):

- latimes.com — LA Times blocks scrapers; would need an authenticated fetch path
- tasteatlas.com/california — Cloudflare bot protection; also a different data
  shape (taxonomy of California dishes, not restaurants)

## Decision

**Single new source `editorial_food`, multi-publisher.** Chosen over
per-publisher source IDs (which would have cost 5 × 3 = 15 migrations
vs. this option's 3) or extending `family_destinations` (name mismatch:
FDG is one publisher, `editorial_food` scales to any curated food list).

Data shape:
- **`source_id`**: `editorial_food`
- **`external_id`**: `editorial_food:<publisher_slug>:<article_slug>:<row_slug>`
  — three levels of scoping so future articles from the same publisher
  (or re-scrapes) don't collide.
- **`inferred_category`**: `restaurant`. All current rows are
  restaurants. If a future article covers non-restaurant stops
  (bakeries, groceries, farm stands), derive per-row.
- **`source_quality_score`**: 0.35 — one notch below `family_destinations`
  (0.4). Editorial road-trip lifestyle blogs across multiple publishers
  are medium-confidence; individual articles vary widely in editorial
  depth.
- **`normalized_payload`**: description (verbatim article prose), photo
  `{url, credit: <publisher_slug>}`, address (from geocode), signature
  dish, article metadata (`article_url`, `article_author`, `article_date`,
  `publisher_slug`, `article_slug`).
- **`overlander_tags`**: `["editorial_food", <publisher_slug>,
  <article_slug>, ...signature-dish tokens]`. Downstream filters can
  slice by publisher or article.

Pipeline pieces built:
- **Fetch → extract** for each URL via WebFetch.
- **Geocode** in `.context/editorial-food/geocode.ts` (multi-CSV loop,
  same Mapbox two-phase strategy — city geocode → proximity POI —
  with manual overrides for known-wrong hits).
- **Per-article CSVs** in `.context/editorial-food/`:
  `<publisher_slug>__<article_slug>.csv` (raw) and
  `<publisher_slug>__<article_slug>-geocoded.csv` (enriched with lng/lat).
- **Ingester**: `data/ingestion/sources/editorial-food.ts`. Globs all
  `*-geocoded.csv` files in the CSV dir.
- **Registered** in `manual.ts` as `--source editorial_food`.
- **Migrations** (TEST only):
  - `20260828120000` — `field_precedence` row
    `('description', 'editorial_food', 8)` (priority 8, one below
    family_destinations); extends `backfill_master_place_photo_url()`
    precedence chain.
  - `20260828120100` — `pois_along_corridor` photo lateral extension.
  - `20260828120200` — `master_place_search_export` view photo lateral
    extension.

## Consequences

- **TEST run outcome (queried this session):**
  - **80 raw rows across 5 CSVs; 71 with coordinates (89%); 9 skipped
    at geocode-time** because Mapbox POI didn't return a match and I
    didn't hand-override them (Clearman's/La Mirada, Marin Sun Farms,
    El Galleon/Catalina, Jocko's/Nipomo, Outpost Cafe, Lola's Kitchen,
    Corizón Cocina, Squeeze Burger, Moto Deli).
  - **Harris Ranch was hand-overridden** — Mapbox POI returned a
    Cincinnati Ohio address on both articles mentioning it. Real
    address is at the I-5/CA-198 junction in Coalinga.
  - **Ingest: 71 rows written, 0 errors.**
  - **Materialize** (`--only-categories restaurant --skip-sync` at
    `ER_APPLY_BATCH_SIZE=25`): 55 new_master_places, 16 manual_review,
    0 errors. The manual_review rows include Peggy Sue's, Nepenthe,
    Alien Fresh Jerky, and 13 others — names that ER couldn't
    confidently auto-link to (either due to entity name collisions
    with existing corpus rows, or the cross-article dedupe threshold).
  - **`backfill_master_place_photo_url`** on the 55 linked mp_ids:
    25 rows changed. The 30 with no photo_url delta are either
    photo-less articles (familyvacationsus, provokelifestyle) or
    mp rows already carrying a higher-priority photo.
  - **`search:sync`** corpus-wide against `places_test`: 32,809 docs
    total, 0 failed.

- **Live-verify PASSED across 4 sample corridors** (Malibu → LA,
  Big Sur ↔ Coalinga, Mojave desert, Central Coast) — every corridor
  returned `editorial_food` rows with clean descriptions and (mostly)
  photos. Harris Ranch surfaces on the Big Sur ↔ Coalinga route via
  the manual override.
- **Live-verify on Typesense `places_test` across 10 name probes**:
  **7/10 return an `editorial_food`-tagged document.** The 3 misses
  (Peggy Sue's, Nepenthe, Alien Fresh Jerky) are all in
  `manual_review` — their source_records exist on TEST but weren't
  linked to a master_place, so they don't appear in the search-export
  view.

- **Cross-source overlap (measured this session)**:
  - 3 rows match `family_destinations` rows from PR #316 by
    name+city+coord — Duarte's Tavern (Pescadero), Gott's Roadside
    (St. Helena), Nepenthe (Big Sur). ER should have auto-linked them
    to the existing family_destinations master_places, but instead
    created new master_places. Not investigated this session; may
    reflect an ER threshold or a name-normalization step. Filed in
    BACKLOG.
  - Cross-article dedupes within `editorial_food` itself: Duarte's,
    Gott's, Nepenthe, Harris Ranch, Ikeda's, Pann's, Pea Soup
    Andersen's (different city — real dupe not a chain), In-N-Out
    (different cities — chain), Marshall Store. Each mentioned in 2–3
    articles.

- **Licensing posture**: TEST-only. Same as the AO and
  family_destinations sources. Photo credits use the publisher slug
  (e.g. `beyondthejourney`) rather than the original photographer —
  the everafter and altaonline articles cite Google Maps user photos
  and hearstapps CDN URLs without explicit photographer attribution.
  If any of this ever heads toward PROD, the credit strings need a
  real-photographer resolution step.

- **Runbook note re-confirmed**: `db:push-verify -- --test` hangs on
  the interactive `[Y/n]` prompt when stdin isn't piped. Confirmed
  again this session; the `echo y |` prefix from the family_destinations
  session is the working pattern.

- **Not in scope**:
  - LA Times (403) and TasteAtlas (403 + wrong data shape) — dropped.
  - PROD promotion of `editorial_food` — the runbook mirrors AO's
    from PR #314 §Part 2 if ever authorized.
  - Manual review triage of the 16 unlinked rows.

## Reversal

If rejected: `UPDATE source_record SET is_active = false WHERE source_id
= 'editorial_food'` on TEST, recompute affected master_places, rerun
`backfill_master_place_photo_url` on their ids to clear photos, and
rerun `search:sync` to prune the Typesense docs. Same clean-subtractive
posture as AO and family_destinations. The 3 migrations can stay
applied (additive) or be reverted by restoring the prior view/RPC/
precedence definitions.
