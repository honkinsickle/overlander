/**
 * Canada loader-runner — routes `esri` vs `wfs` sources from the Canada
 * source registry into the shared corridor-clip + source_record write path.
 *
 * Discovered interfaces (Step 0) this runner builds on:
 *   - ESRI fetch/count: `fetchEsriFeatures` / `fetchEsriCount` (lib/esri.ts).
 *     Both take an `EsriSpatialFilter` (the corridor BUFFER POLYGON) and return
 *     `GeoJsonFeature[]` / a number. They do NOT write — the source modules
 *     normalize features into source_record rows themselves.
 *   - WFS fetch: `wfsFeatures(config, corridorGeoJSON)` async-generator
 *     (lib/wfs-adapter.js), yielding rows `{ source, source_id, lon, lat,
 *     geom_ewkt, is_overlay?, ...fieldMap }`.
 *   - Corridor source: the `active_corridor_buffer_cw_geojson` RPC — the EXACT
 *     source `lib/corridor.ts#getActiveCorridorPolygon` feeds the ESRI clip.
 *     We read its GeoJSON once and derive both the ESRI polygon filter
 *     (`esriPolygonFromGeoJson`) and the WFS corridor geometry.
 *   - Write path: established pattern in padus.ts / usfs.ts —
 *     `batchUpsert({ table: "source_record", rows, onConflict:
 *     "source_id,external_id", chunkSize: 500 })`. Row contract (from
 *     padus.ts#buildRow): { source_id, external_id, name, inferred_category,
 *     geometry (EWKT), raw_payload, normalized_payload, source_quality_score,
 *     fetch_timestamp }.
 *
 * WFS → source_record row BRIDGE (reconciliation):
 *   wfs row field        →  source_record column
 *   ─────────────────────────────────────────────
 *   source               →  source_id
 *   source_id (OBJECTID) →  external_id  (String())
 *   name (fieldMap.name) →  name
 *   <config.category>    →  inferred_category
 *   geom_ewkt            →  geometry      (adapter already emits EWKT:
 *                                          POINT for POIs, polygon for overlays)
 *   {...fieldMap attrs}  →  normalized_payload  (+ raw_payload wrapper)
 *   <config.reliability> →  source_quality_score  (A=0.9, B=0.7, else 0.5)
 *   (now)                →  fetch_timestamp
 *   NOTE: wfs-adapter only carries fieldMap-mapped properties, so raw_payload
 *   holds the mapped attrs, not the full upstream feature (adapter limitation;
 *   not modified here per task guard).
 *
 * Routing:
 *   - adapter === 'wfs' ? wfsFeatures(src, corridor) : fetchEsriFeatures(...)
 *   - sources with `role` (e.g. bc_crown_tenures legality_overlay) are routed
 *     to the OVERLAY target, NOT the POI table. No overlay table exists in the
 *     schema yet, so the overlay WRITE path is guarded/deferred (throws until
 *     provisioned); the dry-run COUNT path is unaffected.
 *
 * --dry-run (default; pass --write to actually write): counts features in the
 * corridor per source — numberMatched for WFS, returnCountOnly for ESRI — and
 * performs ZERO DB writes.
 *
 * Run:  npx tsx --env-file=.env ingestion/run-canada.ts --dry-run
 */

import { readFileSync } from "node:fs";

import { CANADA_SOURCES } from "./lib/canada-sources.config.js";
import { wfsFeatures, geojsonToWkt } from "./lib/wfs-adapter.js";
import {
  fetchEsriFeatures,
  fetchEsriCount,
  esriPolygonFromGeoJson,
  type EsriSpatialFilter,
} from "./lib/esri.ts";
import { getDb, batchUpsert } from "./lib/db.ts";
import { getActiveCorridorBbox } from "./lib/corridor.ts";
import { logger } from "./lib/logger.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 overlander-loader/1.0";
const SLEEP_MS = 1000;
const POI_TABLE = "source_record";
const OVERLAY_TABLE = "legality_overlay"; // written via upsert_legality_overlay RPC (apply migration first).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Src = Record<string, any>;

function reliabilityToScore(r?: string): number {
  if (r === "A") return 0.9;
  if (r === "B") return 0.7;
  return 0.5;
}

