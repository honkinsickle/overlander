# Phase 1.5: iOverlander Source Integration

**Status:** Draft — pending Adam's review (budget numbers + wording adjustments not yet filled in)
**Sequence:** Fourth of five Segment B prerequisite specs (final source before corridor execution)
**Estimated effort:** Day to day-and-a-half (technical work); licensing negotiation runs in parallel and is the gating dependency
**PR scope:** Single focused PR adding iOverlander as a federated source
**Depends on:** Parks Canada, BC Parks, Alberta Parks specs landed (establishes the multi-source pipeline; iOverlander is the first UGC source in the system)

> **Revision note (2026-06-01):** This spec was revised to reflect iOverlander's actual current status as a **commercial entity (iOverlander, LLC)** on a paid-subscription model, replacing the original draft's outdated "Open Overland nonprofit / 501c3 / free open-data partnership" framing. The integration is now gated on a **commercial licensing agreement**, not a mission-aligned free data partnership. Budget figures in the Commercial Terms section are placeholders for Adam to fill in.

## Why this source

iOverlander is the canonical overlander-specific data source. ~150,000+ user-contributed points worldwide covering camping, water, propane, mechanics, laundry, showers, dump stations, and more — all in categories that matter specifically to overlanders. Strong Canada and Alaska coverage where US federal sources have nothing to say. Particularly valuable for dispersed camping, wild camping, free overnight pull-offs — the exact use case where federal/provincial-park data is silent.

This is also the first **UGC source** in the system. The data is contributed by overlanders, validated by other overlanders, and reflects current conditions in a way no authoritative database does. It's also less consistently structured than federal/provincial data — names, categories, and metadata vary by contributor.

Strategically, iOverlander fills the gap between:
- **Federal/provincial-park data** (authoritative but only covers managed sites)
- **OSM** (broad coverage but generic POI tagging, not overlander-specific categorization)
- **Google Places** (commercial POIs, weak on remote/dispersed sites)

Without iOverlander, Segment B coverage of *dispersed camping along the Alaska Highway / Cassiar Highway / Stewart-Cassiar* would be sparse. With it, this is where Segment B's value lives. This is the coverage gap that motivates pursuing a license: no other source we have or plan to add covers informal/dispersed sites in this corridor.

## Data source & licensing reality

iOverlander is operated by **iOverlander, LLC** — a **commercial entity**, not a nonprofit. As of 2025 it runs on a **paid-subscription model** for its apps and services. The company has publicly described itself as **"nearly broke."** That framing matters for how we approach them: this is a **vendor licensing** conversation, and a good-faith partnership should help **support their continued operation**, not try to extract their dataset for free under a "mission-aligned" pretext. We are a commercial product seeking to use a commercial vendor's data, and we should expect — and budget for — a licensing fee.

iOverlander **does not publish a formal, openly-licensed REST API.** Confirmed via web search and direct site inspection. Available access paths:

1. **KML/GPX exports from the website.** Per-country exports historically linked from the site; updated periodically. **License terms do not grant commercial derivative use** — personal use only, with commercial terms unaddressed or restricted. These exports are useful as a *data-shape reference for development*, but production ingestion is **not** permitted without an explicit commercial license.
2. **Commercial licensing inquiry to iOverlander, LLC.** This is the primary path: reach out to negotiate a commercial data license (bulk export, API access, or snapshot — see contingencies below). Email contact via the iOverlander site.
3. **Web scraping.** Violates ToS, and is especially indefensible against a paid-subscription commercial vendor that depends on this revenue. **Excluded as an option.**

**Licensing must be resolved before this PR can ship to production.** Implementation proceeds against the KML exports purely as a *data-shape reference for development and testing*; production ingestion is gated on a signed commercial license. The technical work does not block on the legal answer, but **production go-live does.**

## Commercial terms

This section is the substantive change from the original draft. It exists because iOverlander is a paying-customers-funded commercial vendor, not a nonprofit offering free data.

### Posture

