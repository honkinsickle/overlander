# ADR — Operational Status Normalization

**Date:** 2026-08-31
**Status:** Implemented (awaiting migration apply + backfill)

## Context

PR #320 added `isClosedDescription()` — a description-text heuristic to filter
closed places from display. The spec at `docs/specs/operational-status-normalization.md`
investigated structured alternatives and found USFS carries `seasonal_operational_status`
on 100% of its 6,324 site rows (279 CLOSED, 241 visible on display surfaces).

RIDB was expected to carry `FacilityStatus` based on API documentation. Measured
on both the search endpoint AND the individual facility detail endpoint: **the
field does not exist** in the RIDB API v1 response. 0/4,793 facilities carry it.

## Decision

1. Add `operational_status` TEXT column to `master_place`. NULL = OPEN or
   no structured signal. Only non-OPEN values written.

2. Extend `recompute_master_place()` via the field_precedence pattern (Option A)
   to resolve `operational_status` from `normalized_payload`.

3. USFS normalizer writes `operational_status` from
   `props.seasonal_operational_status` (OPEN → null, CLOSED/etc. → stored).

4. Display filter (`isClosedPlace`) uses a tiered approach:
   - `operational_status = CLOSED | DECOMMISSIONED` → always filtered
   - `operational_status = REDUCED SERVICES | UNREACHABLE` → filtered
     only when the row has no corpus photo (`nps_photo_url`)
   - `operational_status = NULL` → fall back to `isClosedDescription()`
     heuristic for sources without structured status

5. `pois_along_corridor` RPC: exclude `CLOSED`/`DECOMMISSIONED` at the
   SQL level. Surface `operational_status` in RETURNS TABLE.

6. `master_place_search_export` view: exclude `CLOSED`/`DECOMMISSIONED`
   so they don't enter the Typesense index.

## Consequences

- 241 currently-visible USFS places with `seasonal_operational_status = CLOSED`
  will be filtered from all display surfaces once the backfill runs.
- Sources without structured status (NPS, RIDB, OSM, Atlas Oddities, etc.)
  still rely on the description heuristic — ~152 rows on TEST.
- RIDB `FacilityStatus` is confirmed absent from the API (both search and
  detail endpoints). No further investigation planned unless the API changes.
- Future sources that carry an operational status can be added by: (a) emitting
  `operational_status` in their normalizer, (b) adding a `field_precedence`
  row with appropriate priority.
