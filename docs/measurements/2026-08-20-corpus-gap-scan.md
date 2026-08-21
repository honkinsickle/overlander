# Corpus gap scan — 2026-08-20

> **⚠️ CORRECTION 2026-08-20 (later, same day) — §3's "Google linkage
> coverage" framing needs a caveat; see
> `2026-08-20-google-resolved-provenance.md` for the full investigation.**
> The 127-row count and the percentages below are correct and unchanged. What
> is wrong is the implication that this is a corpus-wide match-rate finding.
> The 127 `google`/`google_resolved` rows are a byproduct of the itinerary
> generation/NL-edit grounding pipeline (`web/src/lib/itinerary/ingest.ts`
> `enqueueResolvedPlaces`, spec §8.3 three-tier grounding) — it only ever
> resolves place names an LLM proposed for a specific TEST-generated trip,
> never the corpus itself. A master_place that never appeared in a generated
> trip's itinerary has **zero chance** of being in this population, matched or
> not — the process never considered it. Its own design ADR
> (`docs/decisions/2026-07-23-corpus-writeback-dormant.md`) already describes
> it as "a corridor-densification tool," scoped to "only the places trips
> actually touch." **So `0.15%`/`0.22%` against the corpus-wide denominator
> below is a real, correctly-computed number, but it does not mean "Google
> matching was attempted broadly and mostly failed" — no corpus-wide or
> corpus-sampled Google matching has ever been attempted.** Confirmed the
> count has been completely flat (122 `google_resolved` + 5 `google` = 127)
> since at least 2026-08-10, across a ~9× growth in the rest of the corpus —
> consistent with a handful of TEST generation runs in late July, not an
> ongoing or scaling process. Read the caveat already present in §3 below
> (about `google_resolved` rows carrying no rich fields) as reinforced, not
> superseded, by this correction — it explains *why* the shape is minimal.

Read-only investigation against TEST (`znldzjdatkogdktymtvi`). No writes, no
ingest, no `eval-llm-descriptions.ts` run. Refreshes the prior
`measure-llm-eligibility.ts` breakdown against the current corpus state (the
2026-08-18/19 amenities + category-curation session landed since the last
pass and materially changed the active-row population).

**Run date/time:** 2026-08-20T18:05:56.028Z
**Total `master_place` rows queried (unfiltered):** 158,742
**Total `source_record` rows queried (all / active):** 168,688 / 84,999

Script: `data/scripts/measure-corpus-gap-scan-2026-08-20.ts` — a copy of
`measure-llm-eligibility.ts` extended with source_id/state/category
breakdowns, Google-linkage coverage, OSM functional-field coverage, a
NONE-bucket sample dump, and a NONE×Google cross-reference. Bucketing logic
(`isStrong`/`isWeak`, `DESCRIPTION_MIN_LENGTH = 40`) reused unchanged from
`data/scripts/lib/eligibility.ts` — not re-derived here. `measure-llm-eligibility.ts`
itself was not edited. Raw script output: see the run captured below; every
number in this report is transcribed from that run, not recomputed by hand.

Scope note: "in-scope MPs" below means present in `master_place_search_export`
(searchable, has geometry, `source_count > 0`) — **38,950** master_places, out
of **158,742** total master_place rows. This matches the existing script's
denominator convention. "Active source_record" means `is_active = true` —
**84,999** of 168,688.

---

## 1. Overall buckets (corpus-wide, in-scope MPs)

| bucket | n | % |
|---|--:|--:|
| STRONG | 21,497 | 55.19% |
| WEAK | 104 | 0.27% |
| NONE | 17,349 | 44.54% |

This is a large shift from the last full-corpus pass — the population itself
changed (category deactivations dropped active `source_record` from 165,939
to 84,999, and the in-scope MP count from ~117,261-view-era numbers down to
38,950), so this is **not apples-to-apples with the 127/165,939 baseline
without accounting for the corpus shrink** — see §3.

## 2a. By source_id