// ── CONFIRM detection ───────────────────────────────────────────────────
// The `// CONFIRM` markers are source comments stripped at import time, so we
// can't read them off the imported objects — we scan the config FILE text and
// map each entry id → whether its object literal still carries a CONFIRM.
function buildConfirmMap(): Map<string, boolean> {
  const text = readFileSync(new URL("./lib/canada-sources.config.js", import.meta.url), "utf8");
  const map = new Map<string, boolean>();
  const ids = CANADA_SOURCES.map((s: Src) => s.id as string);
  const idx = ids.map((id) => text.indexOf(`id: '${id}'`));
  for (let i = 0; i < ids.length; i++) {
    const start = idx[i];
    const end = i + 1 < ids.length && idx[i + 1] > -1 ? idx[i + 1] : text.length;
    const block = start > -1 ? text.slice(start, end) : "";
    map.set(ids[i], /CONFIRM/.test(block));
  }
  return map;
}

/** ESRI base must point at a concrete layer ("…/MapServer/0"), not a service
 *  root ("…/MapServer") — fetchEsriFeatures/Count query `{base}/query`, which
 *  is invalid on a root. A root base means the layer id is still unresolved. */
function esriBaseHasLayerId(base: string): boolean {
  return /\/(?:Map|Feature)Server\/\d+\/?$/.test(base);
}

// ── Skip policy ─────────────────────────────────────────────────────────
function skipReason(src: Src, hasConfirm: boolean): string | null {
  if (src.enabled === false) return "enabled:false";
  if (src.optional === true && hasConfirm) return "optional + unresolved layer id (CONFIRM)";
  if (hasConfirm) return "unresolved // CONFIRM marker";
  // Guard beyond the 3 documented rules: an ESRI service-root base (no
  // /<layerId>) cannot be queried — treat as an unresolved layer id.
  if (src.adapter === "esri" && !esriBaseHasLayerId(src.base))
    return "esri base is a service root (no /<layerId>)";
  return null;
}

// ── Dry-run counts ──────────────────────────────────────────────────────
async function wfsCount(src: Src, corridorGeom: any): Promise<number> {
  const geomField = src.geomField ?? "SHAPE";
  const wkt = geojsonToWkt(corridorGeom.geometry || corridorGeom);
  const conds = [`INTERSECTS(${geomField}, SRID=4326;${wkt})`];
  if (src.filter) conds.push(`(${src.filter})`);
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName: src.typeName,
    typeNames: src.typeName,
    outputFormat: "json",
    srsName: "EPSG:4326",
    count: "1", // cheapest page; numberMatched reports the full corridor total
    CQL_FILTER: conds.join(" AND "),
  });
  // The corridor WKT is large → POST KVP (form-urlencoded) to dodge 414, mirroring
  // how the ESRI path POSTs its polygon filter. GeoServer accepts KVP-over-POST.
  const res = await fetch(`${src.base}`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`WFS ${res.status}: ${body.slice(0, 200)}`);
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    throw new Error(`WFS non-JSON (likely ServiceException): ${body.slice(0, 200)}`);
  }
  if (j.exceptions) throw new Error(`WFS exception: ${JSON.stringify(j.exceptions).slice(0, 200)}`);
  const nm = j.numberMatched;
  const n = typeof nm === "string" ? Number(nm) : nm;
  if (!Number.isFinite(n)) throw new Error(`WFS numberMatched not numeric: ${JSON.stringify(nm)}`);
  return n;
}

async function esriCount(src: Src, filter: EsriSpatialFilter): Promise<number> {
  return fetchEsriCount(src.base, filter, {
    where: src.filter ?? "1=1",
    label: src.id,
    userAgent: USER_AGENT,
  });
}

// ── Write path (NOT executed under --dry-run) ───────────────────────────
// ── category resolution + campground rollup (config-driven, generic) ──────
//
// Rolled-up group category precedence: a campground that contains ANY
// frontcountry site is a campground; one that is purely backcountry is
// dispersed_camping; one that is only cabins/huts is camping_cabin.
const CATEGORY_PRECEDENCE = ["campground", "dispersed_camping", "camping_cabin"];

/** Resolve a feature's category from its subtype via `typeCategoryMap`
 *  (keyed on the value of the fieldMap.subtype source field), falling back
 *  to `src.category`. A subtype that maps to `null` means EXCLUDE. */
