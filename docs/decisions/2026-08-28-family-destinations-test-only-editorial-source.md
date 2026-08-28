# 2026-08-28 — Family Destinations Guide: test-only editorial source

## Context

Adam identified Family Destinations Guide (`familydestinationsguide.com`) as
a candidate editorial-content source in the same shape as Atlas Obscura
(landed on PROD across PRs #309 → #315). His first suggestion was Visit
California's own road-trip article; scoping showed that dataset has no
per-stop photos and terse blurbs, so we switched to a longer-form Family
Destinations Guide piece with rich per-stop descriptions and embedded
per-stop imagery.

The article used for this test run:
`https://familydestinationsguide.com/foodie-road-trip-california/` —
"California Foodie Road Trip: 14 Iconic Stops" by Lyam Lavigne (published
2025-01-22). 14 restaurants across California; each with ~100 words of
editorial description, a signature dish, and 2 per-stop photos.

Adam's directive: **test content, not for commercial use.** Same posture
as the earlier Atlas Obscura ingest.

## Decision

**Ingest Family Destinations Guide articles as a new `family_destinations`
source, TEST-only.** Design mirrors `atlas_oddities` end-to-end so future
articles land through the same code path.

Data shape:
- **`source_id`**: `family_destinations`.
- **`external_id`**: `family_destinations:<article-slug>:<row-slug>`. The
  article slug is embedded so a future ingest of a second article can't
  collide with this one.
- **`inferred_category`**: `restaurant`. All 14 rows in the first article
  are restaurants; if a future article covers non-restaurant stops
  (bakeries, groceries, farm stands), extend the ingester to derive
  per-row rather than hardcode.
- **`source_quality_score`**: 0.4 (below Atlas Obscura's 0.5 — Family
  Destinations Guide is a lifestyle blog, not a curated database).
- **`normalized_payload.description`**: the article's editorial prose,
  verbatim. Family Destinations Guide's prose is markdown-free per the
  scraped sample; no converter needed (unlike AO, which required PR
  #314's markdown → plain text step).
- **`normalized_payload.photo`**: `{ url, credit: "familydestinationsguide.com" }`.
  Photo URLs point at the article's own CDN
  (`images.familydestinationsguide.com`), same source as the article
  images.
- **`overlander_tags`**: `["family_destinations_guide", "<article-slug>",
  ...signature-dish tokens]`. The article slug tag lets future filters
  slice by article.

Pipeline pieces built:
- **Fetch → extract → geocode** in `.context/family-destinations-guide/`:
  `geocode.ts` fetches Mapbox POI coordinates for each row (city geocode
  → proximity-biased Search Box POI lookup → hand-override for the 2
  rows Mapbox misgeocoded). Not part of the ingest — the ingester reads
  the resulting `*-geocoded.csv` file.
- **Ingester**: `data/ingestion/sources/family-destinations.ts` (parses
  `*-geocoded.csv` files from
  `.context/family-destinations-guide/`, upserts as `source_record`
  under `source_id = 'family_destinations'`).
- **Registered** in `data/ingestion/manual.ts` as
  `--source family_destinations`.
- **Migrations** (TEST only):
  - `20260828110000_family_destinations_description_photo_precedence.sql`
    — adds `field_precedence` row `('description',
    'family_destinations', 7)` (below atlas_oddities' priority 6) and
    extends `backfill_master_place_photo_url()` precedence chain to
    include `family_destinations` at position 7.
  - `20260828110100_pois_along_corridor_family_destinations_photo.sql`
    — extends the corridor RPC's photo lateral to include
    `family_destinations`.
  - `20260828110200_master_place_search_export_family_destinations_photo.sql`
    — extends the search-export view's photo lateral to include
    `family_destinations` (so /search hits carry the FD photo).
- **Materialize path**: `npm run -w data materialize -- --only-categories
  restaurant --skip-sync` — same fail-closed pattern AO used with
  `--only-categories oddity`.
- **Typesense sync**: standard `search:sync`, corpus-wide.

## Consequences

- **TEST run outcome**: 14 rows ingested, 13 auto-linked to new
  master_places, 1 in manual_review (Nepenthe — collision with an
  existing entry). Live-verify passed on 5 sample corridors (San Diego,
  Central Coast, LA, Napa, Chico) and 9 of 10 name probes against the
  places_test Typesense collection. Nepenthe triage is a follow-up.
- **PROD**: not touched by this test run. The 3 migrations, the
  `field_precedence` row, and all row-level writes are TEST-only. If we
  decide to promote, the runbook is identical to the AO one
  (PR #314 §Part 2) — CLI relink + env swap + apply migrations + run
  ingester + materialize + PR #315-style corpus-wide search:sync.
- **Licensing posture**: same as AO's — TEST content, not commercial. The
  Family Destinations Guide article's photos are hotlinked user-generated
  content (Google Maps contributor profiles, Yelp user profiles per the
  photo credits) rehosted on the article's CDN; this is dodgy licensing
  and would need a distinct conversation before PROD promotion. See the
  earlier AO no-fetch decision doc (superseded 2026-08-27 for AO; the
  same test-content posture applies here) for the pattern.
- **Photo credits**: chose `familydestinationsguide.com` as the credit
  string (naming the aggregator, not the original photographer) because
  the original credits are user-profile URLs, not names. If we ever
  promote this, revisit — the individual Google Maps / Yelp contributors
  are the real photographers.
- **Adjacent, not caused by this work**: the `restaurant` primary_category
  is now well-populated on TEST for the first time (~20 new master_places
  from a corpus-wide materialize sweep of previously-unresolved
  restaurant records — a byproduct of scoping materialize to
  `--only-categories restaurant`). All good.

## Reversal

If the test run is rejected: `UPDATE source_record SET is_active = false
WHERE source_id = 'family_destinations'` on TEST, recompute affected
master_places, rerun `backfill_master_place_photo_url` on their ids to
clear photos, and rerun `search:sync` to prune the Typesense docs. Same
clean-subtractive posture as AO's rollback plan (PR #310 §4). The 3
migrations can stay applied on TEST (additive) or be reverted by
restoring the prior view/RPC/precedence definitions.