- Approach as a **vendor licensing** conversation. We are licensing data from a commercial supplier.
- Acknowledge their economic reality: they are on a paid-subscription model and have described themselves as "nearly broke." A licensing fee that **supports their continued operation** is the expected and fair outcome — not something to negotiate to zero.
- A free-with-attribution arrangement is **not** the baseline expectation. Attribution is a *requirement layered on top of* a paid license, not a substitute for payment.

### Budget

- **Budget must account for a licensing fee.** This is a line item, not an afterthought.
- Opening position to communicate: *"willing to discuss in the **$X–$Y** range"* — **[Adam to fill in actual floor/ceiling numbers when reviewing this spec].**
- Structure is open: one-time fee, annual license, or per-update fee depending on which integration shape (below) we land on. The dollar range and the structure interact — a one-time snapshot and an ongoing API license are very different price conversations.

### Attribution requirements (commercial-use grade)

Because this is licensed commercial use of a commercial vendor's data, attribution must be **per-place and visible**, not buried. Specifically:

- **In-app attribution per place** — every place that uses iOverlander data carries an attribution, not just a single bottom-of-app credits screen.
- **Source attribution at the place-card level** — the place card shows **"iOverlander"** as a source, displayed **alongside any other federated sources** for that place (e.g., "Sources: Parks Canada · iOverlander"). This is consistent with how federation surfaces multiple contributing sources.
- **Link-back to iOverlander.com** — any place card that uses their data links back to iOverlander.com (to the specific place where a stable per-place URL exists, otherwise to the site).

These requirements should be confirmed in writing as part of the license terms, and they shape the place-card UI work that this integration implies.

## Integration approach contingencies

The integration shape depends entirely on what kind of license (if any) iOverlander agrees to. We sketch each likely response scenario at a high level so the technical plan can flex to the outcome.

### A. Licensed bulk export *(most likely)*
A periodic data dump (KML/GPX/CSV/DB extract) delivered under license.
- **Integration:** ingested via the **standard source-integration pattern** already established for Parks Canada / BC Parks / Alberta Parks — downloader → parser → normalizer → `source_record`. This is the lowest-friction path and reuses existing infrastructure.
- **Cadence:** depends on contract terms (e.g., quarterly, monthly). Re-ingest on the licensed cadence.
- **Effort:** matches the other Segment B source PRs (day to day-and-a-half).

### B. Licensed API access
Real-time or near-real-time query access under license.
- **Integration:** more complex — closer to how **RIDB or NPS** integrations work (live/periodic API queries rather than a static file). Requires a `client.ts` that handles auth, rate limits, and pagination against their API contract.
- **Tradeoff:** fresher data, but more moving parts and a stricter dependency on their uptime/rate limits.
- **Effort:** higher than A; scope carefully.

### C. One-time licensed snapshot
A single licensed data extract, no ongoing update rights.
- **Integration:** simplest — one-time ingest via the standard pattern, no scheduled re-download.
- **Tradeoff:** data goes **stale over time**; UGC freshness (the whole point of this source) decays. Updating requires **re-licensing** a new snapshot.
- **Effort:** lowest, but with a known and worsening freshness liability. Flag staleness in the place card if this path is taken.

### D. Not licensing data
iOverlander declines, or terms are unacceptable.
- **Integration:** **deferred.** Phase 1.5 ships with **3 of 4 sources** (Parks Canada, BC Parks, Alberta Parks).
- **Tracked item:** record that **iOverlander coverage — and therefore dispersed/informal camping coverage in the Segment B corridor — is unaddressed**, to be revisited. This is an honest coverage gap, not a silent omission.

### E. Revenue-share / referral structure
iOverlander proposes a referral or revenue-share arrangement instead of a data license.
- **Integration:** substantially different — we would **link out to iOverlander.com** rather than ingest and federate their data. Requires **legal review**.
- **Priority:** **lower.** A referral/link-out model does **not** solve the campsite-coverage problem that motivates this integration — the dispersed-camping data would not appear in our own federated search/place results. Worth noting, but it's a different product decision, not a fix for the coverage gap.

