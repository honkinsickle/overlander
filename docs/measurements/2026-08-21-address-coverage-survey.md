# Address-coverage survey — sizing the reverse-geocoding gap, 2026-08-21

Read-only survey to size a possible human-readable address field before choosing
a geocoding provider (measure-before-build). **No external API calls of any kind
in this pass — no geocoding (Google/Nominatim/OpenCage/Geocodio or otherwise).**
All figures computed this session against **TEST** (`znldzjdatkogdktymtvi`),
read-only, no DB writes. No PROD access.

Script: `data/scripts/measure-address-coverage-2026-08-21.ts` (full-corpus scan).
Field-shape probe done first (sampled rows per source) to find where address
data actually lives before counting.

## Scope

**In-scope = `master_place_search_export`** (searchable + `source_count > 0` +
within `six_state_footprint()`) — the same in-scope definition the LLM-description
work used. Re-confirmed this session, not assumed:

**In-scope master_place: 32,734** `[queried TEST 2026-08-21]`.

Active `source_record` rows linked to those in-scope MPs and scanned: **36,254**
(the other ~42.7k active SRs link to out-of-scope MPs or are unlinked).

## 1. Where address data lives, per source (from the shape probe)

| source | address field | present? |
|---|---|---|
| osm | `raw_payload.element.tags` `addr:housenumber/street/city/state/postcode` | partial, sparse |
| atlas_oddities | `normalized_payload.address` (free-form single string) | yes, on all rows |
| ridb | `raw_payload.facility.FACILITYADDRESS[]` (street/city/state/zip) | **field exists but empty in 100% of ingested rows** |
| google | `normalized_payload.formatted_address` | yes, but **non-compliant to persist** (5 rows) |
| usfs | — (`closest_towns`, `directions` only — town-level, not an address) | no structured address |
| nps | — (`contact.website` only) | no |
| state_parks | — (`web_link`, `park_name`, `acreage`) | no |
| blm | — (`contact`, `web_link`) | no |
| padus | — (land polygons) | no |
| google_resolved | — (`coords` + name only) | no |

`normalized_payload.contact.address` was probed on every source and is not
populated anywhere (contact carries website/phone/email only).

## 2. Per-source coverage (active source_record level, in-scope MPs only)

`[queried TEST 2026-08-21]`

| source | SRs | any address | (%) | street+city | (%) |
|---|--:|--:|--:|--:|--:|
| osm | 16,069 | 2,162 | 13.5% | 1,604 | 10.0% |
| ridb | 5,642 | 0 | 0.0% | 0 | 0.0% |
| usfs | 5,228 | 0 | 0.0% | 0 | 0.0% |
| nps | 4,262 | 0 | 0.0% | 0 | 0.0% |
| atlas_oddities | 2,831 | 2,831 | 100.0% | 1,872 | 66.1% |
| state_parks | 1,448 | 0 | 0.0% | 0 | 0.0% |
| blm | 688 | 0 | 0.0% | 0 | 0.0% |
| google_resolved | 81 | 0 | 0.0% | 0 | 0.0% |
| google | 5 | 5 | 100.0% | 5 | 100.0% |