MP-level bucket, restricted to MPs holding ≥1 active source_record from that
source. SR-level columns (`has_web`/`has_wiki`/`has_phone`/`has_hours`) are
computed directly on that source's own active records (not MP-aggregated),
per the task's request that these signals "generalize."

| source | n_mps | strong% | weak% | none% | SR n | has_web | has_wiki | has_phone | has_hours |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| osm | 24,694 | 39.68% | 0.23% | 60.10% | 27,152 | 11.29% | 2.17% | 1.76% | 5.97% |
| padus | 35,966 | 0.07% | 0.00% | 99.93% | 36,358 | 0.00% | 0.00% | 0.00% | 0.00% |
| usfs | 5,183 | 68.17% | 0.00% | 31.83% | 6,324 | 0.00% | 0.00% | 0.00% | 0.00% |
| ridb | 5,493 | 91.26% | 0.98% | 7.76% | 6,013 | 5.64% | 0.00% | 60.17% | 0.00% |
| nps | 4,977 | 100.00% | 0.00% | 0.00% | 5,283 | 99.68% | 0.00% | 1.72% | 5.91% |
| blm | 672 | 37.80% | 0.00% | 62.20% | 876 | 0.00% | 0.00% | 0.00% | 0.00% |
| google_resolved | 121 | 4.13% | 0.00% | 95.87% | 122 | 0.00% | 0.00% | 0.00% | 0.00% |
| google | 5 | 100.00% | 0.00% | 0.00% | 5 | 0.00% | 0.00% | 0.00% | 0.00% |

**Per §STANDING RULES of the task**: `has_meaningful_tags` is structurally
OSM-only (raw tag dict shape differs per source), so STRONG% differences
above driven by that signal are not a content finding. `usfs` at 0% on every
SR-level signal but 68.17% STRONG is explained entirely by
`has_real_description` (its own `description` field, not by
website/wiki/phone/hours) — consistent with the DESCRIPTION_MIN_LENGTH design
note in `lib/eligibility.ts` that USFS/NPS/RIDB carry real prose in
`normalized_payload.description`.