function resolveCategory(src: Src, subtype: unknown): { category: string | null; exclude: boolean } {
  const map = src.typeCategoryMap as Record<string, string | null> | undefined;
  if (map && subtype != null && Object.prototype.hasOwnProperty.call(map, String(subtype))) {
    const v = map[String(subtype)];
    return v === null ? { category: null, exclude: true } : { category: v, exclude: false };
  }
  return { category: (src.category as string) ?? null, exclude: false };
}

/** Pick the dominant camping token for a rolled-up group by precedence. */
function rollupCategory(cats: (string | null)[]): string | null {
  for (const t of CATEGORY_PRECEDENCE) if (cats.includes(t)) return t;
  return cats.find((c) => c != null) ?? null;
}

/** Set a dotted path (e.g. "capacity.site_count") into a nested object. */
function setPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

interface EmitItem {
  externalId: string;
  name: string;
  subtype: string | null;
  category: string | null; // resolved per-feature (filled by assembleRows)
  lon: number | null;
  lat: number | null;
  attrs: Record<string, unknown>;
  rollupKey: string | null;
  geomEwkt?: string | null; // polygon EWKT, carried for overlay (role) sources
}

function emitRow(
  src: Src,
  externalId: string,
  name: string,
  category: string | null,
  lon: number | null,
  lat: number | null,
  normalized: Record<string, unknown>,
): Record<string, unknown> {
  return {
    source_id: src.id,
    external_id: String(externalId),
    name: name || `${src.id} ${externalId}`,
    inferred_category: category,
    geometry: lon != null ? `SRID=4326;POINT(${lon} ${lat})` : null,
    raw_payload: { fetched_at: new Date().toISOString() },
    normalized_payload: normalized,
    source_quality_score: reliabilityToScore(src.reliability),
    fetch_timestamp: new Date().toISOString(),
  };
}

/** Turn per-feature EmitItems into final source_record rows: apply
 *  typeCategoryMap (excluding null-mapped types) and, if `src.rollup` is
 *  set, collapse to one row per group key (centroid, site_count, subtype
 *  set, precedence category). Null/missing rollup keys emit individually,
 *  flagged `rollup_orphan: true`. */
function assembleRows(items: EmitItem[], src: Src): Record<string, unknown>[] {
  // Overlay (role) sources → legality_overlay row shape: preserve the polygon
  // geom_ewkt (NOT a lon/lat point); no typeCategoryMap/rollup.
  if (src.role) return assembleOverlayRows(items, src);

  const kept = items.filter((it) => {
    const r = resolveCategory(src, it.subtype);
    it.category = r.category;
    return !r.exclude;
  });

  const rollup = src.rollup as
    | { key: string; emitGrain?: string; siteCountInto?: string; dropNullKey?: boolean }
    | undefined;

  if (!rollup) {
    return kept.map((it) => emitRow(src, it.externalId, it.name, it.category, it.lon, it.lat, it.attrs));
  }

  const groups = new Map<string, EmitItem[]>();
  const orphans: EmitItem[] = [];
  for (const it of kept) {
    if (it.rollupKey == null || it.rollupKey === "") {
      if (!rollup.dropNullKey) orphans.push(it); // dropNullKey: drop nameless orphans instead of emitting
    } else (groups.get(it.rollupKey) ?? groups.set(it.rollupKey, []).get(it.rollupKey)!).push(it);
  }

  const rows: Record<string, unknown>[] = [];
  for (const [key, members] of groups) {
    const lons = members.map((m) => m.lon).filter((v): v is number => v != null);
    const lats = members.map((m) => m.lat).filter((v): v is number => v != null);
    const clon = lons.length ? lons.reduce((a, b) => a + b, 0) / lons.length : null;
    const clat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
    const subtypes = [...new Set(members.map((m) => m.subtype).filter((s): s is string => !!s))];
    const np: Record<string, any> = {
      rollup_key: key,
      subtypes,
      member_external_ids: members.map((m) => m.externalId),
    };
    if (rollup.siteCountInto) setPath(np, rollup.siteCountInto, members.length);
    rows.push({
      source_id: src.id,
      external_id: `${rollup.emitGrain ?? "group"}:${key}`,
      name: members.find((m) => m.name)?.name || key,
      inferred_category: rollupCategory(members.map((m) => m.category)),
      geometry: clon != null ? `SRID=4326;POINT(${clon} ${clat})` : null,
      raw_payload: { rolled_up_from: members.length, key, fetched_at: new Date().toISOString() },
      normalized_payload: np,
      source_quality_score: reliabilityToScore(src.reliability),
      fetch_timestamp: new Date().toISOString(),
    });
  }
  for (const it of orphans) {
    const row = emitRow(src, it.externalId, it.name, it.category, it.lon, it.lat, {
      ...it.attrs,
      rollup_orphan: true,
    });
    rows.push(row);
  }
  return rows;
}

