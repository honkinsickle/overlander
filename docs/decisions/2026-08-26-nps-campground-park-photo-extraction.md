# NPS campground + park photo extraction (2026-08-26)

## Context

NPS **place** records (`nps:place:*`) already had photos extracted at
ingestion via `npsPhotoFromImages(p.images)` in `normalizePlace()`, stored
on `source_record.normalized_payload.photo`, and surfaced by the corridor
RPC's `nps_photo_url` lateral join. Cards rendered these photos via
`BrowsePlace.photoUrl`. This pipeline was fully wired.

Two NPS record types were excluded:

1. **Campgrounds** (`nps:campground:*`) — `CampgroundSchema` did not parse
   `images`; `normalizeCampground()` did not set `photo`. The NPS API's
   `/campgrounds` endpoint returns images by default, so they were in
   `raw_payload` (via `.passthrough()`) but never promoted.

2. **Parks** (`nps:park:*`) — `ParkSchema` did not parse `images`;
   `persistParkBoundary()` did not set `photo`. The NPS API's `/parks`
   endpoint also returns images by default; `fetchPark()` didn't request
   `fields=images` (harmless since images come by default, but now
   explicit).

The backfill script (`data/scripts/backfill-nps-photo.ts`) only looked at
`raw_payload.place.images`, missing both record types.

## Decision

Extend photo extraction to all three NPS record types. No architectural
change — the existing pipeline (source_record → corridor RPC lateral →
`BrowsePlace.photoUrl` → card `backgroundImage`) handles them identically.

## Changes

- `CampgroundSchema` + `ParkSchema`: added `images` array parsing (same
  shape as `PlaceSchema`)
- `normalizeCampground()`: added `photo: npsPhotoFromImages(c.images)`
- `persistParkBoundary()`: added `photo: npsPhotoFromImages(park?.images)`
- `fetchPark()`: explicitly requests `fields=images` (belt-and-suspenders)
- `backfill-nps-photo.ts`: widened `desiredPhoto()` to check
  `raw_payload.campground.images` and `raw_payload.park.images`
- `normalizeCampground` exported for testing
- 2 new tests in `nps.test.ts` for campground photo extraction

## Measurements (TEST, 2026-08-26)

- 305 NPS source_records gained `normalized_payload.photo` (from 4,876 →
  5,181 total with photos)
- 192 master_place rows gained `photo_url` (from 7,360 → 7,443 with a
  resolvable photo across all sources)
- Corridor RPC verified: campground tiles now carry `nps_photo_url`
  (e.g. Jumbo Rocks, Hidden Valley, Sheep Pass in Joshua Tree corridor)
- Non-NPS POIs unaffected — they continue to render without photos (a
  different problem, out of scope)

## Licensing

NPS content is "generally considered in the public domain" per
nps.gov/aboutus/disclaimer.htm. Some photos carry third-party credits
(e.g. CC BY-SA); the `NpsPhoto` type already carries `credit` alongside
`url` and `altText` for this reason. The existing codebase already caches
NPS photo URLs (architectural precedent set by the original
`backfill-nps-photo.ts` and the corridor RPC lateral join).

## Consequences

- Future NPS ingestion runs will automatically extract photos for
  campgrounds and parks (no separate backfill needed)
- Trips generated after this change will have NPS campground/park photos
  baked into their stored tiles via `fetchCorpusForSegment` → corridor RPC
- Existing trips with baked tiles will NOT retroactively gain photos
  (their stored `segmentSuggestions` are snapshots); a re-generation or
  re-bake is needed for those
- PROD apply: the source_record backfill needs to run against PROD after
  the code merges (`npm run -w data backfill:nps-photo -- --confirm`),
  followed by `npm run -w data backfill:mp-enrichment -- --confirm`