**Supplementary — `atlas_oddities`, not in the original source list** (landed
via #241, after the original eligibility script's source list was drafted):

| source | n_mps | strong% | weak% | none% | SR n | has_web | has_wiki | has_phone | has_hours |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| atlas_oddities | 2,861 | 59.56% | 0.00% | 40.44% | 2,866 | 59.21% | 0.00% | 0.00% | 0.00% |

See §5 spot-check — this STRONG rate is driven entirely by `contact.website`
presence, not by any description text. **Important, verified finding:**
`normalized_payload.description` is `null` on **all 2,866 of 2,866** active
`atlas_oddities` rows (full-population query, not a sample) — the adapter
does not carry Atlas Obscura's narrative write-up into the corpus at all,
only structured metadata (name, address, category tags, and a link back to
the source page via `ao_url`, present on all 2,866). See §5.

## 2b. By state

| state | n | strong | weak | none | strong% |
|---|--:|--:|--:|--:|--:|
| WA | 5,515 | 3,631 | 7 | 1,877 | 65.84% |
| OR | 6,092 | 3,522 | 10 | 2,560 | 57.81% |
| CA | 13,344 | 6,956 | 43 | 6,345 | 52.13% |
| NV | 3,655 | 2,218 | 10 | 1,427 | 60.68% |
| UT | 5,522 | 2,574 | 14 | 2,934 | 46.61% |
| AZ | 4,821 | 2,595 | 20 | 2,206 | 53.83% |
| outside | 1 | 1 | 0 | 0 | 100.00% |

UT is the weakest state (46.61% STRONG); WA the strongest (65.84%). `outside`
is n=1 — noise, not a finding (the export view is already filtered to
`six_state_footprint()`).

## 2c. By inferred_category, OSM rows only

MP-level bucket, restricted to MPs holding an active OSM source_record of
that `inferred_category` (OSM's own category, not `master_place.primary_category`
— these differ under multi-source merges).

| category | n_mps | strong% | weak% | none% |
|---|--:|--:|--:|--:|
| campground | 5,766 | 38.45% | 0.23% | 61.33% |
| picnic_area | 4,416 | 8.51% | 0.07% | 91.42% |
| ev_charging | 3,634 | 75.87% | 0.28% | 23.86% |
| trailhead | 3,215 | 37.88% | 0.03% | 62.08% |
| dispersed_camping | 3,181 | 38.48% | 0.03% | 61.49% |
| park | 2,571 | 41.50% | 0.51% | 57.99% |
| grocery | 700 | 56.00% | 2.14% | 41.86% |
| water | 288 | 49.65% | 0.00% | 50.35% |
| beach | 254 | 34.65% | 0.00% | 65.35% |
| toilet | 222 | 40.54% | 0.00% | 59.46% |
| viewpoint | 170 | 100.00% | 0.00% | 0.00% |
| rest_area | 168 | 10.71% | 0.00% | 89.29% |
| hardware | 56 | 51.79% | 0.00% | 48.21% |
| hut | 56 | 37.50% | 0.00% | 62.50% |
| shower | 28 | 7.14% | 7.14% | 85.71% |
| outdoor_gear | 22 | 68.18% | 0.00% | 31.82% |
| dump_station | 10 | 40.00% | 0.00% | 60.00% |

`viewpoint` at 100% STRONG reflects the 2026-08-19 filter-C reactivation
(only described OSM viewpoint rows are active — see STATE.md). `picnic_area`
(8.51%) and `rest_area` (10.71%) are the weakest OSM categories — spot-check
in §5 confirms this is genuine tag sparsity (1–2 raw OSM tags per row), not a
measurement artifact.

## 3. Google-linkage coverage

> **See the correction at the top of this document.** The numbers below are
> unchanged and correct; ~~"Google-linkage coverage"~~ is the wrong frame —
> read this section as "size of the itinerary-audit tier-2 resolve byproduct
> against the corpus," not as a corpus-wide match-attempt rate.

**SR-level, comparable to the historical 127/165,939 (0.08%) figure:**

127 active `google`/`google_resolved` source_record / 84,999 total active
source_record = **0.15%**.

The raw numerator (127) has **not moved** — same 122 `google_resolved` + 5
`google` as the last check. The percentage moved (0.08% → 0.15%) purely
because the denominator (total active `source_record`) roughly halved
(165,939 → 84,999) from the 2026-08-18/19 category deactivations — this is a
corpus-shrink artifact, not new linkage work.

**MP-level, corpus-wide (in-scope MPs):** 86 / 38,950 = **0.22%**.

**By state:**

| state | linked | total | % |
|---|--:|--:|--:|
| WA | 0 | 5,515 | 0.00% |
| OR | 0 | 6,092 | 0.00% |
| CA | 8 | 13,344 | 0.06% |
| NV | 5 | 3,655 | 0.14% |
| UT | 69 | 5,522 | 1.25% |
| AZ | 4 | 4,821 | 0.08% |

UT carries 69 of the 86 total (80%) — almost certainly a byproduct of
whatever "itinerary-audit tier-2 live resolve" runs generated most of these
122 `google_resolved` rows in/near Utah trip corridors (see §5's raw-payload
inspection); not evidence of any deliberate UT-focused linkage campaign.

**By category (min n=50), top 20 by n:**

| category | linked | total | % |
|---|--:|--:|--:|
| campground | 7 | 6,880 | 0.10% |
| trailhead | 0 | 5,297 | 0.00% |
| picnic_area | 0 | 4,667 | 0.00% |
| dispersed_camping | 0 | 3,788 | 0.00% |
| park_feature | 0 | 3,645 | 0.00% |
| ev_charging | 0 | 3,634 | 0.00% |
| oddity | 0 | 2,738 | 0.00% |
| park | 1 | 2,575 | 0.04% |
| facility | 0 | 2,251 | 0.00% |
| recreation_area | 0 | 1,143 | 0.00% |
| grocery | 0 | 596 | 0.00% |
| viewpoint | 0 | 294 | 0.00% |
| water | 0 | 285 | 0.00% |
| beach | 0 | 254 | 0.00% |
| toilet | 0 | 215 | 0.00% |
| rest_area | 0 | 168 | 0.00% |
| visitor_center | 0 | 102 | 0.00% |
| activity_pass | 0 | 78 | 0.00% |
| hut | 0 | 55 | 0.00% |
| hardware | 0 | 52 | 0.00% |

Google linkage is effectively absent everywhere except a UT-heavy sliver.

**Important caveat, verified in §5:** the existing `google_resolved` records
are NOT full Google Places Details fetches. Direct inspection of sample rows
shows `normalized_payload` carries only `coords`, `canonical_name`,
`primary_category`, and a `provenance` tag reading `"itinerary-audit tier-2
live resolve"` — no website, phone, hours, or description in either
`normalized_payload` or `raw_payload` (`raw_payload` keys are just
`location`, `place_id`, `displayName`, `resolvedFromName`). **This means the
current linkage mechanism, if simply run more broadly, would not by itself
close the description gap** — it resolves a place ID and a name, not rich
content. Closing the gap via Google would need a different (richer,
field-masked) fetch than what produced these 122 rows. This is a factual
finding about what exists today, not a proposal for what to build.

## 4. OSM functional-field coverage

Active `osm` source_records only (n = 27,152), checking
`raw_payload.element.tags` for presence of `ele`, `capacity`, `tents`,
`caravans`, or any `socket:*`-prefixed key (EV-socket family).

| field | n | % |
|---|--:|--:|
| any of the below | 7,370 | 27.14% |
| `ele` | 3,216 | 11.84% |
| `capacity` | 3,176 | 11.70% |
| `tents` | 1,745 | 6.43% |
| `caravans` | 1,327 | 4.89% |
| EV-socket family (`socket:*`) | 1,706 | 6.28% |

Confirms the number without scoping work off it, per the task's instruction —
EV-socket coverage (6.28%) remains deprioritized in favor of Google linkage.

## 5. NONE-bucket spot-check (5–8 per state, spread across categories)

Full sample dump is in the raw script output (kept alongside this file's
source at `data/scripts/measure-corpus-gap-scan-2026-08-20.ts`'s run; not
reproduced in full here — representative findings below).

**Genuine sparsity, not an artifact** — the large majority of sampled rows:
OSM picnic_area/trailhead/rest_area/dispersed_camping rows in every state
carry 1–4 raw tags (`{tourism}`, `{highway}`, `{name,tourism}`,
`{tourism,backcountry}`) with no description, note, wiki, or website key
present at all. This matches the category-level pattern in §2c (picnic_area
8.51% STRONG, rest_area 10.71% STRONG) — the sparsity is at the source, not a
bucketing bug.

**One verified, corpus-wide (not sampled) finding — `atlas_oddities` carries
no description text at all.** Every one of the 2,866 active `atlas_oddities`
rows has `normalized_payload.description = null`. What the adapter does
carry: `canonical_name`, `address`, `categories_raw`/`overlander_tags` (short
category-word lists, e.g. `"bell tower; Firefighters; Belltowers; Fire
Fighters; Towers"`), `contact.website` (on 1,697/2,866 = 59.2% — this is what
drives the category's 59.56% STRONG rate), and `ao_url` (a link back to the
source Atlas Obscura page, present on all 2,866). No narrative prose from the
Atlas Obscura write-up itself reaches the corpus in any field this
measurement checked. Flagging this as a genuine content-shape fact worth
knowing before scoping any oddity-category LLM or linkage work — not
something this investigation is proposing a fix for.

**One partial-artifact finding worth naming — USFS `directions` text is
invisible to `has_real_description`.** Several sampled USFS
`dispersed_camping` rows carry only a templated `"NAME (Camping Area)"`
description (correctly excluded by the 40-char junk floor per
`lib/eligibility.ts`'s documented derivation — working as designed), but at
least one sampled row (`usfs:site:211081010602`, Big Flat / Puffer Lake, UT)
carries a substantial ~400-character `directions` field with real driving
directions, while its `description` is templated junk. `computeSignals()`
only ever reads `normalized_payload.description` — it never looks at
`directions`. This is not a bug in the current measurement (the task defined
description/narrative eligibility, and `directions` is not narrative
description), but it means some USFS rows have more usable raw material than
the STRONG/WEAK/NONE bucket credits them for. Not quantified here — flagging
for awareness, not scoping.

**PAD-US (99.93% NONE) is expected, not investigated further** — PAD-US is
polygon-centroid land-status data with no display-content fields; this
matches its long-established role in the corpus (STATE.md, multiple prior
sessions) and was not a surprise worth a fresh spot-check.

## 6. NONE-bucket × Google-linkage cross-reference

| | n | % of NONE-bucket |
|---|--:|--:|
| NONE-bucket MPs | 17,349 | — |
| …lack Google linkage | 17,273 | 99.56% |
| …already Google-linked | 76 | 0.44% |

Google linkage today touches almost none of the NONE-bucket population. Given
§3's finding that current `google_resolved` rows carry no rich fields anyway,
this 99.56% is not directly a "would be closed by linkage" number — see the
three-bucket read below.

---

## Plain-language read

**(a) Rich enough already — 21,497 MPs, 55.19% of the in-scope corpus.**
STRONG bucket. Concentrated in `nps` (100%), `ridb` (91%), `usfs` (68%),
`ev_charging`/`viewpoint`/`outdoor_gear` OSM categories, and (with the
caveat above) `atlas_oddities` via website presence rather than description
text.

**(b) Thin but Google-linkable — sized as an upper bound only, real number
unknown.** 17,273 NONE-bucket MPs (99.56% of NONE) currently lack any Google
linkage. But §3 shows the 127 `google`/`google_resolved` rows that DO exist
carry no website/phone/hours/description — just a resolved place ID, name,
and coords from a lightweight "itinerary-audit tier-2" resolve, not a full
Google Places Details fetch. **So this bucket's premise — that linking more
places to Google would give them description text "for free" — is not
supported by what the current linkage mechanism actually returns.** Whether
a properly field-masked Google Places Details fetch would close this gap is
an open question this measurement did not test (out of scope: no live
Google API calls were made). **Addendum 2026-08-20 (later):** even "not yet
linked" overstates it — the provenance investigation
(`2026-08-20-google-resolved-provenance.md`) found the current mechanism only
ever considers places an LLM mentions in a TEST-generated trip, so the
17,273 were never candidates for linking at all, successful or not. Treat 17,273 as "not yet linked," not as "would
become STRONG if linked."

**(c) Thin, not Google-linked, structurally sparse at the source — the bulk
of the NONE bucket, roughly 17,273 minus whatever a real Google Details
fetch would actually help.** This splits into at least two distinct
sub-populations worth separating in any follow-up scoping conversation:
  - **OSM stub rows** (picnic_area, rest_area, trailhead, dispersed_camping,
    beach, toilet, park) — genuinely 1–4 raw tags, no name-worthy content to
    generate from even with an LLM. A product question (is a templated
    category-derived line acceptable, as was done for toilet/water/
    dump_station on 2026-08-18) rather than an engineering fix.
  - **`atlas_oddities`** (1,157 of 2,861 MPs holding an atlas_oddities record
    fall in the NONE bucket, exactly recomputed — not the 40.44% rounded from
    §2a) — categorically different:
    these rows point at a real, existing, narrative write-up (`ao_url`) that
    simply isn't in the corpus. This is closer to a data-completeness gap
    than a "nothing to say" gap, though scraping/republishing Atlas Obscura's
    own prose raises its own (not-measured-here) product/licensing question.

No enrichment code or LLM work is proposed here per the task's scope — this
is the measurement to sequence that conversation from.