### F. No response after 2–3 weeks
- Treat as **effective "not licensing"** (scenario D). Ship Phase 1.5 with 3 of 4 sources, file the tracked coverage-gap item, and revisit later. Do not let an open-ended non-response block the corridor work indefinitely.

## Categories this source covers

iOverlander's native taxonomy includes:

- **Camping:** Established Campground, Informal Campsite, Wild Camping, Park4Night
- **Water:** Potable, Non-Potable, Drinking Fountain
- **Sanitation:** Public Toilet, Dump Station, Pay Showers
- **Services:** Propane, Mechanics, Laundry, Wifi, Grocery
- **Transit:** Border Crossing, Ferry, Toll Road

Maps to OVERLANDER_01 canonical categories:
- iOverlander `Established Campground` → existing `campground`
- iOverlander `Informal Campsite` / `Wild Camping` → new `dispersed_camping` (see below)
- iOverlander `Potable Water` → existing or new `water_source`
- iOverlander `Dump Station` → existing `dump_station`
- iOverlander `Propane` → new `propane_fill` or existing `gas_station` (decide during implementation)
- iOverlander `Mechanics` → new `mechanic` or out-of-scope
- iOverlander `Laundry`, `Pay Showers`, `Wifi` → new `services` umbrella or out-of-scope for V1

**New canonical category to add:**
- `dispersed_camping` — informal/wild camping, distinct from established campgrounds. Critical for the overlander use case; federal BLM dispersed (when that source lands) will use the same category.

**Decisions deferred to implementation:**
- Whether `propane_fill`, `mechanic`, `services` warrant new canonical categories or are out-of-scope for V1. Default: include if they appear in the corridor data with non-trivial volume; defer otherwise.

## New canonical fields

UGC contributors capture signals not present in authoritative sources. Likely new fields:

- **`overlander_tags`** *(primary)* — UGC contributors specify things like "vehicles up to 25ft", "no cell service", "free", "noisy", "great views" — overlander-relevant signals not captured in existing canonical fields. Store as a JSONB array on `normalized_payload`. Surface in search and place cards.
- **Freeform notes** — the UGC commentary / description body itself, which for dispersed sites is iOverlander's unique value (no authoritative source has descriptions of informal pull-offs at all).
- **`last_traveler_verification_date`** *(likely)* — the date a traveler last visited/verified the site. Drives a "last verified" freshness signal on the place card and is especially important for the **C. one-time snapshot** scenario where overall data staleness is a concern.

Implementation note: adding a new canonical field touches more code than adding a source. Scope carefully — start with `overlander_tags` (and the freeform notes body, which the normalizer already needs) as the core additions; treat `last_traveler_verification_date` as the next field in if the licensed data carries it; defer other UGC-specific fields (`verified_by_user_count`, etc.) to V2.

## Federation behavior (UGC augments, does not override)

The governing principle for this UGC source: **iOverlander data should *augment* government data when both exist for the same place, not *override* it.**

When a place exists in both an authoritative source (e.g., RIDB / Parks Canada) and iOverlander (e.g., a campground present in both):
- **iOverlander wins** on fields government sources don't have or keep current: **recent visit notes, current conditions, traveler tags** (`overlander_tags`), `last_traveler_verification_date`.
- **iOverlander loses** on **authoritative fields**: official **name**, official **URL**, **regulations/fees**, capacity. Government sources are canonical for those.

This is exactly the behavior the field-precedence table encodes (below) — UGC ranks high on the freshness/condition fields and low on the authoritative-identity fields.

### Field precedence — base seed status

The base seed (`supabase/migrations/20260527121000_phase1_seed_field_precedence.sql`) already includes iOverlander priorities. Current values, and whether they still make sense given the augment-not-override principle:

| Field key | Current iOverlander priority | Assessment |
|---|---|---|
| `canonical_name` | 4 (below NPS/Google/RIDB, above OSM) | ✅ Keep — authoritative sources own the name. |
| `primary_category` | 5 (lowest) | ✅ Keep — UGC categorization is inconsistent. |
| `geometry` | 4 (above OSM only) | ✅ Keep — UGC coords are coarse (mobile GPS at submission). |
| `description` | 4 | ⚠️ **Reconsider.** For `dispersed_camping` / informal sites, iOverlander is the *only* source with a description and should arguably rank **1 for those categories**. Propose a category-scoped override rather than a flat bump. |
| `amenities` | **1** (highest) | ✅ Keep — UGC is the freshest signal for amenities that change. |
| `hours` | 5 (lowest) | ✅ Keep — informal sites have no hours; authoritative sources own hours where they exist. |
| `contact` | 5 (lowest) | ✅ Keep — authoritative sources own contact info. |
| `access` | **1** (highest) | ✅ Keep — road type / vehicle suitability / fees-on-the-ground is exactly the traveler-reported signal UGC is best at. |
| `services` | 2 (below Google) | ✅ Keep. |
| `capacity` | 3 (below RIDB/NPS) | ✅ Keep — authoritative sources own capacity. |
| `seasonality` | 4 | ✅ Keep. |
| `cell_signal` | **1** (iOverlander only) | ✅ Keep — only iOverlander reports this. |

**Net:** the existing `amenities=1` / `access=1` / `cell_signal=1` highs and `contact=5` / `hours=5` lows are consistent with augment-not-override and should be confirmed as-is. The one proposed change is a **category-scoped `description` precedence** so iOverlander wins `description` for `dispersed_camping`/informal categories while staying at 4 elsewhere. File that as the precedence decision to make during implementation.

> Note: the original draft referenced only "amenities at priority 1 and contact/hours at priority 5." The actual base seed is richer (it also seeds `access`, `services`, `capacity`, `seasonality`, `cell_signal`, etc.). The table above reflects the real seed.

## Source quality score

Recommended `source_quality_score = 60` (vs federal 100/95, provincial 90, RIDB 85, Google 70, OSM 50).

Below Google (commercial POI data has more consistent quality) but above OSM (overlander-specific curation beats generic POI tagging for the use case). Operationally this means: in tie-breaking situations, iOverlander loses to most sources for `canonical_name`/`geometry` but wins for the fields only it has (`overlander_tags`, `cell_signal`, traveler-reported `access`).

## Match rules — does iOverlander participate in:

This is where UGC sources behave differently from authoritative ones.

- **`fed_exact` (≤10m federal-pair anchor):** NO. Reserved for federal-source pairs.
- **`amenity_rollup` (≤100m parent anchor):** YES, but with caution. An iOverlander potable-water point near an established Parks Canada campground should roll up. An iOverlander dispersed-camping point should NOT roll up into anything (it stands alone).
- **`name_dominant`:** YES, but cautiously. UGC names like "Free BLM camping" or "Dispersed near Highway 1" won't match anything via name; in practice this rule rarely fires for iOverlander.
- **`close_nameless`:** YES. This is the rule iOverlander dispersed-camping points will *primarily* trigger — close to nothing else, no name match. Queued for manual_review by default.
- **Same-source guard:** YES. Two iOverlander records of the same name should never auto-merge (each is a discrete UGC submission).

**Federation between UGC and authoritative sources.**

When iOverlander has a record near (within 100m) of an authoritative source's record (e.g., near an established Parks Canada campground), the right behavior depends on type:

- **iOverlander dispersed_camping near authoritative campground:** do NOT merge. Distinct concept — dispersed camping outside the established campground is what overlanders sometimes look for adjacent to known sites.
- **iOverlander potable water near authoritative campground:** merge via amenity_rollup as a service of that campground.
- **iOverlander review/notes on an established campground:** federate via name_dominant if names match — the iOverlander notes/tags/conditions **augment** the authoritative record per the precedence table; otherwise leave as a separate UGC record near the campground.

This nuance probably requires either (a) a new match rule, or (b) tightening `amenity_rollup`'s category filter to exclude iOverlander's camping categories from rolling up. Defer the decision to implementation — start with the simplest viable behavior (let existing rules fire, evaluate the federation results, adjust if needed), file as a tracked item if rules need tuning.

## Ingestion implementation

