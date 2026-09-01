# 2026-09-01 — Photo-backfill pilot: staging table, license-clear sources, not-yet-wired

## Context

The photo-scoping investigation (same day) found that day-detail STOPS cards
(`category-list-card.tsx` / `day-detail-corridor-column.tsx`) render a real
photo only when `photoUrl` is baked from a photo-eligible source_record
(`{nps, ridb, wikipedia, atlas_oddities, family_destinations, editorial_food}`
carrying `normalized_payload.photo.url`) or live-hydrated via a Google
`placeId`. Measured coverage: ~30% of the 35,474 searchable POIs have any
photo; `campground` sat at ~22%. The gap is data availability, not wiring.

This ADR covers the follow-on pilot: search **license-clear** sources for
photos of **CA `campground`** master_place rows that have zero coverage today,
and stage the results for review. Pilot-scale, reversible, TEST only.

## Decisions

**1. Store candidates in a new table (`master_place_photo_candidate`), not on
`master_place` and not as a `source_record`.**

- `master_place` columns are precedence-resolved source-of-truth written only
  via `recompute_master_place()`. An unreviewed candidate is neither, so it
  must not live there.
- The existing photo backfill (`backfill-wikipedia-photo.ts`) upserts a
  `wikipedia` source_record with `normalized_payload.photo`. The corridor RPC's
  photo lateral join reads that source, so that path **auto-wires** the photo
  onto cards on the next read. The pilot's requirement is the opposite: stage,
  don't surface. A dedicated table the read path does not touch makes the
  "staged, not live" boundary structural rather than a naming convention —
  the same reasoning that put generated descriptions in
  `master_place_generated_content` rather than a column.
- The table captures full provenance per candidate: `image_url`, `source`,
  `license` + `license_class` + `license_url`, `attribution`,
  `source_page_url`, plus match signals (`match_status`, `match_confidence`,
  `name_score`, `distance_m`, `match_reason`) and a `raw` jsonb for audit.
  `match_status ∈ {accepted, manual_review}` (rejected/not-found are counted,
  not stored). RLS enabled, zero policies (service-role only), same posture as
  `source_record` / `master_place` / `master_place_generated_content`.

**2. DELIBERATE STOP POINT — nothing is wired into rendering.** The corridor
RPC, `master_place_search_export`, and `category-list-card.tsx` do not read
`master_place_photo_candidate`. Promoting a reviewed candidate to a live read
path (either promote accepted rows into a `source_record`, or teach the RPC to
read this table) is a separate, explicitly authorized step, taken only after
pilot quality is reviewed.

**3. License-clear sources only.**
- Implemented: **Wikimedia Commons** (File-namespace geosearch + name text
  search; CC-BY / CC-BY-SA / CC0 / public-domain via `extmetadata`) and the
  **NPS API** campgrounds endpoint (public-domain agency media; images credited
  to a non-NPS third party are routed to manual_review, not accepted).
- Excluded by design (see Consequences for the flag): USFS / BLM / CA State
  Parks own-site media, Google Images/Places, Yelp, TripAdvisor, Instagram, and
  any NC/ND-licensed image.

**4. Conservative matching; ambiguity → manual_review, never a guess.** A
candidate is `accepted` only with BOTH a strong name-token match AND a tight
geographic proximity (and a clear license). Geographically-plausible-but-weak-
name, name-match-with-no-verifiable-coordinate (text search), and moderate
signals all route to `manual_review`. Thresholds (documented in
`data/photo-backfill/matcher.ts`) are pilot-chosen and strict; tune after
review.

**5. Scope held to the named `campground` primary_category and `state = 'CA'`.**
`dispersed_camping` (a separate primary_category) and campground rows with a
null `state` are excluded — flagged below rather than silently folded in.

## Consequences

- Reversible: `drop table master_place_photo_candidate;` removes the pilot with
  no effect on any read path.
- **Flagged deviations from the task's named scope** (implemented as named where
  feasible; concerns recorded, not silently dropped):
  - USFS / BLM / CA State Parks "own-site media" have **no queryable
    license-clear photo endpoint** — their ArcGIS feature services carry
    geometry/attributes, not photo URLs; harvesting would require per-page
    scraping of agency websites, out of pilot scope. RIDB (recreation.gov) media
    IS an API but RIDB is already a wired photo source and its key returned 401
    at session start.
  - `dispersed_camping` and null-`state` campgrounds are outside the named CA
    `campground` scope; the enumeration reports them so the boundary is visible.
- A follow-up decision is required before any of these photos appear to users:
  review manual_review + accepted rows, choose a promotion mechanism, and
  authorize it (TEST first, then PROD). Tracked in BACKLOG.

**Update 2026-09-01 (post-self-audit).** Six issues found in a self-audit were
fixed and the pilot re-run deterministically (`pilot_run` label `-fixed`; prior
rows deleted): title-anchored auto-accept (description-substring demoted to
manual_review), PD-* license recognition, NPS map/diagram/sign filtering, NPS
proximity no longer counting as a candidate without passing the bar,
geosearch-vs-text provenance in `source`, and stable `.order("id")` pagination
(the earlier target-count wobble was unordered-pagination skip/dup, not view
instability). Accepted images were visually inspected. Thresholds remain
pilot-chosen; residual gaps (Commons sign/map filter, distant-loose accepts,
manual_review volume) are in BACKLOG.

**Update 2026-09-01 (Google-verified auto-adjudication).** Manual eyeballing was
replaced by an automated vision comparison. Migration `20260901000700` adds
`google_verdict` / `google_confidence` / `google_reasoning` / `google_ref_source`
/ `google_checked_at`, and widens `match_status` to allow `rejected`. For every
stored candidate a LIVE Google reference photo (Places API New: text search →
photo media) is compared against the stored candidate photo by Claude
(`claude-opus-5`, structured verdict). Classification: `match` → `accepted`,
`no_match`/`ambiguous` → `rejected` (conservative default). "Couldn't verify"
cases are held apart, not rejected: `no_google_result` (Google has no matching
place/photo) and `unverified` (API/vision error after retries, or no coordinate)
both **leave `match_status` unchanged**.

**Compliance boundary (non-negotiable, per "Google Places — live-fetch-at-render
is compliant; warehousing is not"):** the Google reference image is fetched into
process memory, sent to the vision API for the single comparison, and discarded.
**No Google image bytes, photo URL, or place/photo identifier is written to any
table or file** — only the model's verdict/confidence/reasoning and a generic
`google_ref_source` label. `data/photo-backfill/google-reference.ts` performs no
writes; the driver's DB patch contains only verdict columns. This remains
un-wired into rendering; promotion is still a separate authorized step.

**Update 2026-09-01 (NPS-direct, first-party accept).** For NPS-sourced rows,
NPS is authoritative for its own units, so a correctly-matched NPS image is
accepted directly — no Google cross-check, no manual_review. Match is by the
structured `nps:campground:<id>` captured in `external_id` (not fuzzy). Migration
`20260901000800` adds `match_status='no_candidate'` and makes `image_url`
NULLABLE so a "no usable image" outcome (all images non-photo, or the unit no
longer resolves upstream) is recorded rather than silently skipped. Accepts carry
`license='Public domain (U.S. Government work, NPS)'` with the NPS credit as
attribution. Still un-wired.
