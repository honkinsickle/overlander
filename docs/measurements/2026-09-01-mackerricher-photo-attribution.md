# MacKerricher State Park — missing photo attribution (live on PROD)

**Date:** 2026-09-01 · **Type:** read-only investigation, PROD + TEST · **Nothing modified.**
**Scripts:** `data/scripts/investigate-mackerricher-photo-2026-09-01.ts`,
`data/scripts/investigate-mackerricher-baked-tile-2026-09-01.ts` (both read-only,
hard-guarded on project ref).

## TL;DR

The photo on the "MacKerricher State Park" card is a **live Google Places
photo**, fetched at render time via `/api/places/details` → `/api/places/photo`.
It shows with **no attribution because the code never captures Google's
`authorAttributions`** — a rendering/capture gap, not an ingested-image gap.

This is **NOT** the ingested `state_parks` corpus photo and **NOT** a violation
of the corpus "license-clear-only" rule. **No photo was ingested from
parks.ca.gov / California State Parks — zero.** The corpus `master_place` rows
for MacKerricher carry no photo of any kind.

The live exposure is a **Google Places Platform attribution-display gap**: Google
permits displaying Place Photos *provided you display the photo's
`authorAttributions`*. The app fetches the photo and drops the attributions.

## What is actually on the card (PROD)

The card titled **"MacKerricher State Park"** is a baked **Google-resolved LLM
key-stop tile** inside PROD user trip `63634fd5-203c-43b1-b61a-35d286c1ccc2`:

- `title: "MacKerricher State Park"`, `category: scenic`, `sourceId: null`
- `placeId: "ChIJrSiZmdI0gIARBI706DgDanc"`
- **`photoUrl: null`, `photoCredit: null` baked** — tile keys include
  `curated`, `keyStopNote`, `placeInfo` (LLM key-stop shape).

Because the tile has a `placeId` but no baked `photoUrl`, the client hydrates it:
`web/src/components/trip/day-detail-corridor-column.tsx:308-351` collects every
tile matching `t.placeId && !t.photoUrl`, POSTs the ids to `/api/places/details`,
and grafts the returned `PlaceRich.photoUrl` onto the tile. MacKerricher matches
that filter exactly.

`placeDetails()` (`web/src/lib/discovery/google-places.ts`) requests the `photos`
field but extracts **only `photos[0].name`** to build
`/api/places/photo?ref=<name>`. The `GooglePlace.photos` type is literally
`Array<{ name: string }>` — so `authorAttributions` are structurally discarded,
and `PlaceRich` has no credit field. `photoCredit` is only ever populated from
CC-licensed **federated** sources (`row.photo_credit` in the corridor RPC /
`pois_along_corridor`), never from the Google live path.

The name is the tell: the corpus rows are "MacKerricher SP" and "MacKerricher
Walk-in Camp"; the Google-resolved tile is "MacKerricher State **Park**".

> Grounding note: confirmed by code trace + payload/data reads, not by a live
> browser render — the trip is an RLS-scoped user trip and rendering it would
> need that owner's session. Adam independently confirmed the photo is visible
> on PROD.

## Corpus lineage (answers task items 1, 3, 4)

MacKerricher on **PROD** `master_place` — 2 rows, both `state_parks`-only:

| id | canonical_name | category | source_count | photo_url col | export-view photo | google id |
|---|---|---|---|---|---|---|
| `888cbf9c…` | MacKerricher Walk-in Camp | campground | 1 | null | null | none |
| `8e49fcc7…` | MacKerricher SP | recreation_area | 1 | null | null | none |

Both link a single `state_parks` source_record each
(`state_parks:CA:campground:GIS0006612`, `state_parks:CA:park:146`) from the CA
ArcGIS Campgrounds / ParkBoundaries feature services via
`data/ingestion/sources/state-parks.ts`. Neither raw payload carries an
`Imagelink` / `PHOTO_LINK` / `photo` at all (props keys measured:
`FID,TYPE,GISID,DETAIL,SUBTYPE,UNITNBR,GlobalID,UNITNAME,Campground,WHAT3WORD_ADDRESS`
and `FID,GISID,SUBTYPE,UNITNBR,GlobalID,UNITNAME,Shape__Area,Shape__Length`).

**TEST** shows the same lineage (plus a third `public_land` shell
`source_count=0`, and a `generated_template` description source). No photo on any
TEST row either.

**Task item 4 (BLM/state_parks unmapped photo fields thread):** the thread is
real — migration `20260821070000_backfill_master_place_photo_url.sql` documents
that `state-parks.ts`/`blm-rec.ts` never map `Imagelink`/`PHOTO_LINK` into
`normalized_payload`, so the render laterals (which read
`normalized_payload.photo.url` for a hardcoded source list that **excludes
state_parks and blm**) never surface them. **MacKerricher is not affected** — its
records carry no image field to map.

## Were any photos ingested from parks.ca.gov? (measured, PROD)

**No.** Of 1,736 `state_parks` source_records:

- CA records: **572, of which 0 carry an `Imagelink`.** parks.ca.gov
  contributed **zero** photos.
- non-CA records: 428, of which **59 carry an `Imagelink`, all pointing at
  `parks.wa.gov`** (Washington State Parks). Hosts: `{parks.wa.gov: 59}`.

`master_place.photo_url` (the backfilled snapshot column, non-null on **7,223**
PROD rows) by host: `nps.gov 2734`, `atlasobscura 2784`, `cdn.recreation.gov
886` (ridb), `wikimedia 747`, **`parks.wa.gov 70`**, **`parks.ca.gov 0`**.

So ~59–70 **Washington** State Parks images are hotlinked into the non-rendered
`photo_url` column with **no attribution/license metadata captured**. They are
**not currently displayed** (the render laterals exclude state_parks), so this is
latent, not a live exposure. (The 59-vs-70 gap is unreconciled — likely
inactive/changed records; not chased.)

## The two distinct issues

1. **LIVE on PROD — Google Places photo shown without `authorAttributions`.**
   Affects every card that live-hydrates a Google photo (any `placeId` tile with
   no baked photo, and the `google_place_id` corridor path), not just
   MacKerricher. Compliance concern under Google's Places Platform policy. Fix is
   a capture+display change: request/keep `photos.authorAttributions`, thread a
   credit through `PlaceRich` → tile → card. **Not implemented — report only.**

2. **LATENT — WA State Parks images hotlinked into `photo_url` with no
   attribution.** Stored, not rendered. Same root cause as the corpus
   attribution posture; decide alongside the `field_precedence` photo wiring
   question that is already parked.

## Not done (per task)

Nothing removed or modified. No app code, no data, no schema, no PROD write. Env
never swapped — PROD read via `--env-file` against the prod backup only.
