# PROPOSAL — `legality_overlay` table + recompute integration

**Status: PROPOSAL ONLY — not applied.** No DDL has been run, no table created,
no migration placed in `supabase/migrations/`. This is a review artifact. The
SQL below is illustrative and must go through `db:push-verify` (with the
PostgREST pool-recycle runbook) once approved — it touches
`recompute_master_place`, the sole writer of `master_place`.

Inventory read-only against repo + LIVE `nqzeywzcowujzyegxbsr` (discriminator
passed: `master_place` = 12,242).

---

## Part 1 — Current legality-model inventory

### 1.1 `master_place` legality state (types + how set)
From `20260527120100_phase1_master_place.sql` + the recompute migrations:

| column | type | how set |
|---|---|---|
| `geometry` | `geometry(Point,4326)` | recompute Step 4 (field_precedence on `geometry`) |
| `geometry_polygon` | `geometry(Polygon,4326)` | recompute Step 5 (park boundaries) |
| `is_searchable` | `boolean not null default true` | recompute Step 6: `(primary_category is distinct from 'land_status')` |
| `mvum_corridor` | `boolean` (nullable) | recompute Step 6.5: dispersed point within **30 m (geography)** of an open MVUM route |
| `overlander_tags` | `text[]` (GIN) | carries the legality **tags**: `dispersed_camping_likely` / `no_dispersed_camping` / `dispersed_camping_unknown` |

There is **no dedicated `legality_status` column on `master_place`** today. A
point's legality is expressed as `overlander_tags` + `mvum_corridor` + the
always-on `verify_locally` caveat. All geometry is **SRID 4326**.

### 1.2 `recompute_master_place` (the sole writer)
The spatial-join pattern the design must fit (from
`20260603010000_phase2_mvum_corridor.sql`):

- **Step 6** — `is_searchable = (primary_category is distinct from 'land_status')`.
- **Step 6.5** — `mvum_corridor`:
  ```sql
  set mvum_corridor = case
    when mp.primary_category = 'dispersed_camping' then exists (
      select 1 from public.mvum_roads r
       where st_dwithin(mp.geometry::geography, r.geom::geography, 30))  -- METERS via ::geography
    else null end
  ```
- **Step 7** — containment: `place_relationships (contained_in)` via
  `st_covers(p.geometry_polygon, s.geometry)`.

**Pattern:** recompute reads a **search-excluded reference table** by a spatial
predicate to set a per-point flag. `legality_overlay` should mirror this exactly.

### 1.3 Legality vocabulary already in use
From ADR `2026-06-02-land-status-and-dispersed-camping-sources.md` and
`data/ingestion/sources/padus.ts#deriveDispersedCamping`:

- Point flag: `dispersed_camping ∈ {likely_allowed, likely_restricted, unknown}`
  — derived **at ingest, per PAD-US feature**, stored in
  `source_record.normalized_payload`, surfaced as `overlander_tags`.
- `verify_locally: true` — **ALWAYS** (never assert legality).
- `mvum_corridor: boolean` — positive reinforcement only.
- **restricted-beats-allowed** (the live rule in `deriveDispersedCamping`):
  Wilderness (`Des_Tp='WA'`) and closed access (`Pub_Access='XA'`) are checked
  **first** → `likely_restricted`; `BLM`/`USFS` → `likely_allowed`;
  `NPS/FWS/State/Private/Local/NGO/District/Tribal` → `likely_restricted`; else
  `unknown`.

### 1.4 Existing exclusion / reference source tables
- **`mvum_roads`** — `geometry(MultiLineString,4326)`, PK `rte_cn`, `GiST(geom)`,
  search-excluded, loaded via idempotent `upsert_mvum_road(rte_cn, geojson)`
  (coerces LineString→MultiLineString, stamps 4326). **This is the template.**
- **PAD-US** — *not* a separate table: ingests as `master_place`
  (`primary_category='land_status'`, `is_searchable=false`) acting as containment
  parents / land-manager taggers. Its dispersed flag is per-feature at ingest.
- No private-land layer and no positive open-Crown base layer exist yet.

