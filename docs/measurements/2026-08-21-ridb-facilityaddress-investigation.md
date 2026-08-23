# RIDB FACILITYADDRESS — root-cause investigation, 2026-08-21

Investigation only, confirm-before-fix. **No normalizer changes, no backfill, no
DB writes.** Triggered by the address-coverage survey
(`docs/measurements/2026-08-21-address-coverage-survey.md`), which found RIDB's
`FACILITYADDRESS` empty in 100% of ingested RIDB facility rows. Question: is that
an ingestion gap (like the BLM `WEB_LINK` normalizer bug earlier this session) or
does RIDB genuinely not publish this data?

TEST only (`znldzjdatkogdktymtvi`). Distinct from `FacilityDirections` (free-text
directions), which was already fixed this session — untouched here.

**Answer up front: it's a real gap, but at the FETCH layer, not the normalizer —
our ingester never requests RIDB's `full=true`, so the API returns
`FACILITYADDRESS` empty. Upstream data does exist for many facilities, though the
*useful* yield is materially lower than the raw presence rate, and some populated
addresses are administrative-office addresses, not the POI's physical location.**

## 1. Current normalizer + fetch handling of FACILITYADDRESS

Two independent places would have to be right for us to capture it; **both are
wrong**:

- **`normalizeFacility` (`data/ingestion/sources/ridb.ts:324`) never references
  `FACILITYADDRESS`.** It reads `FacilityPhone/FacilityEmail/
  FacilityReservationURL/FacilityMapURL/FacilityAdaAccess/FacilityDescription/
  FacilityDirections/ParentOrgID` — no address mapping of any kind. `FacilitySchema`
  (`ridb.ts:61`) doesn't declare `FACILITYADDRESS` either, but it is
  `.passthrough()`, so the field is *not* stripped — it survives into
  `raw_payload` if the API sends it.
- **`fetchPaginated` (`ridb.ts:151`) never sets `full=true`.** The request sets
  only `latitude`, `longitude`, `radius`, `limit`, `offset`
  (`ridb.ts:161-165`). RIDB's `/facilities` search endpoint returns the entity's
  sub-arrays (`FACILITYADDRESS`, `ACTIVITY`, …) **empty unless `full=true` is
  passed.**

So even though `normalizeFacility` doesn't map the field, that is moot: the raw
data we captured has nothing to map. The binding defect is the missing
`full=true`.

## 2. Raw upstream check — stored data and live API

### Our stored raw_payload `[queried TEST 2026-08-21]`
All **4,793** `source_id='ridb'` facility rows (`external_id LIKE
'ridb:facility:%'`): `raw_payload.facility.FACILITYADDRESS` present as an **empty
array on 100%** — 0 with the key absent, 0 non-empty, 0 non-array. The empty-array
(not missing-key) shape is itself the signature of "the API returned the field
unexpanded." (raw_payload top-level keys: `media`, `facility`, `fetched_at`.)

### Live RIDB API, independent of our ingester `[probed 2026-08-21]`
Single read-only GETs with the stored `RIDB_API_KEY` (which works — returns 200,
despite the session-start preflight reporting RIDB 401; see §Flags):

| request | result |
|---|---|
| `GET /facilities/255279` (detail, no `full`) | `FACILITYADDRESS: []` |
| `GET /facilities/255279/facilityaddresses` | `TOTAL_COUNT 0` — this facility genuinely has no address upstream |
| `GET /facilities?full=false` (search) | first result `FACILITYADDRESS: []` (exactly what our ingester gets) |
| `GET /facilities?full=true` (search) | first result **populated** ↓ |

`full=true` populated example (Cottonwood Campground, Fremont-Winema NF):
```json
[{"FacilityStreetAddress1":"18049 HWY 395","FacilityStreetAddress2":"Lakeview Ranger Station",
  "City":"Lakeview","AddressStateCode":"OR","PostalCode":"97630",
  "FacilityAddressType":"Mailing","FacilityAddressID":"103823890"}]
```
Note this is a **`Mailing`** type — the managing ranger station's town address, not
the campground's physical location.

### Sample of OUR population against the live address endpoint
80 stored FacilityIDs (seeded random from the 4,793), queried
`/facilities/{id}/facilityaddresses`, 0 non-200:

| measure | result |
|---|--:|
| have ≥1 address record | **68 / 80 (85.0%)** |
| have a real street line (`FacilityStreetAddress1`) | **32 / 80 (40.0%)** |
| address types (first record) | `Default` 60 · `Physical` 5 · `Mailing` 3 |

Examples (the spread that matters):
- `256909` — `Default` — *"Price Field Office, 125 South 600 West, Price, UT, 84501"*
  → a full street address, but it is the **BLM field office**, not the facility's
  own site.