/** Build legality_overlay rows from overlay (role) EmitItems. Preserves the
 *  polygon `geomEwkt` (mapped to `geom_ewkt` → the table's `geom`) rather than
 *  rebuilding a point from null lon/lat. `legalityStatus` defaults to
 *  'restricted' (tenures/exclusions). Rows with no polygon are dropped. */
function assembleOverlayRows(items: EmitItem[], src: Src): Record<string, unknown>[] {
  return items
    .filter((it) => it.geomEwkt)
    .map((it) => ({
      source: src.id,
      source_id: it.externalId,
      geom_ewkt: it.geomEwkt, // polygon EWKT (SRID=4326;…) — NOT a lon/lat point
      legality_status: (src.legalityStatus as string) ?? "restricted",
      designation: (src.designation as string) ?? null,
      tenure_type: (it.attrs.tenureType ?? it.attrs.tenure_type ?? null) as unknown,
      status: (it.attrs.status ?? it.attrs.tenureStatus ?? null) as unknown,
      attrs: it.attrs,
    }));
}

/** Bounded overlay sample (first `n` features) for --emit-report geom-preservation
 *  validation — avoids fetching the full ~23k tenure set. */
async function overlaySample(src: Src, corridorGeom: any, n: number): Promise<Record<string, unknown>[]> {
  const items: EmitItem[] = [];
  for await (const row of wfsFeatures(src, corridorGeom, { pageSize: n })) {
    const { source, source_id, lon, lat, geom_ewkt, is_overlay, ...attrs } = row as Src;
    items.push({ externalId: String(source_id), name: "", subtype: null, category: null, lon: null, lat: null, attrs, rollupKey: null, geomEwkt: (geom_ewkt as string) ?? null });
    if (items.length >= n) break;
  }
  return assembleOverlayRows(items, src);
}

/** Build EmitItems from an ESRI source (raw GeoJSON features). */
async function esriItems(src: Src, filter: EsriSpatialFilter): Promise<EmitItem[]> {
  const feats = await fetchEsriFeatures(src.base, filter, {
    where: src.filter ?? "1=1",
    pageSize: src.pageMax ?? 1000,
    label: src.id,
    userAgent: USER_AGENT,
  });
  const fm = (src.fieldMap ?? {}) as Record<string, string>;
  const subtypeField = fm.subtype;
  const rollupField = (src.rollup as { key?: string } | undefined)?.key;
  return feats.map((f: any) => {
    const p = f.properties ?? {};
    const oid = p.OBJECTID ?? p.objectid ?? f.id;
    const attrs: Record<string, unknown> = {};
    for (const [canon, remote] of Object.entries(fm)) attrs[canon] = p[remote] ?? null;
    const [lon, lat] = f.geometry?.type === "Point" ? f.geometry.coordinates : [null, null];
    const sub = subtypeField ? p[subtypeField] : null;
    const rk = rollupField ? p[rollupField] : null;
    return {
      externalId: String(oid),
      name: (attrs.name as string) ?? "",
      subtype: sub == null ? null : String(sub),
      category: null,
      lon,
      lat,
      attrs,
      rollupKey: rk == null ? null : String(rk),
    };
  });
}