### 1.5 Runner overlay path (current state + the gap)
- `run-canada.ts`: `OVERLAY_TABLE = 'legality_overlay'`; `role` sources route
  there (`const table = src.role ? OVERLAY_TABLE : POI_TABLE`); `flushBatch`
  **throws** for `OVERLAY_TABLE` ("overlay write path deferred — table not in
  schema").
- `wfs-adapter.js` overlay row (when `role` set):
  `{ source, source_id, is_overlay:true, geom_ewkt: toEWKT(feature.geometry) }`
  + any `fieldMap` attrs. **No `lon`/`lat`.**
- `bc_crown_tenures` config: `role:'legality_overlay'`, **no `fieldMap`** → it
  carries no `tenure_type`/`status`.
- **GAP:** the runner's `emitRow` builds `geometry` from `lon/lat`
  (`geometry: lon != null ? 'SRID=4326;POINT(...)' : null`). For overlay rows
  `lon` is null → **the polygon `geom_ewkt` is dropped**. `assembleRows` cannot
  emit overlay polygons today; the role path is count-only in `--emit-report`.

### 1.6 Wilderness override / restricted-beats-allowed (queued work)
`padus.ts` already encodes restricted-beats-allowed per feature
(`if des==='WA' return 'likely_restricted'` first). The multi-parent /
overlapping-polygon resolution is **not yet implemented** — it is exactly what
this overlay table introduces. The Wilderness override slots in as a
`legality_status='restricted'` overlay (or stays a per-feature PAD-US flag); both
resolve correctly under most-restrictive-wins (§2.4).

---

## Part 2 — Design decisions

### 2.1 `legality_overlay` is a REFERENCE table, not a `master_place`
Mirror `mvum_roads`: polygon reference data, search-excluded, never materializes
to `master_place`/Typesense. `recompute_master_place` reads it spatially to set
the contained point's legality. Zero new search-export surface.

### 2.2 BC case — exclusion-only is **not** sufficient (needs a jurisdiction signal)
- TANTALIS Crown tenures = **allocated** Crown land → dispersed camping
  **restricted** there. (`bc_crown_tenures` note: "legal dispersed = open Crown
  minus (tenures, parks, private). BC 14-day rule.")
- BC default: **unallocated** Crown land = camping allowed (14-day rule).
- Pure exclusion-only (tenures alone) **cannot distinguish open Crown (allowed)
  from private (also restricted)** for a point outside all tenures. A
  tenure-free point could be private → it must **not** default to `allowed`.
- **Resolution:** `legality_overlay` carries both polarities via
  `legality_status`:
  - `'restricted'` overlays — Crown tenures, dissolved private land, parks,
    Wilderness.
  - `'allowed'` overlays — optional **positive open-Crown / BLM-OA base** layer.
  - A point's flag = most-restrictive overlay covering it; if only an `allowed`
    base covers (no restriction) → `likely_allowed`; if **nothing** covers →
    `unknown` (never assume allowed).
- **Phase-1 BC corridor:** ingest tenures (`'restricted'`) first. Until the
  dissolved private + open-Crown base lands, a tenure-free BC point resolves to
  **`unknown`** (honest, per ADR "never `unknown`… retain a dissolved
  private/non-public layer" — that layer upgrades `unknown`→`allowed`/`restricted`
  later). Exclusion-only is a correct *first slice*, not the finished model.

### 2.3 Vocabulary alignment
`legality_overlay.legality_status ∈ {restricted, allowed, unknown}` — the
per-polygon **effect**. `recompute` maps the set of overlays covering a point to
the existing point vocabulary `{likely_allowed, likely_restricted, unknown}` +
`overlander_tags`, identical to `padus.dispersedTag`.

### 2.4 Multi-parent resolution — most-restrictive-wins
Precedence (most → least restrictive): **`restricted` > `unknown` > `allowed`**.
A dispersed point covered by N overlapping overlays takes the MIN over this
ordering. The PAD-US Wilderness / closed-access override is just a `restricted`
overlay (or the existing per-feature padus flag) → it wins automatically. This
generalizes `deriveDispersedCamping`'s "check Wilderness first" from
per-feature to per-point-over-many-polygons.

---

## Part 3 — Proposed migration SQL (REVIEW ONLY — do **not** add to `supabase/migrations/`)

```sql
-- PROPOSAL — legality_overlay reference table (search-excluded; never a master_place).
-- Mirrors mvum_roads: polygon reference data read by recompute_master_place.
set search_path = public;

create table if not exists public.legality_overlay (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                       -- e.g. 'bc_crown_tenures'
  source_id       text not null,                       -- stable per-source key (INTRID_SID / OBJECTID)
  geom            geometry(MultiPolygon, 4326) not null,
  legality_status text not null
    check (legality_status in ('restricted','allowed','unknown')),
  designation     text,        -- semantic class: 'crown_tenure' | 'private' | 'wilderness' | 'park' | 'open_crown'
  tenure_type     text,        -- BC TENURE_TYPE / PAD-US Des_Tp / source-native type
  status          text,        -- lifecycle: TENURE_STATUS / 'active' / GAP_Sts
  attrs           jsonb not null default '{}'::jsonb,   -- raw provenance attributes
  loaded_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists legality_overlay_geom_gist
  on public.legality_overlay using gist (geom);
create index if not exists legality_overlay_status_idx
  on public.legality_overlay (legality_status);

alter table public.legality_overlay enable row level security;  -- reference data; service-role write only

comment on table public.legality_overlay is
  'Search-excluded legality reference polygons (Crown tenures, private, parks, Wilderness, optional open-Crown base). Read by recompute_master_place to set a contained dispersed point''s legality. Never a master_place; never in Typesense. Mirrors mvum_roads.';

-- Idempotent loader RPC (mirrors upsert_mvum_road): coerce Polygon→MultiPolygon, stamp 4326.
create or replace function public.upsert_legality_overlay(
  p_source text, p_source_id text, p_geojson jsonb,
  p_legality_status text, p_designation text default null,
  p_tenure_type text default null, p_status text default null,
  p_attrs jsonb default '{}'::jsonb
) returns void
language plpgsql volatile as $$
declare v_geom geometry;
begin
  v_geom := st_setsrid(st_geomfromgeojson(p_geojson::text), 4326);
  if st_geometrytype(v_geom) = 'ST_Polygon' then v_geom := st_multi(v_geom); end if;
  insert into public.legality_overlay
    (source, source_id, geom, legality_status, designation, tenure_type, status, attrs, loaded_at, updated_at)
  values (p_source, p_source_id, v_geom, p_legality_status, p_designation, p_tenure_type, p_status, p_attrs, now(), now())
  on conflict (source, source_id) do update set
    geom = excluded.geom, legality_status = excluded.legality_status,
    designation = excluded.designation, tenure_type = excluded.tenure_type,
    status = excluded.status, attrs = excluded.attrs, updated_at = now();
end; $$;
```

Notes:
- `MultiPolygon(4326)` (not `Polygon`) because tenures are frequently
  multi-part; coerce on insert like `mvum_roads`. BC native SRID is 3005 →
  reproject to 4326 at ingest (as the rest of the pipeline does).
- `unique (source, source_id)` + GiST(geom) exactly as requested.

---

## Part 4 — `recompute_master_place` integration sketch (proposed Step 6.6)

Add **after** Step 6.5 (mvum) — same shape, topological predicate (no geography
needed; `ST_Intersects` is distance-free and uses the GiST index):

```sql
-- Step 6.6 (PROPOSED): legality from overlapping legality_overlay polygons.
-- Applies to dispersed_camping points; most-restrictive overlay wins.
declare v_flag text;
...
if (select primary_category from public.master_place where id = p_master_place_id)
     = 'dispersed_camping' then
  with cover as (
    select lo.legality_status
    from public.legality_overlay lo
    join public.master_place mp on mp.id = p_master_place_id
    where st_intersects(lo.geom, mp.geometry)
  )
  select case
    when exists (select 1 from cover where legality_status = 'restricted') then 'likely_restricted'
    when exists (select 1 from cover where legality_status = 'unknown')    then 'unknown'
    when exists (select 1 from cover where legality_status = 'allowed')    then 'likely_allowed'
    else 'unknown'  -- nothing covers it → unknown, NEVER assume allowed
  end into v_flag;

  -- surface as overlander_tags (mirror padus.dispersedTag), keep verify_locally always.
  update public.master_place mp set overlander_tags =
    (select array_agg(t) from unnest(coalesce(mp.overlander_tags,'{}'))
       t where t not like 'dispersed_camping_%' and t <> 'no_dispersed_camping')
    || array[ case v_flag
        when 'likely_allowed'    then 'dispersed_camping_likely'
        when 'likely_restricted' then 'no_dispersed_camping'
        else 'dispersed_camping_unknown' end,
      'verify_locally' ]
  where mp.id = p_master_place_id;
end if;
```

- Pairs with the existing `mvum_corridor` reinforcement: a point can be
  `dispersed_camping_likely` **and** `mvum_corridor=true`.
- Reconciles with PAD-US: the per-feature padus flag and the overlay flag both
  live in `overlander_tags`; most-restrictive should win across both. (Open
  question §7: pick one writer — recommend recompute Step 6.6 becomes the single
  resolver, with padus contributing `restricted` overlays instead of writing the
  tag directly, so there's one precedence point.)

---

## Part 5 — restricted-beats-allowed resolution rule (explicit)

```
ordering (most → least restrictive):  restricted > unknown > allowed
point flag = MIN over { legality_status of every overlay whose geom ∩ point }
  no overlay covers      → unknown          (never 'allowed' by absence)
  any 'restricted'       → likely_restricted (Wilderness / closed access / tenure / private / park)
  else any 'unknown'     → unknown
  else only 'allowed'    → likely_allowed
verify_locally           → ALWAYS appended, regardless of flag
```
The PAD-US **Wilderness override** is a `legality_status='restricted'` overlay
(designation `'wilderness'`); closed-access (`Pub_Access='XA'`) likewise. Both
win by being `restricted`. This is the per-point generalization of the existing
per-feature `deriveDispersedCamping`.

---

## Part 6 — Runner / adapter changes needed (for overlay rows to land cleanly)

1. **`bc_crown_tenures` config** — add a `fieldMap` so tenure attributes ride
   into the overlay row, and declare the overlay's effect:
   ```js
   role: 'legality_overlay',
   legalityStatus: 'restricted',                 // allocated tenures are exclusions
   designation: 'crown_tenure',
   fieldMap: { tenureType: 'TENURE_TYPE', status: 'TENURE_STATUS', purpose: 'TENURE_PURPOSE' },
   ```
   (Verified `bc_crown_tenures` columns include `TENURE_TYPE`, `TENURE_STATUS`,
   `TENURE_PURPOSE`, `TENURE_STAGE`, `INTRID_SID`.)

2. **`run-canada.ts`** — add an overlay row builder for `role` sources that does
   **not** go through `emitRow` (which assumes a lon/lat point). It must map the
   adapter's `geom_ewkt` (polygon) to the table:
   ```
   { source: src.id, source_id: external_id,
     geom: geom_ewkt,                              // polygon EWKT, NOT lon/lat
     legality_status: src.legalityStatus ?? 'restricted',
     designation: src.designation ?? null,
     tenure_type: attrs.tenureType ?? null,
     status: attrs.status ?? null,
     attrs }
   ```
   Then route the (non-dry) write through `upsert_legality_overlay(...)` per row
   (mirrors `upsert_mvum_road`; reference tables write via RPC), and remove the
   `flushBatch` "deferred" throw for `OVERLAY_TABLE` once the table exists.
   `--emit-report` already counts role sources separately, so the emit summary
   needs no change.

3. **`wfs-adapter.js`** — already emits `geom_ewkt` for `role` via
   `toEWKT(feature.geometry)`; no change required, but note `toEWKT` yields
   `POLYGON` or `MULTIPOLYGON` — the `upsert_legality_overlay` RPC coerces
   `Polygon→MultiPolygon`, so EWKT can be passed as GeoJSON or WKT to the RPC.
   (Cleanest: have the adapter pass GeoJSON geometry to the RPC rather than EWKT
   text.)

These three changes are the minimum for `bc_crown_tenures` overlay rows
(currently 23,465 in-corridor) to populate `legality_overlay`. **None applied in
this proposal.**

---

## Part 7 — Open questions / deferred (for the reviewer)

1. **Single resolver:** should recompute Step 6.6 become the *only* writer of
   the `dispersed_camping_*` tag (padus stops writing it directly, contributing
   `restricted` overlays instead)? Recommended — one precedence point.
2. **Open-Crown / private base:** Phase-1 ships tenures-only (`restricted`),
   so tenure-free BC points are `unknown`. Schedule the dissolved private +
   open-Crown `allowed`/`restricted` base to resolve `unknown`→definitive.
3. **Volume:** `bc_crown_tenures` ≈ 23k polygons in-corridor. GiST(geom) +
   `ST_Intersects` per-point is index-friendly, but confirm recompute timing
   at corridor scale (mirror the mvum "national fill needs a geography GiST"
   note).
4. **`table-vs-row`** parity with the ADR's deferred `land_status_area`
   question: `legality_overlay` is the BC analogue of that separate table —
   worth aligning the two before national fill so they share one
   overlay/containment mechanism.
5. **Performance of the tag-array surgery** in Step 6.6 — validate the
   `array_agg/unnest` rewrite doesn't churn `overlander_tags` ordering in a way
   the search sync notices.