- `233860` — `Default` — *"CA"* → **state only**, no street or city.
- `232298`, `238890` — `Default` — *"WA"* → state only.

So of the 85% that carry *some* address record, a large share are **state-only**
(worthless — the corpus already knows state from `master_place.state`), only ~40%
carry a street line, and an unquantified slice of those street lines are
administrative/office/mailing addresses rather than the POI's physical location.

## 3. Root cause

**A fetch-parameter gap: `fetchPaginated` omits `full=true`, so RIDB returns
`FACILITYADDRESS` as an empty array for every facility.** Confirmed on three
independent legs: (a) the fetch code sets no `full` param; (b) 100% of our stored
raw has the key present-but-empty (the unexpanded signature, not a stripped
field); (c) the live API returns `[]` without `full=true` and real data with it.
The absent normalizer mapping is a *second*, downstream defect but is not the
binding cause — there is nothing in our raw to map.

This is the **same class** as the BLM `WEB_LINK` bug (real source data we weren't
capturing), but **one layer earlier**: BLM's data was already in our stored raw
and only needed re-normalization; RIDB's address is **not in our stored raw at
all**, so fixing it requires a **re-fetch from RIDB**, not just a re-normalize.

## 4. Proposed fix (NOT applied)

Three coordinated changes, in fetch → schema → normalize order:

1. **Fetch:** add `url.searchParams.set("full", "true")` in `fetchPaginated`
   (`ridb.ts:~166`). One line; inlines `FACILITYADDRESS` (and other sub-arrays) in
   the existing search response — no extra per-facility requests. Trade-off:
   `full=true` also inlines `ACTIVITY`/`LINK`/etc., enlarging `raw_payload`.
   (Alternative: a per-facility `/facilityaddresses` call = ~4,793 extra requests,
   slower and rate-limit-heavier — the `full=true` search is cheaper.)
2. **Schema:** declare `FACILITYADDRESS` on `FacilitySchema` (array of
   `{FacilityStreetAddress1/2/3, City, AddressStateCode, PostalCode,
   FacilityAddressType}`) — currently only kept via `.passthrough()`.
3. **Normalize:** in `normalizeFacility`, pick the best record (prefer
   `Physical` > a `Default`/`Mailing` that *has* a street line; **drop
   state-only records** as valueless) and map to a structured
   `normalized_payload.address` (or `contact.address`) — matching whatever the
   proposed `master_place_address` schema
   (`2026-08-21-address-coverage-survey.md` §6) settles on.

**Requires a re-ingest/backfill of RIDB**, because the address is not in our
stored raw — cannot be recovered by re-normalizing existing rows (unlike the BLM
fix). That is the real cost of this fix, and the reason to weigh it against just
geocoding.

**Estimated yield — flagged as an ESTIMATE, n=80, pending an actual fix:**
- ~**40%** of RIDB facilities carry a real street line → of the 4,793 stored
  facility rows, roughly **~1,900** would gain a street-level address
  (**ESTIMATE**; 40% × 4,793; a rough 95% band on the 40% sample rate is ~29–52%,
  i.e. ~1,400–2,500 rows).
- The count that gains the POI's **own physical** address is **lower still** and
  not quantified here — some street addresses are ranger-station/field-office
  addresses. This would need a per-record `FacilityAddressType`/content review the
  sample was too small to pin down.
- The other ~45% (state-only records) add nothing the corpus doesn't already have.

Net: a real, capturable gap, but its *useful* size is well under the 85%
raw-presence figure and materially below the survey's 5,642 headline — closer to
~1,900 street-level rows, fewer still that are the site's own address. This
tempers rather than confirms "RIDB fixes a big chunk of the address gap for free."

## Flags

- **Scope note:** this is `FACILITYADDRESS` (facilities only). RecAreas
  (`RecAreaSchema`, no address field) have a parallel `RECAREAADDRESS` that
  `full=true` would also inline — same root cause, not measured here, worth a
  separate pass if recarea addresses are wanted.
- **Preflight RIDB 401 is misleading:** the session-start preflight reported RIDB
  401, but the stored `RIDB_API_KEY` returned 200 on every call this
  investigation made. Whatever the preflight checks, the key is currently valid —
  don't read the 401 as "RIDB key dead."
- **Address quality caveat is the real finding for build/buy:** even fetched
  correctly, RIDB facility addresses skew toward mailing/administrative addresses
  and state-only stubs — for many backcountry facilities the "address" is a town
  ranger station, which is arguably *more* misleading for a trip-planner than no
  address. Reverse geocoding has the same physical-vs-nearest-town problem; RIDB
  doesn't obviously dodge it.