/** Build EmitItems from a WFS source (adapter rows). */
async function wfsItems(src: Src, corridorGeom: any): Promise<EmitItem[]> {
  const rollupField = (src.rollup as { key?: string } | undefined)?.key;
  const items: EmitItem[] = [];
  for await (const row of wfsFeatures(src, corridorGeom)) {
    const { source, source_id, lon, lat, geom_ewkt, is_overlay, ...attrs } = row as Src;
    const rk = rollupField ? (row[rollupField] ?? (attrs as any)[rollupField]) : null;
    items.push({
      externalId: String(source_id),
      name: (attrs.name as string) ?? "",
      subtype: (attrs.subtype as string) ?? null,
      category: null,
      lon: lon ?? null,
      lat: lat ?? null,
      attrs,
      rollupKey: rk == null ? null : String(rk),
      geomEwkt: (geom_ewkt as string) ?? null, // preserve polygon for overlay sources
    });
  }
  return items;
}

async function flushBatch(table: string, rows: Record<string, unknown>[], label: string) {
  if (rows.length === 0) return;
  if (table === OVERLAY_TABLE) {
    // Overlay rows go through the upsert_legality_overlay RPC (coerces
    // Polygon→MultiPolygon, stamps 4326, idempotent on (source, source_id)) —
    // the reference-table pattern, mirroring upsert_mvum_road. Requires the
    // legality_overlay migration to be applied first (see migration file).
    const db = getDb();
    for (const r of rows) {
      const { error } = await db.rpc("upsert_legality_overlay", {
        p_source: r.source,
        p_source_id: r.source_id,
        p_geom_ewkt: r.geom_ewkt,
        p_legality_status: r.legality_status,
        p_designation: r.designation ?? null,
        p_tenure_type: r.tenure_type ?? null,
        p_status: r.status ?? null,
        p_attrs: r.attrs ?? {},
      });
      if (error) throw new Error(`${label}: upsert_legality_overlay failed: ${error.message}`);
    }
    return;
  }
  await batchUpsert({ table, rows, onConflict: "source_id,external_id", chunkSize: 500, label });
}

// ── Point-in-polygon (ray casting) for local corridor clipping ────────────
function pointInRing(pt: number[], ring: number[][]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt: number[], geom: any): boolean {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  for (const rings of polys) {
    if (!pointInRing(pt, rings[0])) continue;
    let inHole = false;
    for (let k = 1; k < rings.length; k++) if (pointInRing(pt, rings[k])) inHole = true;
    if (!inHole) return true;
  }
  return false;
}

/** Generic 'curated' adapter: reads NDJSON rows from a local file (path in
 *  config, relative to this module), builds point geom from lat/lng, clips
 *  to the active corridor polygon LOCALLY (point-in-polygon), and yields
 *  EmitItems so curated sources flow through the SAME resolveCategory /
 *  assembleRows pipeline as esri/wfs. */
async function curatedItems(src: Src, corridorGeom: any): Promise<EmitItem[]> {
  const geom = corridorGeom.geometry || corridorGeom;
  const text = readFileSync(new URL(src.file as string, import.meta.url), "utf8");
  const fm = (src.fieldMap ?? {}) as Record<string, string>;
  const subtypeField = fm.subtype;
  const idField = (src.sourceIdField as string) ?? "source_id";
  const items: EmitItem[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const lon = row.lng ?? row.lon;
    const lat = row.lat;
    if (lon == null || lat == null) continue;
    if (!pointInPolygon([lon, lat], geom)) continue; // local corridor clip
    const attrs: Record<string, unknown> = {};
    for (const [canon, remote] of Object.entries(fm)) attrs[canon] = row[remote] ?? null;
    const sub = subtypeField ? row[subtypeField] : null;
    items.push({
      externalId: String(row[idField] ?? row.name),
      name: (row.name as string) ?? (attrs.name as string) ?? "",
      subtype: sub == null ? null : String(sub),
      category: null,
      lon,
      lat,
      attrs,
      rollupKey: null,
    });
  }
  return items;
}

/** Build EmitItems for any adapter (shared by count/emit/write paths). */
async function itemsFor(src: Src, corridorGeom: any, filter: EsriSpatialFilter): Promise<EmitItem[]> {
  if (src.adapter === "wfs") return wfsItems(src, corridorGeom);
  if (src.adapter === "curated") return curatedItems(src, corridorGeom);
  return esriItems(src, filter);
}

async function writeWfs(src: Src, corridorGeom: any, table: string): Promise<number> {
  const rows = assembleRows(await wfsItems(src, corridorGeom), src);
  await flushBatch(table, rows, src.id); // batchUpsert chunks at 500
  return rows.length;
}

