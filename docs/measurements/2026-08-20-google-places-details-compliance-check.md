# Compliance check: storing Google Places Details fields as description text

Investigation only. 2026-08-20. **Stops here per the task's own instruction**
("if the answer is ambiguous or restrictive, stop and report back rather than
guessing") — the answer is restrictive, not ambiguous, so tasks 1–6 (pricing,
match-strategy design, the sample build, the live API run, schema proposal)
were **not started**. No API calls were made, no schema was designed, no
sample was built, no DB writes occurred.

## The question

Can we fetch Google Places Details fields — specifically `editorialSummary`
(and, for the same proposed flow, `displayName`, `formattedAddress`,
`websiteUri`, `internationalPhoneNumber`, `regularOpeningHours`, `rating`,
`userRatingCount`) — store them in our own DB, and later render them as our
own UI text (not a map marker, not live-rendered)?

## Finding: **No.** Storage of these fields is prohibited regardless of display surface.

Google Maps Platform's Places API caching/storage policy allows exactly two
exceptions, and nothing else:

- **Place ID** — exempt from caching restrictions, storable indefinitely.
- **Coordinates (latitude/longitude)** — cacheable for up to 30 consecutive
  calendar days, then must be deleted.

Every other field returned by Place Details — including `editorialSummary`
and every other field in the proposed field mask (`displayName`,
`formattedAddress`, `websiteUri`, `internationalPhoneNumber`,
`regularOpeningHours`, `rating`, `userRatingCount`) — **has no caching
exception**. The general rule, confirmed identically across Google's own
policy page and independent third-party summaries of the Service Specific
Terms, is: request it live, display it immediately, do not warehouse it.
There is no carve-out for "editorial"/descriptive text as a category, and no
carve-out based on how the content is rendered.

**This is a storage-permission rule, not a map-rendering rule — it applies
even though nothing here would be plotted on Mapbox.** The task's framing
distinguished "plotted as a map marker" (clearly prohibited under the
separate Places-UI-Kit-vs-raw-API rule) from "rendered as our own UI text."
That distinction matters for a **different** Google policy — the
map-display/attribution rule — but not for this one. The caching restriction
is keyed on the **content type** (is it a field with a caching exception or
not), not on **where or how** it's displayed. Storing `editorialSummary` in
`master_place`/`source_record` for later display as plain text is exactly
the kind of "pre-fetch, cache, or store... beyond the allowed exceptions"
the policy prohibits, whether or not a map is ever involved.

**Confirmed the Places UI Kit doesn't change this either** — it's a
rendering component that composes Places data on-page; nothing found
indicates it operates under different caching terms than the raw API. Same
restriction either way.

## Sources

Checked Google's own current policy page plus corroborating summaries of the
Service Specific Terms (the ToS document itself is too long for automated
fetch to return un-truncated; the policy page and multiple independent
summaries of the underlying clause agree word-for-word on the two
exceptions, so this is treated as settled, not single-sourced):

- [Policies and attributions for Places API | Google for Developers](https://developers.google.com/maps/documentation/places/web-service/policies) — Google's own current policy page. Direct quote: *"You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions"*; *"the place ID... is exempt from the caching restrictions... You can therefore store place ID values indefinitely."*
- [Google Maps Platform Service Specific Terms | Google Cloud](https://cloud.google.com/maps-platform/terms/maps-service-terms) — the underlying contractual terms (full text too long to fetch un-truncated in this session; corroborated via the archived dated snapshot below and third-party summaries).
- [Google Maps Platform Service Specific Terms — archived 2025-03-31 snapshot](https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250331) — search-indexed excerpt: *"Customer may temporarily cache latitude and longitude values from the Places API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values."*
- [Google Places API Terms: What You Can Scrape, Store + Cache — bizcollect.dev](https://bizcollect.dev/blog/google-places-api-terms) — independent summary explicitly lists "editorial summaries" under "Not cacheable," alongside displayName/formattedAddress/rating/photos/reviews/phone/website/opening hours. Also cites Google Maps Platform ToS §3.2.3 on not exporting/scraping content for use outside the Services.
- [Can you store Places API results? Every caching policy, compared — openplacesapi.com](https://openplacesapi.com/blog/can-you-store-places-api-results) — independent summary, same two-exception structure (place_id indefinite, coordinates 30 days), everything else "no caching exception... every render is another billable call."
- [Places UI Kit overview | Google for Developers](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview) and [Introducing Places UI Kit — Google Maps Platform blog](https://mapsplatform.google.com/resources/blog/introducing-places-ui-kit-a-low-code-way-to-display-googles-places-content-on-your-map-of-choice/) — checked for a UI-Kit-specific caching carve-out; found none. UI Kit is a display component operating under the same underlying terms.

## Related, pre-existing finding (observed in passing, not the question asked — flagging, not auditing)

While checking sources, I noticed the corpus **already stores non-exempt
fields from Google indefinitely**, in two existing mechanisms, neither of
which this investigation was asked to audit:

- The `google_resolved` tier (`web/src/lib/itinerary/ingest.ts`,
  investigated in `2026-08-20-google-resolved-provenance.md`) writes
  `canonical_name`/`p.displayName` into `normalized_payload` and
  `raw_payload` permanently, with no TTL or refresh mechanism.
  `displayName` has no caching exception under the same policy checked
  above.
- The `google` source ingester (`data/ingestion/sources/google-places.ts`)
  requests and stores `displayName`, `formattedAddress`, `types`,
  `primaryType`, `location` in `normalized_payload` — `displayName` and
  `formattedAddress` are both non-exempt fields, stored the same way.

I did not check whether these predate a compliance review, whether they've
already been considered and accepted as a known risk, or what volume is
affected (`google_resolved` is 122 rows, `google` is 5, per the 2026-08-20
gap scan). Raising this because it surfaced directly while answering the
assigned question, not as a scoped finding — a real audit of the existing
mechanisms would need its own pass.

## What this means for the task as scoped

The task's premise — fetch Place Details, store `editorialSummary` (and the
other requested fields) in our own DB, display as our own UI text — is not
permitted as designed. Tasks 1 (pricing), 2 (match-strategy design), 3
(sample construction), 4 (the live API run and its measurements), and 5
(schema proposal) all assume this storage step and were not started, per the
task's own stop condition.

**Not proposing an alternative** — the task said report back, not redesign.
For awareness only, the policy as found would still permit a live-fetch
architecture (call Place Details at render time using a stored `place_id`
— which IS cacheable indefinitely — and show the result without persisting
it), since nothing would be stored beyond the permitted exceptions. Whether
that shape (cost profile: a billable call per render rather than one per
place; latency; the "isn't a description most of the time anyway" finding
from the 2026-08-20 gap scan) is worth pursuing is a product/engineering
decision for Adam, not something this investigation was asked to design.
