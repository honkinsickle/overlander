-- ============================================================================
-- master_place enrichment columns — step 1 of the place-data resolver
-- consolidation (docs/decisions/2026-08-21-place-data-resolver-consolidation.md).
--
-- WHY. The card-rendering layer currently branches on where a place came
-- from, because a federated (master_place-backed) row has nowhere to put a
-- rating even when a source has one. This migration removes the *structural*
-- reason for that branch by giving every master_place row a slot for each of
-- the five enrichment fields — nullable, explicitly NULL where no source has
-- the data. See §Decision item 1 of the ADR.
--
-- WHAT THIS ADDS — four columns. The ADR names five fields; `description`
-- ALREADY EXISTS on master_place (20260527120100_phase1_master_place.sql:29)
-- and is resolved by recompute_master_place() via field_precedence. It is
-- deliberately NOT re-added or altered here. See the "description" note at
-- the bottom of this header.
--
--   rating        numeric(2,1)  average rating on the 1.0–5.0 scale the web
--                               layer already uses (web/src/lib/discovery/
--                               types.ts:37 "Real average rating (1.0–5.0)").
--   review_count  integer       total user ratings backing `rating`
--                               (types.ts:41).
--   price_tier    smallint      1–4 ($–$$$$). Matches the existing web
--                               convention exactly — `priceTier?: 1 | 2 | 3 | 4`
--                               (types.ts:44, trip-browse/places.ts:62),
--                               produced by priceLevelToTier() in
--                               discovery/google-places.ts. A text/enum column
--                               was rejected because nothing in the codebase
--                               uses a textual price representation.
--   photo_url     text          a single display photo url.
--
-- Snake_case to match every other column on this table (source_count,
-- prominence_score, geometry_polygon, is_searchable, state). The camelCase
-- names in the ADR are the TypeScript-side names.
--
-- BACKFILL POPULATION — measured against TEST 2026-08-21 by a FULL SCAN of
-- every source_record for all ten source_ids in the corpus (data/scripts/
-- investigate-enrichment-fields-2026-08-21.ts) and a population count of the
-- affected master_place rows (data/scripts/measure-enrichment-backfill-scope-
-- 2026-08-21.ts):
--
--   photo_url     7,360 distinct master_place rows have a source photo
--                 (nps 4,690 · ridb 2,449 · blm 88 · state_parks 133 after
--                 precedence). Backfilled by 20260821070000.
--   rating        0 rows. NO ingested source carries a rating.
--   review_count  0 rows. NO ingested source carries a review count.
--   price_tier    0 rows. NO ingested source carries a price tier. (USFS
--                 fee_charged is Y/N, NPS fees[].cost is a dollar amount,
--                 OSM fee is yes/no — none is a 1–4 tier, and inferring one
--                 would be fabrication, which this corpus forbids.)
--
--   The three empty columns are still added. That is the point of the ADR:
--   the renderer stops needing to know whether a field *could* exist for
--   this row's provenance. A column that is NULL corpus-wide today reads
--   the same way as one that is NULL for this particular place.
--
-- ⚠ COMPLIANCE — READ BEFORE POPULATING rating / review_count / price_tier.
-- The only source known to this codebase that carries all three is Google
-- Place Details (`rating`, `userRatingCount`, `priceLevel`). Storing those
-- fields is PROHIBITED under Google Maps Platform's caching policy — only
-- place_id (indefinitely) and coordinates (30 days) have caching exceptions;
-- `rating` and `userRatingCount` are named explicitly as non-cacheable. See
-- docs/measurements/2026-08-20-google-places-details-compliance-check.md.
-- So these three columns exist to remove a render-time branch, NOT as a
-- destination for Google data. A future populate path must come from a
-- source whose terms permit storage.
--
-- description — WHY IT IS NOT TOUCHED HERE. The column exists and is owned
-- by recompute_master_place(). It is not fully populated relative to what
-- sources carry, but the cause is a field_precedence gap, not a missing
-- column: resolve_field() INNER JOINs field_precedence, so a source with no
-- `description` precedence row can never contribute one. Measured on TEST
-- 2026-08-21: `blm` and `atlas_oddities` have NO field_precedence rows at
-- all, and `state_parks` has 8 rows but none for description. That strands
-- 138 blm-linked and 95 state_parks-linked master_place rows whose source
-- carries a real description while master_place.description is NULL.
-- Seeding those precedence rows is a deliberate product decision (the
-- state_parks architecture spec §10a excluded description on purpose), so
-- it is REPORTED, not made here. Writing description directly onto
-- master_place from a backfill would violate the schema invariant ("never
-- write to master_place directly except via recompute_master_place()") and
-- would be erased by the next recompute anyway.
--
-- SAFETY. Pure additive DDL — four nullable columns with no default, so no
-- table rewrite and no existing row or query changes. No view, function, or
-- RPC references these columns yet.
--
-- ⚠ LOCKING — READ BEFORE ADAPTING THIS FOR PROD. The `add column` statements
-- are cheap (nullable, no default → catalog-only, no rewrite). The three
-- `add constraint ... check` statements are NOT: each takes an ACCESS
-- EXCLUSIVE lock and full-scans the table to validate the constraint against
-- every existing row. That was fine on TEST at its current size. **PROD's
-- master_place row count has NOT been measured — no claim is made here in
-- either direction about how long it would take.** If this migration is ever
-- adapted for PROD, add each constraint `NOT VALID` first (catalog-only,
-- brief lock) and run `ALTER TABLE ... VALIDATE CONSTRAINT ...` afterwards,
-- which takes only a SHARE UPDATE EXCLUSIVE lock and does not block reads or
-- writes. The columns are NULL on every existing row, so a NOT VALID
-- constraint has nothing to skip over — the two paths are equivalent in
-- outcome here, differing only in lock duration.
-- ============================================================================

set search_path = public;

alter table public.master_place
  add column if not exists rating       numeric(2,1),
  add column if not exists review_count integer,
  add column if not exists price_tier   smallint,
  add column if not exists photo_url    text;

-- Range guards. Each is null-permissive: NULL is the "no source has this"
-- value and must stay legal on every row.
--
-- ⚠ THESE RANGES ENCODE GOOGLE'S SCALES — rating 0–5 and price_tier 1–4, which
-- is what web/src/lib/discovery produces today (SourceResult.rating "1.0–5.0",
-- priceTier 1|2|3|4 from priceLevelToTier). The resolver-consolidation ADR
-- also names **Foursquare** as a live source, and Foursquare's public API
-- rates places on a **0–10** scale — a value this CHECK would reject. Nothing
-- in the codebase produces a Foursquare rating today
-- (web/src/lib/discovery/foursquare.ts carries no rating or price field), so
-- there is no live conflict. **Flagged as an open decision point for whoever
-- first populates these columns from Foursquare** — normalize to 0–5, widen
-- the constraint, or store a scale alongside the value. NOT resolved here.
alter table public.master_place
  drop constraint if exists master_place_rating_range;
alter table public.master_place
  add constraint master_place_rating_range
  check (rating is null or (rating >= 0 and rating <= 5));

alter table public.master_place
  drop constraint if exists master_place_review_count_nonneg;
alter table public.master_place
  add constraint master_place_review_count_nonneg
  check (review_count is null or review_count >= 0);

alter table public.master_place
  drop constraint if exists master_place_price_tier_range;
alter table public.master_place
  add constraint master_place_price_tier_range
  check (price_tier is null or price_tier between 1 and 4);

comment on column public.master_place.rating is
  'Average user rating on the 1.0-5.0 scale used by web/src/lib/discovery (SourceResult.rating). NULL = no source carries a rating for this place; NULL is the corpus-wide value as of 2026-08-21 because no ingested source has ratings. NOT a destination for Google Place Details ratings — storing those is prohibited (docs/measurements/2026-08-20-google-places-details-compliance-check.md).';

comment on column public.master_place.review_count is
  'Total user ratings backing master_place.rating. NULL = no source carries one. Same compliance constraint as rating.';

comment on column public.master_place.price_tier is
  'Price tier 1-4 ($-$$$$), matching web SourceResult.priceTier. NULL = no source carries one. USFS fee_charged (Y/N), NPS fees[].cost (dollar amount) and OSM fee (yes/no) are deliberately NOT mapped here - none is a tier and inferring one would be fabrication.';

comment on column public.master_place.photo_url is
  'Single display photo url resolved from the linked active source_records (nps > ridb > blm > state_parks). NULL = no linked source carries a photo. SNAPSHOT, not recompute_master_place()-owned - populated by backfill_master_place_photo_url() (20260821070000) and NOT refreshed when a source is deactivated. Same staleness class as master_place.state; see that migration header.';