async function writeEsri(src: Src, filter: EsriSpatialFilter, table: string): Promise<number> {
  const rows = assembleRows(await esriItems(src, filter), src);
  await flushBatch(table, rows, src.id);
  return rows.length;
}

/** No-write emit pass: build the rows a real run WOULD upsert, without
 *  writing. Returns input-feature count, emitted row count (post-rollup),
 *  and the category distribution. Used by --emit-report (STEP 3 validate). */
async function emitPreview(
  src: Src,
  corridorGeom: any,
  filter: EsriSpatialFilter,
): Promise<{ inputs: number; emitted: number; categories: Record<string, number> }> {
  const items = await itemsFor(src, corridorGeom, filter);
  const rows = assembleRows(items, src);
  const categories: Record<string, number> = {};
  for (const r of rows) {
    const c = (r.inferred_category as string) ?? "(null)";
    categories[c] = (categories[c] ?? 0) + 1;
  }
  return { inputs: items.length, emitted: rows.length, categories };
}

// ── Main ────────────────────────────────────────────────────────────────
interface Report {
  source: string;
  adapter: string;
  enabled: boolean;
  rows: number | string;
  table: string;
  skipped: string;
}

async function main() {
  const argv = process.argv.slice(2);
  // --emit-report: no-write validation pass (STEP 3) — builds the rows a real
  // run would upsert (typeCategoryMap + rollup applied) and reports emitted
  // grain + category distribution. Never writes.
  const emitReport = argv.includes("--emit-report");
  // Default to dry-run for safety; require an explicit --write to mutate the DB.
  const dryRun = !argv.includes("--write");

  const confirmMap = buildConfirmMap();

  // Resolve the corridor ONCE from the same RPC the ESRI clip uses.
  const db = getDb();
  const corridorMeta = await getActiveCorridorBbox();
  const { data: rpcData, error } = await db.rpc("active_corridor_buffer_cw_geojson");
  if (error) throw error;
  if (rpcData == null) {
    console.error(
      "No active corridor buffer in the connected DB. Deploy one (deploy-corridor) first.",
    );
    process.exit(2);
  }
  const corridorGeom = typeof rpcData === "string" ? JSON.parse(rpcData) : rpcData;
  const esriFilter: EsriSpatialFilter = {
    kind: "polygon",
    polygon: esriPolygonFromGeoJson(corridorGeom),
  };
  logger.info(
    { corridor: corridorMeta?.name ?? "(unnamed)", dryRun, sources: CANADA_SOURCES.length },
    "run-canada: start",
  );

  const report: Report[] = [];
  const emitRows: Array<{ source: string; adapter: string; inputs: number | string; emitted: number | string; categories: string; skipped: string }> = [];

  for (const src of CANADA_SOURCES as Src[]) {
    const hasConfirm = confirmMap.get(src.id) ?? false;
    const enabled = src.enabled !== false;
    const table = src.role ? OVERLAY_TABLE : POI_TABLE;
    const reason = skipReason(src, hasConfirm);

    if (reason) {
      report.push({ source: src.id, adapter: src.adapter, enabled, rows: "—", table, skipped: reason });
      if (emitReport) emitRows.push({ source: src.id, adapter: src.adapter, inputs: "—", emitted: "—", categories: "—", skipped: reason });
      continue;
    }

    // ── EMIT-REPORT branch (no writes) ──
    if (emitReport) {
      try {
        if (src.role) {
          // Overlay → legality_overlay. Count via wfsCount (avoids fetching 23k
          // tenures); validate geom preservation + row shape on a 3-row sample.
          const c = src.adapter === "wfs" ? await wfsCount(src, corridorGeom) : await esriCount(src, esriFilter);
          let geomOk = "?";
          try {
            const s = src.adapter === "wfs" ? await overlaySample(src, corridorGeom, 3) : [];
            geomOk = s.length > 0 && s.every((r) => r.geom_ewkt) ? `geom preserved ${s.length}/${s.length}` : "GEOM MISSING";
          } catch (e) {
            geomOk = "sample-err: " + (e instanceof Error ? e.message : String(e)).slice(0, 40);
          }
          emitRows.push({ source: src.id, adapter: src.adapter, inputs: c, emitted: c, categories: `→ ${OVERLAY_TABLE} (${geomOk}, legality_status=${(src.legalityStatus as string) ?? "restricted"})`, skipped: "" });
        } else {
          const r = await emitPreview(src, corridorGeom, esriFilter);
          const dist = Object.entries(r.categories).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
          emitRows.push({ source: src.id, adapter: src.adapter, inputs: r.inputs, emitted: r.emitted, categories: dist, skipped: "" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emitRows.push({ source: src.id, adapter: src.adapter, inputs: "ERR", emitted: "ERR", categories: `error: ${msg}`, skipped: "" });
      }
      await sleep(SLEEP_MS);
      continue;
    }

    try {
      let count: number;
      if (dryRun) {
        count =
          src.adapter === "wfs"
            ? await wfsCount(src, corridorGeom)
            : src.adapter === "curated"
              ? (await curatedItems(src, corridorGeom)).length // local clip count
              : await esriCount(src, esriFilter);
      } else {
        const rows = assembleRows(await itemsFor(src, corridorGeom, esriFilter), src);
        await flushBatch(table, rows, src.id);
        count = rows.length;
      }
      report.push({ source: src.id, adapter: src.adapter, enabled, rows: count, table, skipped: "" });
      logger.info({ source: src.id, adapter: src.adapter, rows: count, dryRun }, "run-canada: counted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.push({ source: src.id, adapter: src.adapter, enabled, rows: "ERR", table, skipped: `error: ${msg}` });
      logger.warn({ source: src.id, err: msg }, "run-canada: source failed");
    }
    await sleep(SLEEP_MS);
  }

  // ── Print report table ──
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

  if (emitReport) {
    console.log(`\nEMIT-REPORT (no writes) — Canada loader (corridor: ${corridorMeta?.name ?? "?"})`);
    const eh = [pad("source", 32), pad("adapter", 6), pad("input feats", 12), pad("emitted rows", 13), "category distribution"].join(" | ");
    console.log(eh);
    console.log("-".repeat(eh.length + 30));
    const allCats = new Set<string>();
    for (const r of emitRows) {
      console.log([pad(r.source, 32), pad(r.adapter, 6), pad(String(r.inputs), 12), pad(String(r.emitted), 13), r.categories].join(" | "));
      r.categories.split(" ").forEach((tok) => { const c = tok.split(":")[0]; if (c && !/overlay|error|—|null/.test(c)) allCats.add(c); });
    }
    // Assertions: no invalid 'dispersed_camp', and report the category set.
    const bad = [...allCats].filter((c) => c === "dispersed_camp");
    console.log(`\nemitted category tokens: ${[...allCats].sort().join(", ")}`);
    console.log(`ASSERT no 'dispersed_camp': ${bad.length === 0 ? "PASS" : "FAIL (" + bad.join(",") + ")"}`);
    return;
  }

  const header = [
    pad("source", 32),
    pad("adapter", 8),
    pad("enabled", 8),
    pad("rows-in-corridor", 17),
    pad("target table", 18),
    "skipped (why)",
  ].join(" | ");
  console.log("\n" + (dryRun ? "DRY-RUN" : "WRITE") + " — Canada loader (corridor: " + (corridorMeta?.name ?? "?") + ")");
  console.log(header);
  console.log("-".repeat(header.length + 20));
  for (const r of report) {
    console.log(
      [
        pad(r.source, 32),
        pad(r.adapter, 8),
        pad(String(r.enabled), 8),
        pad(String(r.rows), 17),
        pad(r.skipped ? "—" : r.table, 18),
        r.skipped || "(ran)",
      ].join(" | "),
    );
  }
  const ran = report.filter((r) => !r.skipped).length;
  console.log(`\n${ran} ran, ${report.length - ran} skipped.  Writes performed: ${dryRun ? "NONE (dry-run)" : "yes"}.`);
}

main().catch((e) => {
  const detail = e instanceof Error ? e.stack : JSON.stringify(e, Object.getOwnPropertyNames(e ?? {}));
  console.error("run-canada FATAL:", detail);
  logger.error({ err: detail }, "run-canada: fatal");
  process.exit(1);
});
