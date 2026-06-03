# 2026-06-02 — Land-status + dispersed-camping sources (PAD-US/SMA, USFS, OSM camp, BC Rec Sites)

## Status

Decisions **approved 2026-06-02**. This ADR is the durable record sizing the
next build phase (corridor-scoped land status). No code, ingestion, or schema
has been written against it yet. Phase 1 begins with the PAD-US `external_id`
key decision (see Consequences → Next).

## Resolved decisions (durable record)

1. **Combined land-status source, not siblings.** PAD-US 4.1 is the primary
   land-manager polygon source; BLM SMA is the BLM/USFS surface-jurisdiction
   tie-breaker. They ingest as **one** logical source (dedup on geometry +
   manager), never as two co-equal sources — two sources over the same ground
   would recreate the same-source-adjacency `manual_review` blowup (the
   per-campsite campground flood) at continental scale.

2. **Split entity model.** Named, destination-worthy units (National Forests,
   National Monuments, NCAs, Wilderness, designated rec areas) → **searchable**
   `master_place` via the existing `park_boundary` path. Generic
   ownership/jurisdiction parcels (the ~450k-feature bulk) → a **search-excluded
   containment layer**: same `geometry_polygon` + `place_relationships` (3b)
   machinery as containment parents and land-manager taggers, but flagged out of
   `master_place_search_export` so they never surface in Typesense.

3. **Coarse, derived, caveated legality.** A `dispersed_camping ∈
   {likely_allowed, likely_restricted, unknown}` flag derived at ER time from
   land manager + designation (optionally refined by an MVUM-corridor boolean),
   **always paired with a mandatory, user-visible `verify_locally` caveat.** No
   per-route/per-vehicle/seasonal MVUM modeling in this phase.

## Context

Phase 1 (data foundation) federates POIs against the LA→Deadhorse corridor.
The four sources sized here add public-land context and the first
dispersed-camping signal:

- **PAD-US + BLM SMA** — land-status / land-manager polygons (who manages the
  surface, what designation, what public access).
- **USFS rec + MVUM** — federal campgrounds, dispersed-camping points, and
  motorized-route corridors.
- **OSM camp nodes** — informal/backcountry camp coverage (existing `osm`
  source, extended geography).
- **BC Rec Sites** — Rec Sites & Trails BC recreation sites for the Canadian
  segment, plus BC/Yukon Crown land as land status.

Driving constraints: the current prod corpus is ~18k `source_record`s; PAD-US
CONUS alone is an estimated ~400k–480k polygons (~25× the corpus). The
campsite-flood incident (2026-06-02) proved that same-source same-name/adjacent
records at volume flood `manual_review` via the `name_dominant` same-source
guard → blended-residual 0.6. Any continental land layer must avoid recreating
that, and must not swamp the search index with non-place parcels.

All polygon counts below are **estimates to confirm** via each service's
`…/query?where=1=1&returnCountOnly=true` at the corridor bbox before committing
to volume.

## Decision

### Sources, access, staging

| Source | Origin | Access | Geometry | Key fields |
|---|---|---|---|---|
| PAD-US 4.1 | USGS GAP | bulk GDB + ArcGIS REST (USGS / EDW_PADUS_01) | polygon | `Mang_Name`, `Mang_Type`, `Own_Type`, `Des_Tp`, `GAP_Sts`, `Pub_Access` (OA/RA/XA/UK), `Unit_Nm` |
| BLM SMA national | BLM | gis.blm.gov ArcGIS REST (per-agency layers) + hub FeatureServer | polygon | surface-managing agency code |
| USFS rec + MVUM | USFS EDW | EDW_RecreationOpportunities_01 (pts), Recreation Sites, EDW_MVUM_01 (lines) | point + line | `markertype` (incl. "Dispersed Camping"), `RECAREANAME` |
| BC Rec Sites | DataBC | BCGW **WFS** (openmaps.gov.bc.ca): `FTEN_REC_SITE_POINTS_SVW`, `FTEN_RECREATION_POLY_SVW` | point + polygon | rec-site name, file/project id |
| BC/Yukon Crown land | BC Tantalis / GeoYukon | DataBC WFS / GeoYukon REST | polygon | tenure/disposition → dissolve to Crown-vs-private |

