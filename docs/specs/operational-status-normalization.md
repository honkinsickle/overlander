# Spec — Operational Status Normalization

**Status:** SCOPING ONLY. Investigation complete, plan proposed. Not built,
not committed to any branch beyond this document. For Adam's review.

**Context:** PR #320 added `isClosedDescription()` — a description-text
heuristic that filters closed places from display surfaces. It works (~97%
precision) but is inherently fragile: it mines free-text descriptions for
closure language rather than reading a structured field. This spec scopes
the structured-field alternative.

---

## 1. Investigation: what structured status data exists today?

Measured on TEST (2026-08-31) by querying `source_record.raw_payload` across
all source_ids in the corpus.

### USFS — actionable structured status data exists

USFS is the **only** source with structured operational-status fields in
`raw_payload`. Both are populated on 100% of USFS rows (no nulls):

| Field | Location in raw_payload | Row type | Population | Values |
|---|---|---|---|---|
| `seasonal_operational_status` | `raw_payload.props.seasonal_operational_status` | `usfs:site:*` (6,324 rows) | 6,324/6,324 (100%) | `OPEN`: 6,042; `CLOSED`: 279; `OPEN WITH REDUCED SERVICES`: 3 |
| `openstatus` | `raw_payload.props.openstatus` | `usfs:recarea:*` (6 rows) | 6/6 (100%) | `open`: 2; `temporarily closed`: 3; `unreachable`: 1 |
| `development_status` | `raw_payload.props.development_status` | `usfs:site:*` | 6,324/6,324 (100%) | `EXISTING`: 6,324 (uniform, not useful for closure) |

**Cross-reference with visibility:** Of the 279 USFS sites with
`seasonal_operational_status = CLOSED`, 242 are linked to a `master_place`
and 241 of those are currently visible (`is_searchable = true`,
`source_count > 0`). These 241 places appear on display surfaces today
with no closure signal.

The USFS normalizer (`data/ingestion/sources/usfs.ts`) does NOT currently
read `seasonal_operational_status` or `openstatus`. The fields survive only
because `InfraPropsSchema` uses `.passthrough()`.

### RIDB — no structured status data

