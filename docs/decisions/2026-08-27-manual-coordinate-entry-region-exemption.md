# 2026-08-27 — Manual coordinate entry bypasses the planning-region gate

## Context

`/plan/expedition`'s destination rows are backed by Mapbox Geocoding v6
autocomplete (`location-autocomplete.tsx`) — see
`docs/architecture/trip-creation-surfaces.md` §2a. A prior read-only
investigation (this session) confirmed the pipeline already treats
coordinates as ground truth wherever a destination is consumed
(`preComputeFacts`, `routeBetween`, `itineraryToTrip`) — no `place_id` is
used anywhere downstream of the wizard, and `ExpeditionDestination.coords`
was already nullable. The one hard constraint in the whole path is
`isInPlanningRegion` (`lib/plan/planning-region.ts`): a strict-refuse gate
that requires a Mapbox `region_code` (CA/NV/UT/AZ/WA/OR), enforced both
client-side (autocomplete filters suggestions before render) and
server-side (`validateExpeditionForm`, called again inside
`generateExpeditionTripAction` before any LLM spend).

Adding a raw lat/lng entry point means that constraint has no `region_code`
to check — hand-typed coordinates carry no Mapbox response to read one
from. Two options: (a) reverse-geocode the typed point to recover a region
code and route it through the existing gate unchanged, or (b) exempt
hand-entered coordinates from the gate entirely.

## Decision

**(b) — hand-entered coordinates are exempt from the planning-region
gate.** This is a deliberate testing-scope shortcut, not a claim that the
gate's purpose stopped mattering. `ExpeditionDestination` gains a
`manualCoords: boolean` field, set `true` only by the new coordinate-entry
control; `validateExpeditionForm`'s region check reads
`!d.manualCoords && !isInPlanningRegion(d.region)` — narrowly scoped to
that one flag, not to "any destination with coords and no region," so a
future bug in the autocomplete path (e.g. a suggestion that slips through
without a region code) still fails closed instead of silently riding this
exemption.

Reverse-geocoding (option a) was not implemented. `reverseGeocodeCity`
(`lib/routing/reverse-geocode.ts`) already exists and returns a formatted
"City, ST" string via the same Mapbox v6 API, but does not currently expose
a discrete `region_code` — extending it was scoped out as unneeded for a
dev-only testing feature.

## Consequences

- A hand-entered coordinate **outside CA/NV/UT/AZ/WA/OR is accepted** and
  reaches generation. Downstream code that assumes in-region data
  (corridor-city gazetteer lookups, corpus fetches scoped to the six
  states) has not been audited against an out-of-region anchor — the
  underlying investigation confirmed the *type model* accepts it, not that
  every consumer *handles* it gracefully.
- The wizard is dev-only (`ENABLE_PLANNER_WIZARD` gate) and this is a
  minimal, ungated escape hatch within it — acceptable exposure for a
  testing surface, not something to carry into a production-facing
  coordinate-entry feature without revisiting this decision.
- If coordinate entry is ever promoted beyond testing, or the app's scope
  grows beyond six states, revisit: either wire `reverseGeocodeCity` to
  also return `region_code` and gate hand-entered coordinates the same way
  as autocomplete results, or make the exemption an explicit, reviewed
  product decision rather than a wizard default. Tracked in
  `docs/BACKLOG.md`.