**Estimated polygon counts (confirm at build):** PAD-US lower-48 ~400k–480k
(count dominated by Fee-class ownership parcels, not federal units); PAD-US
Alaska ~5k–15k (**few features, most acreage** — large contiguous federal/ANCSA
units, sparse roads → the containment layer, not camp points, is the primary
value in AK); BLM SMA national ~100k–300k; BC/Yukon **corridor-clipped** low
thousands.

**Staging — corridor-first, never bulk-load CONUS.** Mirror the existing
JT-smoke → Segment A → Segment B segmentation:
1. Clip all four to a buffer around the LA→Deadhorse corridor (a `--bbox` arg to
   the same `fetchEsriFeatures` path as `parks-canada.ts`); validate ER +
   containment + the legality flag at corridor scale.
2. Fill to full-state per segment only where the corridor proves the model.

**Manager-filter (refinement 1) — resolved:** **No manager allowlist in
Phase 1.** The corridor clip already bounds volume; keeping *all* managers
within the buffer (private included) is what makes the negative
"don't-camp-here" signal correct. Defer the allowlist to the national fill —
and when applied, drop the private *long tail* but retain a **dissolved
private/non-public layer** (not individual parcels) so a point on private land
resolves to `likely_restricted`, never `unknown`.

### Entity model — split, search-excluded for the bulk

`park_boundary` today materializes to a **searchable** `master_place` **and** a
containment parent (geometry promotion + `place_relationships`/`ST_Covers`).
Land status takes only the *containment* half for the bulk:

- **Named units** → searchable, reuse the `park_boundary` path (`public_land`
  category).
- **Generic parcels** → search-excluded `master_place` rows: containment
  parents + land-manager taggers, kept out of `master_place_search_export`.

**Search-exclusion mechanism (refinement 2) — resolved:** use an explicit
`is_searchable` (or `searchable`) **boolean column**, not a category allowlist in
the export view. One column is explicit and future-proof; a category list in the
view rots every time a non-search category is added.

**Table-vs-row (refinement 4) — deferred:** search-excluded `master_place` rows
are correct at corridor scale (zero new containment code). ~450k non-search rows
in `master_place` is real weight nationally — **revisit a separate
`land_status_area` table when the corridor proves out and before the national
fill.** Not now.

### Legality — coarse, derived, caveated

Minimal representation, inherited by contained camp points:

```
dispersed_camping: 'likely_allowed' | 'likely_restricted' | 'unknown'
verify_locally: true            // ALWAYS — never assert legality
mvum_corridor?: boolean         // within buffer of an open MVUM route
```

Derivation (a const map in `matcher.ts`, like `AMENITY_TYPES`):

| Condition | Source field | → |
|---|---|---|
| BLM, non-Wilderness, `Pub_Access`=OA | PAD-US `Mang_Name`+`Des_Tp`+`Pub_Access` | likely_allowed |
| USFS, non-Wilderness | PAD-US; reinforced by USFS `markertype="Dispersed Camping"` | likely_allowed |
| Open motorized route nearby | USFS MVUM lines | `mvum_corridor=true` (reinforces) |
| NPS / FWS / State Park / Wilderness / `Pub_Access`=XA | PAD-US | likely_restricted |
| else | — | unknown |

**Caveat visibility (refinement 5) — resolved:** when the flag surfaces in the
UI, `verify_locally` must be an **unmissable visible caveat, not fine print.**
The failure mode — "the app said I could camp here" landing someone on private
land or a closure — is the one consequence with real stakes. Surface as
`overlander_tags` (`['blm_land','dispersed_likely']`) plus the structured field.

### Taxonomy (parks-canada.ts pattern + `--only-categories` flow)