> Applies to scenarios **A (bulk export)** and **C (snapshot)** directly, and is adapted for **B (API)** by swapping the file downloader for an API client. Not applicable to **D/E/F**.

**Directory:** `data/ingestion/ioverlander/`

**Files:**
- `client.ts` — for **A/C**: downloader for the licensed per-country export, caching the source file locally with cache invalidation (re-download on the licensed cadence). For **B**: API client handling auth, rate limits, and pagination against iOverlander's API contract.
- `parser.ts` — KML/GPX (or API-response) parser extracting points with all metadata (categories, descriptions, amenities, overlander_tags, traveler verification dates)
- `normalizer.ts` — transforms parsed records into canonical `normalized_payload` including the new `overlander_tags` field, freeform notes body, and `last_traveler_verification_date` where available
- `index.ts` — orchestrator: fetches, parses, filters by bbox (since exports are whole-country), batches, writes to `source_record`

**Inputs:**
- bbox (filter applied client-side since the source exports are whole-country)
- Optional country list (Canada + US for Segment A retrofit + B; eventually all)

**Outputs:**
- `source_record` rows with `source_id = 'ioverlander'`, raw feature + normalized payload
- Ledger entry per ingestion run

**Rate limiting:** N/A for an export download (single file). For API access (**B**), honor the contracted rate limits. Be polite regardless — don't re-fetch more often than the license cadence requires.

**Pagination:** N/A for a single KML file (parsed in-memory); for API access, paginate per their contract.

**Idempotency:** `(source_id, external_id)` upsert key. iOverlander assigns stable IDs to submissions; use those.

## Bbox strategy

Single enclosing rectangle for the BC + Alberta + Yukon portion of Segment B. For initial integration testing, use a tight bbox around the Alaska Highway (Dawson Creek area) — high iOverlander density, mix of categories.

Initial test bbox (Dawson Creek / Mile 0 of Alaska Highway): `[-121.0, 55.5, -120.0, 56.0]`

## Validation criteria

Pre-merge integration testing:

1. **Commercial license signed** (scenario A/B/C) — no ingestion to production without an executed license. Development/test ingestion against the export-as-reference is fine pre-license; production is not.
2. **Attribution wired up** — per-place in-app attribution, "iOverlander" shown at place-card source level alongside other federated sources, and link-back to iOverlander.com — all present for any place using their data.
3. **Ingestion against test bbox:** Dawson Creek area returns expected mix (some established campgrounds, several dispersed sites, water/dump/propane services).
4. **New canonical category** `dispersed_camping` migration applied to test + prod.
5. **New canonical fields** (`overlander_tags`, freeform notes, `last_traveler_verification_date`) migration applied (JSONB column on `normalized_payload`, or extension of existing JSONB schema).
6. **Normalizer correctness:** spot-check 10 records across multiple iOverlander categories.
7. **No regressions:** D4 suite on JT corpus still 12/12 with identical outcome distribution.
8. **field_precedence migration** applies cleanly (including any category-scoped `description` override).
9. **Federation behavior on synthetic data:** test that an iOverlander dispersed-camping point near a Parks Canada campground stays separate, an iOverlander water point near the same campground rolls up, and iOverlander notes/tags on a name-matched campground **augment** the authoritative record (do not overwrite name/URL/regulations).

## Out of scope (filed as future work, not bundled)

- **Other UGC sources** (Park4Night, FreeRoam) — separate evaluation, each with its own licensing reality, after iOverlander integration patterns are proven.
- **User-submitted reviews/ratings on iOverlander records** — beyond ingesting the licensed static export; live review polling deferred.
- **iOverlander images/photos** — exports don't include media reliably, and media likely carries separate license terms; defer to V2 with a separate media-handling architecture.
- **OVERLANDER_01 native UGC layer** (users contributing reviews/photos on master_places) — long-term moat, separate Phase 5+ work.
- **Live-update polling** for iOverlander changes — start with licensed-cadence re-fetch; push notifications would be V2.
- **Multi-country expansion** beyond Canada + US — start with the corridor scope, expand as Segments C+ require (and as the license scope allows).

## Open questions to resolve during implementation