The earlier exploration (PR #320 investigation) reported that RIDB's API
carries a `FacilityStatus` field. **This is incorrect as measured.**
Inspection of all 4,793 RIDB facility rows on TEST shows `FacilityStatus`
is **not present** in any `raw_payload.facility` object — it is simply not
returned by the RIDB `/facilities` search endpoint. The 34 keys present
on every facility row were enumerated; `FacilityStatus` is not among them.

RIDB RecArea rows (1,220) also carry no status-like field. The RecArea
schema returns 20 keys; none is status-related.

### Other sources — no structured status data

| Source | Rows on TEST | Status field in raw_payload? | Notes |
|---|---|---|---|
| NPS | 5,283 | No | `operatingHours` is a schedule, not a status flag. No `campgroundStatus` or equivalent. |
| BLM | 876 | No | No status-like fields in `raw_payload.props`. |
| OSM | 109,492 | No | `opening_hours` is a schedule string. `disused:*`/`abandoned:*` tags are excluded at the Overpass query level. |
| State parks (CA/OR/WA/AZ/NV/UT) | 0 | N/A | No rows ingested on TEST. WA's `Filter` field ("active"/"inactive") is used as an ingest-time exclusion, not persisted. |
| Alberta Parks | 0 | N/A | No rows on TEST. Code comment mentions a `STATUS` field not normalized; unmeasurable. |
| Google | 263 | No | `businessStatus` deliberately excluded from field mask (30-day caching restriction). |
| Atlas Oddities | 2,870 | No | No status concept in the CSV/scrape pipeline. |
| Wikipedia | 31 | No | |
| Family Destinations | 14 | No | |
| Editorial Food | 568 | No | |
| PADUS | 37,701 | No | `GAP_Sts` is conservation gap status, not operational. |

### Summary

**USFS is the only source with actionable structured status data.** RIDB
does not carry it despite documentation suggesting otherwise. All other
sources either lack a status field entirely or use schedule-shaped data
(hours) rather than a categorical open/closed signal.

---

## 2. Proposed plan

### 2.1 Add `operational_status` to `normalized_payload` (USFS normalizer)

Add `operational_status` to the USFS normalizer's output in
`data/ingestion/sources/usfs.ts`:

```
// In normalizeSite():
operational_status: props.seasonal_operational_status?.toUpperCase() ?? null,

// In normalizeRecArea():
operational_status: props.openstatus?.toUpperCase() ?? null,
```

Values would be normalized to uppercase: `OPEN`, `CLOSED`,
`OPEN WITH REDUCED SERVICES`, `TEMPORARILY CLOSED`, `UNREACHABLE`.

### 2.2 Add `operational_status` column to `master_place`

New migration:

```sql
ALTER TABLE public.master_place
  ADD COLUMN operational_status text;

COMMENT ON COLUMN public.master_place.operational_status IS
  'Structured open/closed status from source data. NULL = no structured '
  'signal available (fall back to description heuristic). Values: OPEN, '
  'CLOSED, TEMPORARILY_CLOSED, DECOMMISSIONED, REDUCED_SERVICES.';
```

### 2.3 Extend `recompute_master_place()` to carry `operational_status`

Two options for how `operational_status` flows from `source_record` to
`master_place`:

**Option A — field_precedence route (matches existing pattern):**
Add `operational_status` to the `v_jsonb_fields` array in
`recompute_master_place()` and seed a `field_precedence` row for each source
that carries it (currently only `usfs`). Pro: consistent with the existing
11-field resolve pattern. Con: `operational_status` is categorically
different from description/hours/contact — it's a state flag, not content.
The field_precedence JSONB resolution extracts from
`normalized_payload->'operational_status'`, which would work if the value
is stored as a JSON string.

**Option B — direct read (simpler for a single-source field):**
Add a dedicated step to `recompute_master_place()` that reads
`operational_status` from the highest-priority active source_record that
carries it, outside the `v_jsonb_fields` loop. Pro: cleaner for a field
that is NULL on most sources. Con: one more special case in the function.

### 2.4 Surface in display-layer queries

Add `operational_status` to:
- `pois_along_corridor` RPC's SELECT and RETURNS TABLE
- `master_place_search_export` view's SELECT
- `MasterPlaceRow` type in `web/src/lib/trip-browse/federated.ts`

### 2.5 Interaction with `isClosedDescription()` (PR #320)

The display filter should prefer the structured field when available and
fall back to the description heuristic:

```typescript
export function isClosedPlace(
  operationalStatus: string | null,
  description: string | null,
): boolean {
  // Structured field wins when present
  if (operationalStatus != null) {
    const s = operationalStatus.toUpperCase();
    return s === "CLOSED" || s === "TEMPORARILY_CLOSED"
      || s === "DECOMMISSIONED";  // ← open question, see §3
  }
  // Fall back to description heuristic for sources without structured status
  return isClosedDescription(description);
}
```

This replaces `isClosedDescription()` at the three call sites, keeping the
heuristic as the fallback for the ~90% of the corpus (NPS, RIDB, OSM,
Atlas Oddities, etc.) that has no structured status field.

### 2.6 Backfill

A one-time backfill script to populate `operational_status` on existing
USFS-linked `master_place` rows from `source_record.raw_payload.props`:
- Read `seasonal_operational_status` (sites) or `openstatus` (recareas)
- Write to `master_place.operational_status` for linked rows
- Scope: ~6,330 USFS source_records → their linked master_places

The normalizer change (§2.1) means future ingestion runs populate it
automatically; the backfill covers the existing corpus.

---

## 3. Open questions

**Q1: Should `DECOMMISSIONED` be treated the same as `CLOSED` for display
filtering?**
No USFS rows on TEST carry this value (all are `EXISTING` under
`development_status`). RIDB was the source expected to carry it, but RIDB
has no status field. If a future source emits `DECOMMISSIONED`, should it
be hidden from display (same as closed) or shown with a visual indicator
("permanently closed")? The current heuristic treats "permanently closed"
identically to other closures — same behavior seems right, but flagging.

**Q2: Should `OPEN WITH REDUCED SERVICES` / `UNREACHABLE` be filtered?**
Only 4 rows carry these values (3 + 1). They are arguably open but
degraded. The conservative choice is to display them (not filter) since
the place is still visitable, but possibly with a future UI indicator.
Recommend: do NOT filter these — filter only `CLOSED` and
`TEMPORARILY_CLOSED`.

**Q3: Should `operational_status` also drive Typesense indexing?**
Currently the Typesense sync indexes from `master_place_search_export`.
If `operational_status` is added to the view's WHERE clause (exclude
CLOSED), closed places would be un-searchable. If added as a facet field
instead, they'd be searchable but filterable. The description heuristic
(PR #320) currently filters at hydration time, so closed places ARE in
the Typesense index but fail to render as cards. Recommend: same behavior
— include in the index, filter at display time — until a product decision
says otherwise.

**Q4: Which `recompute_master_place` extension pattern (Option A vs B)?**
Option A (field_precedence) is the established pattern and keeps the
function uniform. Option B (direct read) is simpler for a field only one
source carries. Recommend Option B for now — it can migrate to Option A
if/when a second source gains a status field.

**Q5: Does RIDB actually have FacilityStatus on a different endpoint?**
The `/facilities` search endpoint (with lat/lng/radius params) does not
return `FacilityStatus`. It may exist on the individual facility endpoint
(`/facilities/{id}`) or require an explicit `fields` parameter. This would
mean a second API call per facility during ingestion — likely not worth it
for a single field, but worth knowing. Unmeasured.

**Q6: Should `operational_status = OPEN` be written, or only non-open?**
Writing `OPEN` for USFS rows means the field is populated but the value is
"normal." Writing only `CLOSED`/etc. and leaving `OPEN` as NULL means NULL
is ambiguous between "open" and "no data." Recommend: write all values
including `OPEN`, so NULL unambiguously means "no structured status
available from any source."

---

## 4. Estimated scope

| Step | Files touched | Migration? | Risk |
|---|---|---|---|
| 2.1 USFS normalizer | `data/ingestion/sources/usfs.ts` | No | Low |
| 2.2 master_place column | 1 migration | Yes (ALTER TABLE, additive) | Low |
| 2.3 recompute extension | 1 migration (CREATE OR REPLACE) | Yes | Medium — touches the core recompute function |
| 2.4 Query surface | 1 migration (RPC + view) + `federated.ts` type | Yes | Low |
| 2.5 Display filter | `federated.ts`, `hydrate.ts`, `bake-corridors.ts` | No | Low — replaces existing predicate |
| 2.6 Backfill | 1 script | No | Low — read raw_payload, write master_place |

Total: ~3 migrations, ~5 TS files, 1 backfill script. The recompute
function change (2.3) is the only medium-risk item.