| source_id | quality | endpoints | `inferred_category` | external_id | first `--only-categories` |
|---|---|---|---|---|---|
| `padus` (PAD-US+SMA) | 0.80 | USGS/EDW PAD-US REST; BLM SMA REST | `public_land` (searchable) · `land_status` (search-excluded) | see Next | `public_land` first |
| `usfs` | 0.90 | EDW RecOpportunities / RecSites (pts); MVUM (lines) | `campground` · `dispersed_camping` · `trailhead` · `visitor_center` · `picnic_area` | `usfs:recopp:<OBJECTID>` (OBJECTID-instability caveat) | `campground,dispersed_camping,trailhead,visitor_center,picnic_area`; MVUM → `mvum_corridor` only, not places |
| `osm` (existing) | existing | Overpass | `campground` · `dispersed_camping` · `caravan_site` | `osm:node:<id>` | extend geography; reuse amenity-rollup |
| `bc_rec_sites` (new, ≠ `bc_parks`) | 0.88 | BCGW WFS (pts + polys) | `campground` · `recreation_site` · `trailhead` | `bc_rec_sites:<FOREST_FILE_ID>` | `campground,recreation_site` |
| (`land_status` lane, BC/YT) | 0.80 | Tantalis WFS / GeoYukon REST | `land_status` (search-excluded) | jurisdiction-specific | — |

Per-source module shape mirrors `parks-canada.ts`: one default `ingest`;
per-endpoint zod `…PropsSchema` with `.passthrough()`; pure `infer<X>Category()`
mappers; `normalize<X>()` writing `normalized_payload` (incl. `geometry_polygon`,
`land_manager`, `designation`, `dispersed_camping`, `verify_locally`);
`upsertSourceRecord` keyed on `(source_id, external_id)`; required `--bbox`;
`dryRun`; rate-limiter entry; `_internals` test seam. Each source ships clean
categories first via `--only-categories`, deferring problem categories.

## Consequences

- **New `is_searchable` column** on `master_place` (or equivalent), and
  `master_place_search_export` filters on it. Small migration; confirm the view
  shape first.
- **ESRI client extraction now justified.** PAD-US + SMA + USFS are the 3rd–5th
  ArcGIS-REST sources — extract the shared `data/ingestion/lib/esri.ts` the
  README already flagged. BC's WFS is a *different* access method → a separate
  `fetchWfsFeatures` helper, not forced into the ESRI abstraction.
- **`field_precedence`** gains geometry/canonical_name rows for the new sources;
  the disjoint-jurisdiction 4a tie-breaker applies (USFS co-equal with NPS for
  its own units).
- **`fed_exact` generalization** becomes relevant: USFS is federal and its
  reservable sites route through Recreation.gov (RIDB), so `usfs↔ridb` is a
  candidate `fed_exact` pair. `findFederalAnchor` is hardcoded to `nps`/`ridb`
  (tracked item) → generalize to a `Map<source_id, partner>` when USFS lands.
- **Volume is gated twice:** corridor clip (staging) + search-excluded land
  status (entity model) both cap the master_place/index blowup independently.

### Next (Phase 1 first blocker)

**Nail the PAD-US `external_id` key before any ingest (refinement 3).** PAD-US
has no perfectly stable natural key, and hashing geometry is fragile — a refresh
that nudges a polygon yields a new hash → phantom duplicate (the
OBJECTID-instability problem, worse). **Prefer hashing stable *attributes*
(e.g. `Mang_Name` + `Unit_Nm` + designation) where unique enough, falling back
to a geometry hash only where attributes don't disambiguate.** Resolve this key
strategy first; it is the cleanest dependency for the corridor-scoped
land-status ingest.

## Implementation notes — Phase 1 test validation (2026-06-02)

**Apply-path lesson (recompute_master_place is the sole writer of master_place — must not be lost):**

- Apply migrations via `npm run -w data db:push-verify`, NOT raw `supabase db push`. Raw push can report success while silently skipping the body (2026-05-30-class bug); the verifier checks the INSERT rows landed. Phase 1 used raw push and lost time to it.
- **PostgREST pool staleness.** `getDb` is supabase-js → PostgREST, which holds a long-lived server-side Postgres connection pool. After `CREATE OR REPLACE FUNCTION`, those pooled backends can keep executing the OLD compiled plpgsql plan. A materialize run immediately after the migration ran the old `recompute` → `is_searchable` stayed default-true and `geometry_polygon` didn't promote for every record in that run. A "fresh materialize process" does NOT fix this — it reuses the same PostgREST pool; recycling the pool does.

**Prod runbook (this recompute migration):**
1. Apply via `db:push-verify` (verified).
2. **Recycle PostgREST** — `NOTIFY pgrst, 'reload schema'` (or restart) so pooled backends pick up the new function.
3. Run materialize.
4. **Verify a sample row's `is_searchable` + `geometry_polygon` before declaring done.**