1. **License terms (highest priority).** Commercial licensing inquiry to iOverlander, LLC. Which scenario (A/B/C/D/E/F) lands determines integration shape. Production ingestion is gated on a signed license.
2. **Budget range.** Adam to set the `$X–$Y` floor/ceiling and preferred fee structure (one-time vs annual vs per-update) before approaching iOverlander.
3. **`overlander_tags` schema.** Flat array of strings, or structured (tag + source contributor + date)? Default: flat array of strings for V1; structured if needed later.
4. **`description` precedence scoping.** Category-scoped override so iOverlander wins `description` for dispersed/informal categories while staying at 4 elsewhere — confirm during implementation.
5. **Category mapping completeness.** iOverlander has ~30 native categories; not all map cleanly. Decide which become new canonical categories vs out-of-scope vs deferred.
6. **Federation rule tuning.** Does the dispersed-vs-established distinction require a new match rule, or does tightening amenity_rollup's category filter suffice? Default: try the simpler path first.
7. **Re-fetch cadence.** Governed by the license terms (scenario A/B). Default to the contracted cadence; for a snapshot (C), there is no re-fetch without re-licensing.
8. **KML parser library choice** (scenarios A/C). Several mature libraries exist for Node (e.g., `@tmcw/togeojson`); pick during implementation.

## Success criteria

Integration is "done" when:
- ✓ Commercial license signed (scenario A/B/C) with acceptable terms — or scenario D/E/F decision recorded and the coverage-gap tracked item filed.
- ✓ Attribution requirements implemented (per-place, place-card source-level "iOverlander", link-back to iOverlander.com).
- ✓ Ingestion runs cleanly against test bbox (Dawson Creek area).
- ✓ Normalizer maps iOverlander categories to canonical schema; new `dispersed_camping` category added.
- ✓ New fields (`overlander_tags`, freeform notes, `last_traveler_verification_date`) added to `normalized_payload`, populated for relevant records.
- ✓ field_precedence migration applied to test + prod (with any category-scoped `description` override).
- ✓ source_quality_score row added.
- ✓ D4 on JT corpus still 12/12 identical.
- ✓ Federation behavior synthetic test passes (dispersed stays separate, water rolls up, name-matched record is augmented not overwritten).
- ✓ PR merged.

If the outcome is **D/E/F (no license / referral-only / no response)**: Phase 1.5 is "done" shipping **3 of 4 sources**, with the iOverlander coverage gap recorded as a tracked item to revisit.

After this lands (or is explicitly deferred), the Segment B corridor execution spec is the final one — all integrated sources ready to run the corridor.

## Risk register specific to this spec

- **Licensing risk (primary):** iOverlander, LLC is a commercial vendor on a paid-subscription model and may price the license above our range, decline, or not respond. Mitigation: set the budget range up front, pursue the licensing inquiry in parallel with development-against-reference-data, and have the **D/F fallback** (ship 3 of 4 sources, file the coverage-gap tracked item) ready so the corridor work never blocks on the legal answer.
- **Cost risk:** the licensing fee is a real, recurring line item (especially under an annual or per-update structure). The budget range must be set before negotiation, not discovered during it.
- **Data freshness risk (scenario C):** a one-time snapshot decays. UGC freshness is the whole value of this source; a stale snapshot undermines it. Mitigation: surface `last_traveler_verification_date` on the place card and plan for re-licensing if C is the path.
- **Data quality risk:** UGC data varies. The system handles "low-confidence" data via match rules and field_precedence (already designed for this), but unexpected edge cases will surface during ingestion.
- **Federation complexity risk:** the dispersed-vs-established / augment-not-override nuance is the most novel federation behavior in the system to date. If implementation reveals it requires a new match rule (not just precedence tuning), scope creeps. Mitigation: ship the simplest viable behavior first, file edge cases as tracked items, iterate.
- **Implementation surface area risk:** new canonical category + new canonical fields + attribution UI work + new match-rule consideration in one PR is more scope than the other source-integration PRs. If this becomes unwieldy, split into "ingestion only" PR + "federation/attribution" PR.