**Definitions:** *any address* = at least one address token present. *street+city*
= a street line and a city (the "complete-ish" bar). **State is never the binding
constraint** — every in-scope row has coordinates and most have
`master_place.state` (populated by #244), so completeness hinges on street+city,
not state. OSM `addr:state` in particular is usually absent in US OSM data even
when street/city are present.

**Caveats on the two 100% sources:**
- **atlas_oddities** street+city (66.1%) is a **heuristic** on a free-form string
  (comma-part count + a leading street-number pattern), not a parsed structured
  address — treat as approximate. Atlas is the single largest existing-address
  contributor (2,831 partial, ~1,872 complete-ish).
- **google** (5 rows) is complete but is exactly the content ruled out — Google's
  terms forbid persisting a formatted address beyond the place_id. Counted for
  completeness, **excluded from any build**.

## 3. MP-level rollup

`[queried TEST 2026-08-21]`

| | count | % of in-scope |
|---|--:|--:|
| in-scope MPs | 32,734 | 100% |
| MPs with ANY address token (any source) | **4,994** | **15.3%** |
| MPs with a street+city (complete-ish) address | 3,478 | 10.6% |

## 4. The gap — MPs needing external geocoding

**Gap = in-scope MPs with NO address token in any existing source: 27,740
(84.7% of in-scope)** `[queried TEST 2026-08-21]`.

Even counting the compliance-excluded/heuristic sources generously, ~85% of the
corpus has nothing address-like today. Reverse geocoding (or another source) is
the only path to an address for those rows.

**Gap by source composition (top):**

| source set | gap MPs |
|---|--:|
| osm (only) | 11,901 |
| ridb (only) | 4,033 |
| nps (only) | 4,008 |
| usfs (only) | 3,428 |
| state_parks (only) | 1,314 |
| osm+usfs | 747 |
| ridb+usfs | 661 |
| blm (only) | 507 |
| osm+ridb+usfs | 305 |
| osm+ridb | 296 |

**Gap by primary_category (top):**

| category | gap MPs | % of gap |
|---|--:|--:|
| campground | 5,961 | 21.5% |
| trailhead | 4,707 | 17.0% |
| park_feature | 3,661 | 13.2% |
| dispersed_camping | 2,569 | 9.3% |
| facility | 2,240 | 8.1% |
| park | 2,012 | 7.3% |
| ev_charging | 1,909 | 6.9% |
| recreation_area | 1,541 | 5.6% |
| picnic_area | 1,218 | 4.4% |
| public_land | 435 | 1.6% |
| viewpoint | 285 | 1.0% |
| grocery | 246 | 0.9% |

## 5. Rural/remote proxy characterization of the gap

**PROXY signal only — a category-mix inference, NOT a measured geocoder-accuracy
rate** (measuring accuracy requires calling a geocoder, which this pass does not).

Bucketing gap categories by whether reverse-geocoding is inherently likely to
return a meaningful street address:

| bucket | gap MPs | % of gap |
|---|--:|--:|
| remote/backcountry-leaning (campground, trailhead, dispersed_camping, viewpoint, park_feature, recreation_area, picnic_area, beach, …) | 20,164 | 72.7% |
| developed/urban-leaning (ev_charging, park, grocery, toilet, water, visitor_center, …) | 4,598 | 16.6% |
| other/uncategorized (mostly `facility` 2,240 + `public_land` 435) | 2,978 | 10.7% |

**Read:** ~73% of the gap sits in categories where a POI often has no street
address to find at all (a backcountry trailhead, a dispersed camp on a forest
road) — a reverse geocoder will frequently return only a nearest-road or
city-level result, or nothing precise. The ~17% developed slice (EV chargers,
urban parks, groceries) is where geocoding would most reliably yield a real
street address. This bears directly on the build/buy decision: a large fraction
of the gap may not be *addressable* regardless of provider quality, so the
"useful yield" of geocoding is likely well below the raw 27,740.

## 6. Proposed schema (NOT applied)

Following the `master_place_generated_content` precedent — keep derived/enriched
content structurally separate from `master_place` source-of-truth, so it is never
merged by `recompute_master_place`/`field_precedence` and can carry
provider-specific caching/refresh semantics.

**A separate table, `master_place_address`.** Two kinds of address content must be
distinguishable (the task's core requirement): `tag_derived` (assembled from
existing source fields — OSM `addr:*`, atlas `address`, ridb) vs `geocoded` (from
an external reverse geocoder, provider-specific caching rights and TTL). One table
with a discriminator, not two mechanisms.

```sql
create table public.master_place_address (
  id uuid primary key default gen_random_uuid(),
  master_place_id uuid not null references public.master_place(id) on delete cascade,

  formatted_address text not null,          -- single-line display form
  street text,                              -- structured components, nullable
  city text,
  state text,
  postal_code text,

  address_source text not null              -- the task's required provenance discriminator
    check (address_source in ('tag_derived', 'geocoded')),
  geocoder_provider text,                   -- null for tag_derived;
                                            -- 'nominatim'|'opencage'|'geocodio' for geocoded
  geocoded_at timestamptz,                  -- null for tag_derived; fetch time for geocoded —
                                            -- drives any provider-TTL/refresh policy (mirrors the
                                            -- 30-day-cache concern that ruled out Google)
  grounded_on_source_record_ids uuid[],     -- tag_derived: which source_record fields it came from
                                            -- (mirrors master_place_generated_content); null for geocoded
  created_at timestamptz not null default now(),

  unique (master_place_id, address_source)  -- allows a tag_derived AND a geocoded row to coexist;
                                            -- read-path precedence (app layer) prefers tag_derived
);

create index on public.master_place_address (master_place_id);
alter table public.master_place_address enable row level security;
-- zero policies — service-role only, same posture as master_place_generated_content.
```

Design notes:
- **`unique (master_place_id, address_source)`** (not `unique (master_place_id)`)
  so a real tag-derived address and a geocoded one can both exist — regenerate/
  refresh each independently, and the read path prefers `tag_derived`. Mirrors the
  "dual rows" pattern generated_content already tolerates.
- **`geocoded_at` + `geocoder_provider`** are exactly what keep a compliant
  provider's cached result refreshable within its TTL and prevent a Google-style
  terms violation from ever being *invisible* — a `geocoded` row always carries who
  produced it and when.
- **`grounded_on_source_record_ids`** on `tag_derived` rows lets a later pass
  detect when the underlying tags changed (same staleness mechanism as
  generated_content).
- **Read path** (app layer, not enforced in DB, flagged not designed): show a real
  `master_place` address field if one ever exists, else `tag_derived`, else
  `geocoded`. Keeping the fallback in the app/view layer (not `field_precedence`)
  means a real source address landing later automatically wins.
- Whether `tag_derived` could instead be a plain column on `master_place`: it is
  derived from real source tags, so it is *closer* to source-of-truth than a
  geocoded value — but putting it on `master_place` while `geocoded` lives
  elsewhere splits one concept across two mechanisms. One table with the
  discriminator keeps address provenance in a single, self-describing place.

## 7. Flags (surfaced, not chased — per the task)

- **RIDB `FACILITYADDRESS` is empty in 100% of ingested rows** (5,642 in-scope SRs,
  0 with any address). RIDB's schema HAS a facility address field; our stored
  `raw_payload.facility.FACILITYADDRESS` is `[]` on every sampled and scanned row.
  Either the RIDB API returns it empty for these facilities or the ingester drops
  it — worth a separate check, because if it's an ingestion gap, ~5.6k rows could
  gain a real address with no geocoding at all. Not investigated here.
- **`google` (5 rows) and `google_resolved` (81 rows)** — google carries a
  formatted address but is non-compliant to persist; google_resolved carries only
  coords. Neither is a usable address source for a permanent field.
- **atlas_oddities completeness (66.1%) is a heuristic** on a free-form string, not
  a parsed structured address — the street/city split for those rows would need
  real parsing before use. (Atlas licensing was already flagged as an open question
  in the LLM-description work; unchanged here.)
- **OSM `addr:state` absence** is handled by the corpus's own `master_place.state`,
  so it does not reduce effective completeness — noted so the 10.0% OSM street+city
  figure isn't read as "missing state."

## Summary

| | |
|---|--:|
| in-scope MPs | 32,734 |
| MPs with any existing address token | 4,994 (15.3%) |
| MPs with street+city | 3,478 (10.6%) |
| **gap (no address in any source)** | **27,740 (84.7%)** |
| gap that is remote/backcountry-leaning (proxy) | 20,164 (72.7%) |
| gap that is developed/urban-leaning (proxy) | 4,598 (16.6%) |

The gap is large (~85%) but heavily weighted toward categories where a precise
street address may not exist to be found — so the *addressable* gap that a
geocoder could usefully fill is likely materially smaller than 27,740. Provider
choice (Nominatim vs OpenCage vs Geocodio) is a separate conversation, per the
task.
