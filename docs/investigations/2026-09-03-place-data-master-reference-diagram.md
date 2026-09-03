# Synthesis — one master-reference Paper diagram for all place-data sourcing

**Date:** 2026-09-03
**Branch:** `master-reference-diagram-place-data`, cut from
`category-resolve-theaters-park-renames` (PR #384's tip) at `5d811d3`, which
itself carries `origin/main` up to `e1c045d` (PR #379) plus the three
taxonomy-ADR commits from #380/#382/#384.
**Mode:** DIAGRAM-ONLY. No code changes. Read-only re-checks of the current
tree only — no DB queries, no live network calls this pass (prior measured
figures are cited by PR, not re-run).

**What this is:** a single new Paper artboard, *"Place Data — Master
Reference (sources, surfaces, categories)"*, in the file "Card data model and
ofrmation" (separate from the `resolvePlaces()`-specific diagram at node
`3R4-0`, per instruction). It synthesizes the full investigation chain in this
thread — #361, #364, #366, #367, #371, #373, #376, #380, #382, #384 — into
one plain-language reference covering: the five data sources, the four
UI surfaces, the `resolvePlaces()` unification effort, the 9-category
taxonomy, and known gaps. Every claim on it carries a confidence tag
(`VERIFIED THIS PASS` / `CITED #NNN` / `DESIGNED, NOT BUILT` / `OPEN`).

**Checked first, per instruction: are #380/#382/#384 merged?** No — verified
via `gh pr list` and `git log`. All three remain open PRs stacked as
`category-taxonomy-design` (#380) → `category-culture-and-interest` (#382,
merges main in, then adds its own commit) → `category-resolve-theaters-park-
renames` (#384, the tip). This PR is opened against that tip, not `main`,
per the task's own instruction to check first.

---

## The one correction this pass found, and why it matters

**The design brief this diagram was built from stated that Urban, Water
fill, Showers and Dump stations "were removed from the UI entirely."** Read
directly against `docs/decisions/2026-09-03-nine-category-taxonomy-canonical.md`
at the `category-resolve-theaters-park-renames` tip: **that is not what the
document says.**

- Its status line reads: *"Proposed — awaiting Adam's review. Design only; no
  implementation."*
- Its closing section states: *"The only substantive open item left is the
  original one: `urban` / water fill / showers / dump stations — keep as
  empty-state subtypes, or remove. The routing table §4 proposes an order; it
  is an argument, not an authorisation."*
- Confirmed structurally, not just by prose: `git diff --stat` from `0dae80c`
  to this branch's tip shows **zero files changed under `web/src/components`
  or `web/src/lib/trip-browse`** other than `#373`'s route-validation fix.
  `find-nearby-panel.tsx` still declares its original 6 groups / 13 buttons.
  Nothing has been removed from any screen because no UI code has changed at
  all.

This is exactly the class of error this thread has repeatedly flagged and
corrected in itself (#377's "do not characterise an artefact you have not
opened"). The diagram states the corrected version prominently — a dedicated
`OPEN — NOT DECIDED` callout in Section 4 — rather than silently building the
brief's premise into the design.

**Everything else in the brief matched current source directly.** The 9
category names, the Culture/Services cluster assignments, the per-category
routing verdicts, the Auto/Repair and Trailheads/Viewpoints findings, and the
fuel/EV mismatch were all re-checked (see below) and held.

---

## What was checked, and how (by diagram section)

### Section 1 — Data sources

- **Overpass** usage: grepped fresh. Exactly two callers in `web/src` —
  `resolveOvernights()` (`lib/trips/resolve-overnights.ts:29`) and
  `resolveSuggestions()` (`lib/trips/resolve-suggestions.ts:88`) — both
  trip-generation functions, neither on the browse/search request path.
- **Mapbox fuel-only swap**: re-confirmed `TYPES_BY_CATEGORY.fuel = []` in
  `google-places.ts:59` and `mapboxSearchBoxSource` at the head of both
  `resolve-places.ts` default source lists.
- **Foursquare's broken category search**: cited from #366's live HTTP
  probes (24 path/version/auth combinations, all 404) — not re-run this pass;
  no code touching this changed.

### Section 2 — The four surfaces

- **Surface 1**: cited from #361 (not independently re-run this pass — no
  code under `day-detail-corridor-column.tsx` changed since).
- **Surface 2**: re-verified fresh. `TRIP_BROWSE_USE_RESOLVER` still a real,
  default-off flag; the urban/interest 400 fix (#373) confirmed present via
  `git log` (commit `a6e3012`) and its own `route.test.ts` (9/9).
- **Surface 3**: re-verified fresh, and this is where the "still the old
  6-bucket UI" correction lives. `find-nearby-panel.tsx:84` still declares
  `BUCKETS` with `"CAMP & EXPLORE"`, `"FUEL & REPAIR"`, etc. — unchanged.
- **Day Column**: cited from #371/#377 (re-confirmed unchanged this pass via
  the same `git diff --stat` check above — no files under its render path
  changed).

### Section 3 — `resolvePlaces()` unification

Re-verified fresh: 3 importers in `src/app` (2 direct, 1 via
`enrichByGoogleId`), 0 in `src/components`; all three flags real and
default-off locally; no shared-cache dependency in `package.json`; the
day-corridor scope still `{start, end}` only. Line numbers shifted since
#373's edit (`TRIP_BROWSE_USE_RESOLVER` moved from `route.ts:39` to
`route.ts:120`) — re-grepped fresh rather than trusting the prior line
citation, confirming the "don't trust memory" discipline caught real drift.

### Section 4 — Category structure

Read `docs/decisions/2026-09-03-nine-category-taxonomy-canonical.md`,
`docs/architecture/category-subtype-mapping.md` and
`docs/architecture/category-source-routing-table.md` in full at the current
tip (all three explicitly stamped **"DESIGN ONLY. Not implemented, not
wired."**). The 9 names, the Culture cluster (Museums/Galleries/Historic
Sites, Theaters deliberately excluded), the Services cluster (Auto/Repair +
EV charging absorbed from `interest`, alongside the still-open amenities),
and the `park` → `scenic` routing decision are all stated as currently
written in those docs — cited, not re-derived, since they are themselves the
primary source.

### Section 5 — Gaps

All four gap rows are carried by citation from #364/#366's measured tables
(Auto/Repair coverage, Trailheads/Viewpoints reversal, the EV/gas fuel
inversion) — not re-measured this pass, since re-running live coverage
sampling was out of scope for a diagram-only pass and the underlying
adapters (`google-places.ts`, `mapbox-search-box.ts`, `foursquare.ts`) are
unchanged since those measurements.

---

## Scope and limits

- No database was queried this pass (unlike #371/#377, which measured the
  `master_place` enrichment-column counts). Nothing on this diagram states a
  number that required a fresh DB read.
- Live-coverage and Foursquare figures are all `CITED`, not `VERIFIED THIS
  PASS` — they were not re-run, per the confidence key on the diagram itself.
- This diagram describes the **taxonomy-ADR branch tip**, not `main`. If
  #380/#382/#384 are revised further before merging, Section 4 and the OPEN
  callout should be re-checked against whatever merges.
