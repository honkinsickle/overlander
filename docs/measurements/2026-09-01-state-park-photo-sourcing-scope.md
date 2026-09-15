# State park photo sourcing — six-state scope (CA/AZ/NV/UT/WA/OR)

**Date:** 2026-09-01 · **Type:** enumerate-before-measure scope, then per-state
licensing research · **Nothing built or ingested.**
**Follow-on to** the MacKerricher investigation (PR #343,
`docs/measurements/2026-09-01-mackerricher-photo-attribution.md`).

## Question

Adam wants state-park photos sourced from each state's **own official state
parks site** for the six test-group states. The MacKerricher finding showed the
CA ArcGIS layers we ingest carry no image field — so before building anything,
scope per state: does each state's official source expose photos at all, how, and
under what license?

## Part 1 — grounded field enumeration (measured, not researched)

Two read-only scripts (no DB writes; live ArcGIS `?f=json` + value samples):
`data/scripts/investigate-stateparks-photo-fields-2026-09-01.ts`,
`data/scripts/investigate-stateparks-photo-values-2026-09-01.ts`.

**Image-ish fields on the live ArcGIS layers we ingest, and what their values
actually are:**

| State | Layer(s) | Image field | Value reality (sampled from live layer) |
|---|---|---|---|
| CA | ParkBoundaries, Campgrounds | none | — no image field exists |
| OR | Oregon_State_Parks | none | — `hasAttachments:false`, no image field |
| AZ | Campsites_WGS | `PHOTO` | internal codes (`PTL_0001`), **not URLs**; `hasAttachments:false` (verified) — not resolvable attachments |
| NV | TP_SCORP_Master | `photo` | empty/whitespace `" "` — unpopulated placeholder |
| UT | …Management_Areas | `weblink1` | park **webpage** links (`stateparks.utah.gov/parks/…`), **not images** |
| WA | ParkBoundaries | `Imagelink` | **real image URLs** on `parks.wa.gov` (e.g. `…/AltaLake_HikingSign.jpg`); count of non-empty in live layer = 138 |
| WA | Campsites | `Keylink` | codes (`Potlatch27`), not URLs |

**No caption / credit / photographer / license field travels with any of these**
(measured — the sibling-field scan found none). So even where an image URL exists
(WA), the source layer carries no attribution to display.

**Conclusion of Part 1:** WA is the *only* state whose ingested ArcGIS layer
exposes a usable image URL. For CA/AZ/NV/UT/OR the official ArcGIS data yields no
usable photo, so any photos would have to come from the agency **website/API**,
which is the Part 2 question.

## Part 2 — per-state licensing research (six parallel agents; cited terms)

Each agent was instructed to quote actual terms with URLs and mark anything
unverified rather than guess. Summary; full quotes in the agent findings folded
into the ADR.

- **CA — BLOCKED (hard).** parks.ca.gov Conditions of Use / Copyright:
  images are "personal, non-commercial use only"; redistribution and commercial
  use prohibited; "You may not use any 'deep-link', 'spider' or other automatic
  device" (rules out hotlinking + scraping); no modification incl. cropping. No
  photo API/open-data exists. Integration: **blocked.**
- **AZ — BLOCKED (hard).** azstateparks.com/privacy: photos "are **not** in the
  public domain," "Unauthorized use is prohibited without … express written
  consent." `Campsites_WGS` `hasAttachments:false` verified — the `PHOTO` codes
  are not resolvable attachments. Integration: **blocked.**
- **NV — BLOCKED (hard).** parks.nv.gov About: free use scoped to "educational
  and scientific purposes" with attribution; personal/commercial "must contact,
  and receive a determination." Gallery images are third-party Instagram
  creators' works (credit in filename/handle) the state can't sublicense. ArcGIS
  `photo` field genuinely empty. Integration: **blocked.**
- **UT — BLOCKED (unclear→blocked).** No image field in ingested data. Official
  library is third-party **SmugMug** (© SmugMug + a bare Division ownership
  assertion, no reuse grant, JS-rendered/no API). utah.gov disclaimer grants only
  "personal or informational use," unmodified, with an explicit no-warranty on
  copyright. Integration: **blocked** (needs written permission).
- **WA — BLOCKED / FLAG (usable data, no license).** parks.wa.gov footer is the
  only governing term: "© … All rights reserved," with **no** third-party reuse
  grant, **no** attribution term, and no statewide public-domain fallback
  (wa.gov Privacy Notice is "© … State of Washington," no grant). Compounding:
  some images are contributed third-party works (Foundation photo contest /
  "used with permission"), and `Imagelink` carries nothing to tell staff-shot
  from contributed. Verdict: do **not** map to display on this basis; needs an
  affirmative grant from the Commission or legal sign-off.
- **OR — BLOCKED (conditional, pipeline).** `hasAttachments:false` verified; no
  image field; photos only on JS-rendered `stateparks.oregon.gov`. Data Terms of
  Use (JS-rendered; agent read the search-indexed rendered text and flagged it
  needs a browser to confirm verbatim): all use "must be credited 'courtesy
  Oregon Parks and Recreation Department'," content "may be subject to
  copyright." Permitted-with-mandatory-credit but **web-only, no machine-readable
  source** → blocked for an automated pipeline.

## Retroactive concern — WA photos already stored

The prior WA `Imagelink` backfill left **~59–70** `parks.wa.gov` image URLs in
`master_place.photo_url` (measured PROD: `photo_url ILIKE '%parks.wa.gov%'` = 70;
59 active state_parks records carry a non-empty `Imagelink`). Given the WA finding
(no confirmed reuse grant, some contributed third-party works), these are stored
**without a license basis**. They are **not currently rendered** (the render
laterals exclude state_parks), so no live exposure — but they should not be wired
to display, and Adam may want them cleared. Not deleted here (report-only).

## Outcome

**No state is unblocked with clear terms, so no ingestion/normalizer mapping was
built** — per the task's rule to report blocked rather than scrape. If Adam wants
official state-park photos, the path for every state is a direct licensing request
to the agency (WA and OR are the nearest to workable — WA already exposes the
image URLs, OR grants use with a mandatory credit line — but both need an
affirmative written grant this research did not find).
