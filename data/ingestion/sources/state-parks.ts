/**
 * State parks ingester — six-state ArcGIS GIS sources.
 *
 * Source: per-state ArcGIS REST endpoints (CA, AZ, NV, UT, WA, OR). Each
 * state's parks agency publishes its own data independently — no single
 * federal umbrella. All endpoints are public, unauthenticated.
 *
 * Spec: docs/specs/state-parks-source-architecture.md (v4).
 *
 * source_id: "state_parks" (shared across all six states; per-state identity
 * encoded in external_id prefix and normalized_payload.provenance.state).
 *
 * Record types (distinguished by external_id prefix):
 *   state_parks:<ST>:park:<key>        — park-unit boundary (polygon centroid)
 *   state_parks:<ST>:campground:<key>  — campground/camp-area/facility point
 *   state_parks:<ST>:facility:<key>    — non-campground facility (NV only)
 *
 * AZ and WA campsite-level data is AGGREGATED at ingest — one campground-
 * category source_record per park, not one per individual site. Per-site rows
 * would flood corridor-ranking density scoring.
 *
 * Boundary dissolve (CA, UT, OR): multi-polygon parks are dissolved into one
 * record per park unit, following the padus.ts pattern. The dissolved polygon
 * is stored in normalized_payload.geometry_polygon; the centroid goes into
 * source_record.geometry.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source state_parks --state CA
 *   npm run -w data ingest:manual -- --source state_parks --state ALL
 *   npm run -w data ingest:manual -- --source state_parks --state AZ --dry-run
 */

import { z } from "zod";

import { batchUpsert } from "../lib/db.ts";
import { fetchEsriFeatures, envelopeFilter } from "../lib/esri.ts";
import { pointEwkt } from "../lib/ewkt.ts";
import { bboxCentroid, extractPolygon, type GeoJsonFeature } from "../lib/geojson.ts";
import { logger } from "../lib/logger.ts";
import { limits } from "../lib/rate-limit.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "state_parks";
const SOURCE_QUALITY_SCORE = 0.7;
const AZ_CAMPSITE_QUALITY_SCORE = 0.5;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

// ── Per-state endpoint configuration ─────────────────────────────────────

interface EndpointConfig {
  url: string;
  where?: string;
  stableKey: string;
  groupBy?: string;
  /**
   * Optional secondary group key that disambiguates features sharing a
   * `groupBy` value. When multiple features share `groupBy` but disagree on
   * `disambiguateBy`, the dissolve treats them as distinct units instead of
   * merging their polygons under whichever `props` came first.
   *
   * Rationale: CA's ParkBoundaries source (measured 2026-09-03) has 14
   * distinct UNITNBR values shared across features with divergent UNITNAMEs
   * — most benignly (main park + satellite easements), but at least three
   * cases (UNITNBR=622 Agua Caliente vs Anza-Borrego; UNITNBR=534
   * Huntington City Beach vs Bolsa Chica SB; UNITNBR=449 Point Lobos
   * SMR vs SNR) are genuinely different parks under one UNITNBR. Without
   * disambiguation, the ingest merges their polygons into a single
   * oversized MultiPolygon, which then produces false-positive
   * `spatial_containment` matches downstream in the CA visitor-content ER.
   * See docs/investigations/2026-09-03-ca-unitnbr-dissolve-fix.md.
   */
  disambiguateBy?: string;
}

interface StateConfig {
  parks: EndpointConfig;
  campgrounds?: EndpointConfig;
  facilities?: EndpointConfig;
  campsites?: EndpointConfig;
  dataVintage?: string;
}

const STATE_CONFIGS: Record<string, StateConfig> = {
  CA: {
    parks: {
      url: "https://services2.arcgis.com/AhxrK3F6WM8ECvDi/arcgis/rest/services/ParkBoundaries/FeatureServer/0",
      groupBy: "UNITNBR",
      disambiguateBy: "UNITNAME",
      stableKey: "GlobalID",
    },
    campgrounds: {
      url: "https://services2.arcgis.com/AhxrK3F6WM8ECvDi/arcgis/rest/services/Campgrounds/FeatureServer/0",
      stableKey: "GISID",
    },
  },
  AZ: {
    parks: {
      url: "https://services2.arcgis.com/gdcQ6sUWKP8qwBmV/ArcGIS/rest/services/State_Park_Points/FeatureServer/0",
      stableKey: "GlobalID",
    },
    campsites: {
      url: "https://services2.arcgis.com/gdcQ6sUWKP8qwBmV/ArcGIS/rest/services/Campsites_WGS/FeatureServer/0",
      stableKey: "GlobalID",
    },
    dataVintage: "2016",
  },
  NV: {
    parks: {
      url: "https://arcgis.water.nv.gov/arcgis/rest/services/Hosted/SCORPRecAreas_Master/FeatureServer/0",
      where: "ownership='Nevada State Parks'",
      groupBy: "name",
      stableKey: "name",
    },
    facilities: {
      url: "https://arcgis.water.nv.gov/arcgis/rest/services/Hosted/TP_SCORP_Master/FeatureServer/0",
      where: "jurisdicti='NV State Parks'",
      stableKey: "objectid",
    },
  },
  UT: {
    parks: {
      url: "https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_State_Park_Management_Areas/FeatureServer/0",
      groupBy: "parkabbid",
      stableKey: "GlobalID",
    },
  },
  WA: {
    parks: {
      url: "https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/ParkBoundaries/FeatureServer/2",
      groupBy: "ParkName",
      stableKey: "ParkName",
    },
    campsites: {
      url: "https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/Campsites/FeatureServer/78",
      stableKey: "GlobalID",
    },
  },
  OR: {
    parks: {
      url: "https://maps.prd.state.or.us/arcgis/rest/services/Land_ownership/Oregon_State_Parks/FeatureServer/0",
      groupBy: "FULL_NAME",
      stableKey: "GlobalID",
    },
  },
};

// ── Zod schemas (passthrough — raw_payload retains all fields) ───────────

const GenericPropsSchema = z.record(z.unknown());

// ── Helpers ──────────────────────────────────────────────────────────────

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.trim().length > 0 ? s.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractPoint(geom: GeoJsonFeature["geometry"]): [number, number] | null {
  if (geom && geom.type === "Point") {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = typeof c[0] === "number" ? c[0] : NaN;
      const lat = typeof c[1] === "number" ? c[1] : NaN;
      if (Number.isFinite(lng) && Number.isFinite(lat) && !(lng === 0 && lat === 0)) {
        return [lng, lat];
      }
    }
  }
  return null;
}

function getStableKey(props: Record<string, unknown>, keyField: string): string | null {
  return trimOrNull(props[keyField]);
}

function getGroupKey(props: Record<string, unknown>, groupByField: string): string | null {
  return trimOrNull(props[groupByField]);
}

// ── NV facility category classification (verified against live schema) ────
//
// NV TP_SCORP_Master `type` field (coded domain "POI Type", 89 values).
// Within the state-parks-filtered subset (jurisdicti='NV State Parks'),
// 25 distinct values are present. Classified per spec §8.

const NV_CAMPGROUND_TYPES = new Set(["Campground"]);
const NV_TRAILHEAD_TYPES = new Set(["Non-motorized Trailhead", "Trailhead"]);

function classifyFacility(
  state: string,
  facilityType: string | null,
): { recordType: string; category: string } {
  if (state !== "NV") {
    return { recordType: "campground", category: "campground" };
  }
  const ft = facilityType?.trim() ?? "";
  if (NV_CAMPGROUND_TYPES.has(ft)) {
    return { recordType: "campground", category: "campground" };
  }
  if (NV_TRAILHEAD_TYPES.has(ft)) {
    return { recordType: "facility", category: "trailhead" };
  }
  return { recordType: "facility", category: "park_feature" };
}

// ── Boundary dissolve (CA, UT, OR) — follows padus.ts pattern ────────────

interface DissolvedPark {
  /** Composite hash key used for grouping this unit. */
  groupKey: string;
  /** Primary group key value (e.g. UNITNBR), independent of disambiguation. */
  primaryKey: string | null;
  /** Secondary group key value (e.g. UNITNAME), when disambiguateBy is set. */
  secondaryKey: string | null;
  /**
   * True when other units in the result share this unit's primaryKey — i.e.
   * the disambiguateBy field caused a split. Consumed by buildParkRow to
   * decide the external_id scheme.
   */
  divergent: boolean;
  props: Record<string, unknown>;
  members: unknown[];
  stableKeys: Set<string>;
}

function dissolveBoundaries(
  features: GeoJsonFeature[],
  groupByField: string,
  stableKeyField: string,
  disambiguateByField?: string,
): DissolvedPark[] {
  const byKey = new Map<string, DissolvedPark>();

  for (const feature of features) {
    const props = GenericPropsSchema.parse(feature.properties);
    const gk = getGroupKey(props, groupByField);
    if (!gk) {
      const sk = getStableKey(props, stableKeyField);
      if (!sk) continue;
      const singletonKey = `__null__${sk}`;
      byKey.set(singletonKey, {
        groupKey: singletonKey,
        primaryKey: null,
        secondaryKey: null,
        divergent: false,
        props,
        members: [],
        stableKeys: new Set([sk]),
      });
      const poly = extractPolygon(feature.geometry);
      if (poly) {
        const unit = byKey.get(singletonKey)!;
        if (poly.type === "Polygon") {
          unit.members.push(poly.coordinates);
        } else {
          for (const member of poly.coordinates as unknown[]) unit.members.push(member);
        }
      }
      continue;
    }

    // Composite key: primary + (optional) secondary. Features sharing the
    // primary but disagreeing on the secondary form separate units instead
    // of merging polygons.
    const secondary = disambiguateByField
      ? trimOrNull(props[disambiguateByField])
      : null;
    const compositeKey = disambiguateByField ? `${gk}|${secondary ?? ""}` : gk;

    let unit = byKey.get(compositeKey);
    if (!unit) {
      unit = {
        groupKey: compositeKey,
        primaryKey: gk,
        secondaryKey: secondary,
        divergent: false,
        props,
        members: [],
        stableKeys: new Set(),
      };
      byKey.set(compositeKey, unit);
    }

    const sk = getStableKey(props, stableKeyField);
    if (sk) unit.stableKeys.add(sk);

    const poly = extractPolygon(feature.geometry);
    if (poly) {
      if (poly.type === "Polygon") {
        unit.members.push(poly.coordinates);
      } else {
        for (const member of poly.coordinates as unknown[]) unit.members.push(member);
      }
    }
  }

  // Second pass: mark units as divergent when other units share their
  // primaryKey. Also mark ONE unit per divergent group as the "primary"
  // (alphabetically first non-null secondaryKey) so its external_id stays
  // `{primaryKey}` and only the other divergent units get suffixed. This
  // preserves backward-compatibility with existing PROD external_ids in
  // cases where the current record is already the alphabetical winner.
  if (disambiguateByField) {
    const primaryUnits = new Map<string, DissolvedPark[]>();
    for (const u of byKey.values()) {
      if (u.primaryKey) {
        if (!primaryUnits.has(u.primaryKey)) primaryUnits.set(u.primaryKey, []);
        primaryUnits.get(u.primaryKey)!.push(u);
      }
    }
    for (const [_, units] of primaryUnits) {
      if (units.length <= 1) continue;
      // Sort by secondaryKey (nulls sort last) to pick a deterministic primary.
      const sorted = [...units].sort((a, b) => {
        const ak = a.secondaryKey ?? "￿";
        const bk = b.secondaryKey ?? "￿";
        return ak.localeCompare(bk);
      });
      // Mark all as divergent EXCEPT the alphabetical winner: it keeps the
      // bare primaryKey as its external_id, matching pre-fix behavior for
      // records where the alphabetical winner is already the PROD name.
      for (let i = 1; i < sorted.length; i++) sorted[i].divergent = true;
    }
  }

  return [...byKey.values()];
}

/**
 * Slugify a UNITNAME for use as an external_id suffix on a divergent unit.
 * Keeps ASCII alnum + hyphens/underscores; folds whitespace to underscores;
 * strips other punctuation. Case-preserving because the ArcGIS layer's
 * UNITNAMEs are already mixed-case and the ingester's upsert is
 * case-sensitive.
 */
function unitNameSlug(name: string): string {
  return name
    .trim()
    // Non-ASCII → best-effort ASCII (drop diacritics)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 60);
}

// ── AZ park-point lookup (bridges PARK_ABBR4 codes to real names) ────────

interface AzParkInfo {
  name: string;
  globalId: string;
  lng: number;
  lat: number;
}

function buildAzParkLookup(parkFeatures: GeoJsonFeature[]): AzParkInfo[] {
  const result: AzParkInfo[] = [];
  for (const f of parkFeatures) {
    const props = GenericPropsSchema.parse(f.properties);
    const name = trimOrNull(props.Name);
    const globalId = trimOrNull(props.GlobalID);
    const point = extractPoint(f.geometry);
    if (name && globalId && point) {
      result.push({ name, globalId, lng: point[0], lat: point[1] });
    }
  }
  return result;
}

function findNearestPark(
  lng: number,
  lat: number,
  parks: AzParkInfo[],
): AzParkInfo | null {
  let best: AzParkInfo | null = null;
  let bestDist = Infinity;
  for (const p of parks) {
    const d = (p.lng - lng) ** 2 + (p.lat - lat) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

// ── AZ campsite aggregation ──────────────────────────────────────────────

interface AzCampsiteAgg {
  parkAbbr4: string;
  parkName: string | null;
  parkGlobalId: string | null;
  siteCount: number;
  centroidLng: number;
  centroidLat: number;
  amenities: {
    pct_electrical: number;
    pct_water: number;
    pct_sewer: number;
    pct_ada: number;
    pct_pull_through: number;
    pct_shaded: number;
    pct_reservable: number;
    pct_firepit: number;
    pct_grill: number;
    pct_picnic_table: number;
    pct_double_wide: number;
  };
  types: Record<string, number>;
  surfaces: Record<string, number>;
}

function isYes(v: unknown): boolean {
  return typeof v === "string" && v.trim().toLowerCase() === "yes";
}

function aggregateAzCampsites(features: GeoJsonFeature[], parkLookup: AzParkInfo[]): AzCampsiteAgg[] {
  const byPark = new Map<string, {
    sites: Array<{ props: Record<string, unknown>; point: [number, number] }>;
  }>();

  for (const feature of features) {
    const props = GenericPropsSchema.parse(feature.properties);
    const parkCode = trimOrNull(props.PARK_ABBR4);
    if (!parkCode) continue;
    const point = extractPoint(feature.geometry);
    if (!point) continue;

    let group = byPark.get(parkCode);
    if (!group) {
      group = { sites: [] };
      byPark.set(parkCode, group);
    }
    group.sites.push({ props, point });
  }

  const result: AzCampsiteAgg[] = [];
  for (const [parkAbbr4, group] of byPark) {
    const n = group.sites.length;
    let sumLng = 0, sumLat = 0;
    let electrical = 0, water = 0, sewer = 0, ada = 0;
    let pullThrough = 0, shaded = 0, reservable = 0;
    let firepit = 0, grill = 0, picnicTable = 0, doubleWide = 0;
    const types: Record<string, number> = {};
    const surfaces: Record<string, number> = {};

    for (const { props, point } of group.sites) {
      sumLng += point[0];
      sumLat += point[1];
      if (isYes(props.ELECTRICAL)) electrical++;
      if (isYes(props.WATER)) water++;
      if (isYes(props.SEWER)) sewer++;
      if (isYes(props.ADA)) ada++;
      if (trimOrNull(props.ACCESS_TYP) === "Pull_through") pullThrough++;
      if (isYes(props.SHADED)) shaded++;
      if (isYes(props.RESERVABLE)) reservable++;
      if (isYes(props.FIREPIT)) firepit++;
      if (isYes(props.GRILL)) grill++;
      if (isYes(props.PICNIC_TAB)) picnicTable++;
      if (isYes(props.DOUBLE_WID)) doubleWide++;
      const t = trimOrNull(props.TYPE);
      if (t) types[t] = (types[t] ?? 0) + 1;
      const s = trimOrNull(props.SURFACE);
      if (s) surfaces[s] = (surfaces[s] ?? 0) + 1;
    }

    const cLng = sumLng / n;
    const cLat = sumLat / n;
    const nearest = findNearestPark(cLng, cLat, parkLookup);
    if (!nearest) {
      logger.warn({ parkAbbr4 }, "state_parks: AZ campsite group has no matching park point — using code as name");
    }

    result.push({
      parkAbbr4,
      parkName: nearest?.name ?? null,
      parkGlobalId: nearest?.globalId ?? null,
      siteCount: n,
      centroidLng: cLng,
      centroidLat: cLat,
      amenities: {
        pct_electrical: Math.round((electrical / n) * 100) / 100,
        pct_water: Math.round((water / n) * 100) / 100,
        pct_sewer: Math.round((sewer / n) * 100) / 100,
        pct_ada: Math.round((ada / n) * 100) / 100,
        pct_pull_through: Math.round((pullThrough / n) * 100) / 100,
        pct_shaded: Math.round((shaded / n) * 100) / 100,
        pct_reservable: Math.round((reservable / n) * 100) / 100,
        pct_firepit: Math.round((firepit / n) * 100) / 100,
        pct_grill: Math.round((grill / n) * 100) / 100,
        pct_picnic_table: Math.round((picnicTable / n) * 100) / 100,
        pct_double_wide: Math.round((doubleWide / n) * 100) / 100,
      },
      types,
      surfaces,
    });
  }
  return result;
}

// ── WA campsite aggregation ──────────────────────────────────────────────

interface WaCampsiteAgg {
  parkName: string;
  activeSiteCount: number;
  totalSiteCount: number;
  centroidLng: number;
  centroidLat: number;
}

function aggregateWaCampsites(features: GeoJsonFeature[]): WaCampsiteAgg[] {
  const byPark = new Map<string, {
    activePoints: Array<[number, number]>;
    totalCount: number;
  }>();

  for (const feature of features) {
    const props = GenericPropsSchema.parse(feature.properties);
    const parkName = trimOrNull(props.ParkName);
    if (!parkName) continue;
    const point = extractPoint(feature.geometry);
    if (!point) continue;

    let group = byPark.get(parkName);
    if (!group) {
      group = { activePoints: [], totalCount: 0 };
      byPark.set(parkName, group);
    }
    group.totalCount++;
    if (trimOrNull(props.Filter) === "active") {
      group.activePoints.push(point);
    }
  }

  const result: WaCampsiteAgg[] = [];
  for (const [parkName, group] of byPark) {
    if (group.activePoints.length === 0) continue;
    let sumLng = 0, sumLat = 0;
    for (const [lng, lat] of group.activePoints) {
      sumLng += lng;
      sumLat += lat;
    }
    const n = group.activePoints.length;
    result.push({
      parkName,
      activeSiteCount: n,
      totalSiteCount: group.totalCount,
      centroidLng: sumLng / n,
      centroidLat: sumLat / n,
    });
  }
  return result;
}

// ── Row builders ─────────────────────────────────────────────────────────

function buildParkRow(
  state: string,
  unit: DissolvedPark,
  config: EndpointConfig,
): Record<string, unknown> | null {
  const props = unit.props;
  // buildParkRow is dissolve-path-only (CA/UT/OR); non-dissolve states use
  // buildPointParkRow. The dissolved polygon is the only geometry source.
  if (unit.members.length === 0) return null;
  const multiPoly = { type: "MultiPolygon" as const, coordinates: unit.members };
  const centroid = bboxCentroid(multiPoly);
  if (!centroid) return null;

  // external_id derivation:
  //   - No groupBy on this config → use the feature's stableKey directly.
  //   - groupBy without divergence → use the primary group value (e.g. UNITNBR).
  //   - groupBy + divergent (feature shares primaryKey with a sibling unit
  //     that won the alphabetical-secondaryKey tiebreak) → suffix with a
  //     slugified UNITNAME so each unit under the shared primary gets a
  //     distinct, deterministic external_id. The alphabetical winner keeps
  //     `{primaryKey}` unsuffixed, matching pre-fix PROD state for
  //     UNITNBR=622 (Agua Caliente wins alphabetically over Anza-Borrego).
  const key = config.groupBy
    ? unit.groupKey.startsWith("__null__")
      ? unit.groupKey.slice(8)
      : unit.divergent && unit.secondaryKey
      ? `${unit.primaryKey ?? unit.groupKey}-${unitNameSlug(unit.secondaryKey)}`
      : unit.primaryKey ?? unit.groupKey
    : getStableKey(props, config.stableKey);
  if (!key) return null;

  const name = trimOrNull(props.UNITNAME ?? props.Name ?? props.name ?? props.ParkName ?? props.FULL_NAME);
  if (!name) return null;

  return {
    source_id: SOURCE_ID,
    external_id: `state_parks:${state}:park:${key}`,
    name,
    inferred_category: "recreation_area",
    geometry: pointEwkt(centroid),
    raw_payload: { props, fetched_at: new Date().toISOString() },
    normalized_payload: {
      canonical_name: name,
      description: trimOrNull(props.Description),
      designation: trimOrNull(props.DESIGNATION ?? props.Category ?? props.SUBTYPE ?? props.bdy_type),
      acreage: numOrNull(props.GIS_ACRES ?? props.acres ?? props.Acres ?? props.TotAcreage),
      web_link: trimOrNull(props.WebPage ?? props.weblink1),
      subtype: trimOrNull(props.SUBTYPE),
      ...(multiPoly ? { geometry_polygon: multiPoly } : {}),
      provenance: {
        state,
        layer: config.url.split("/services/")[1]?.split("/FeatureServer")[0] ?? config.url,
        agency_id: key,
        ...(config.where ? { source_filter: config.where } : {}),
        ...(unit.stableKeys.size > 1 ? { dissolved_from: [...unit.stableKeys] } : {}),
      },
    },
    source_quality_score: SOURCE_QUALITY_SCORE,
    fetch_timestamp: new Date().toISOString(),
  };
}

function buildPointParkRow(
  state: string,
  feature: GeoJsonFeature,
  config: EndpointConfig,
): Record<string, unknown> | null {
  const props = GenericPropsSchema.parse(feature.properties);
  const point = extractPoint(feature.geometry);
  if (!point) return null;

  const key = getStableKey(props, config.stableKey);
  if (!key) return null;

  const name = trimOrNull(props.UNITNAME ?? props.Name ?? props.name ?? props.ParkName ?? props.FULL_NAME);
  if (!name) return null;

  return {
    source_id: SOURCE_ID,
    external_id: `state_parks:${state}:park:${key}`,
    name,
    inferred_category: "recreation_area",
    geometry: pointEwkt(point),
    raw_payload: { props, fetched_at: new Date().toISOString() },
    normalized_payload: {
      canonical_name: name,
      description: trimOrNull(props.Description),
      designation: trimOrNull(props.DESIGNATION ?? props.Category ?? props.SUBTYPE),
      acreage: numOrNull(props.GIS_ACRES ?? props.acres ?? props.Acres ?? props.TotAcreage),
      web_link: trimOrNull(props.WebPage ?? props.weblink1),
      provenance: {
        state,
        layer: config.url.split("/services/")[1]?.split("/FeatureServer")[0] ?? config.url,
        agency_id: key,
        ...(config.where ? { source_filter: config.where } : {}),
      },
    },
    source_quality_score: SOURCE_QUALITY_SCORE,
    fetch_timestamp: new Date().toISOString(),
  };
}

function buildCampgroundRow(
  state: string,
  feature: GeoJsonFeature,
  config: EndpointConfig,
  parentExternalIdLookup?: Map<string, string>,
): Record<string, unknown> | null {
  const props = GenericPropsSchema.parse(feature.properties);
  const point = extractPoint(feature.geometry);
  if (!point) return null;

  const key = getStableKey(props, config.stableKey);
  if (!key) return null;

  const name = trimOrNull(props.Campground ?? props.poiname ?? props.Name ?? props.name);
  if (!name) return null;

  const unitnbr = trimOrNull(props.UNITNBR);
  const parkName = trimOrNull(props.UNITNAME ?? props.ParkName ?? props.park_name);
  const parentId = unitnbr && parentExternalIdLookup
    ? parentExternalIdLookup.get(unitnbr) ?? null
    : null;

  const facilityType = trimOrNull(props.type ?? props.TYPE);
  const { recordType, category } = classifyFacility(state, facilityType);

  return {
    source_id: SOURCE_ID,
    external_id: `state_parks:${state}:${recordType}:${key}`,
    name,
    inferred_category: category,
    geometry: pointEwkt(point),
    raw_payload: { props, fetched_at: new Date().toISOString() },
    normalized_payload: {
      canonical_name: name,
      type: trimOrNull(props.TYPE ?? props.type),
      subtype: trimOrNull(props.SUBTYPE),
      park_name: parkName,
      ...(parentId ? { park_id: parentId } : {}),
      provenance: {
        state,
        layer: config.url.split("/services/")[1]?.split("/FeatureServer")[0] ?? config.url,
        agency_id: key,
      },
    },
    source_quality_score: SOURCE_QUALITY_SCORE,
    fetch_timestamp: new Date().toISOString(),
  };
}

function buildAzAggRow(agg: AzCampsiteAgg): Record<string, unknown> {
  const displayName = agg.parkName
    ? `${agg.parkName} Campground`
    : `${agg.parkAbbr4} Campground`;

  return {
    source_id: SOURCE_ID,
    external_id: `state_parks:AZ:campground:${agg.parkAbbr4}`,
    name: displayName,
    inferred_category: "campground",
    geometry: pointEwkt([agg.centroidLng, agg.centroidLat]),
    raw_payload: { park_abbr4: agg.parkAbbr4, site_count: agg.siteCount, fetched_at: new Date().toISOString() },
    normalized_payload: {
      canonical_name: displayName,
      data_vintage: "2016",
      data_vintage_source: "layer_metadata.editingInfo.lastEditDate",
      capacity: { site_count: agg.siteCount },
      amenities: agg.amenities,
      site_types: agg.types,
      surfaces: agg.surfaces,
      park_name: agg.parkName,
      ...(agg.parkGlobalId ? { park_id: `state_parks:AZ:park:${agg.parkGlobalId}` } : {}),
      provenance: {
        state: "AZ",
        layer: "Campsites_WGS",
        park_abbr4: agg.parkAbbr4,
        aggregated_from: agg.siteCount,
        ...(agg.parkName ? { resolved_park_name: agg.parkName } : { unresolved_code: true }),
      },
    },
    source_quality_score: AZ_CAMPSITE_QUALITY_SCORE,
    fetch_timestamp: new Date().toISOString(),
  };
}

function buildWaAggRow(agg: WaCampsiteAgg): Record<string, unknown> {
  return {
    source_id: SOURCE_ID,
    external_id: `state_parks:WA:campground:${agg.parkName}`,
    name: `${agg.parkName} Campground`,
    inferred_category: "campground",
    geometry: pointEwkt([agg.centroidLng, agg.centroidLat]),
    raw_payload: { park_name: agg.parkName, active_site_count: agg.activeSiteCount, fetched_at: new Date().toISOString() },
    normalized_payload: {
      canonical_name: `${agg.parkName} Campground`,
      capacity: { site_count: agg.activeSiteCount },
      park_name: agg.parkName,
      park_id: `state_parks:WA:park:${agg.parkName}`,
      provenance: {
        state: "WA",
        layer: "Campsites",
        park_name: agg.parkName,
        aggregated_from: agg.totalSiteCount,
        active_filter: true,
        record_granularity: "site",
      },
    },
    source_quality_score: SOURCE_QUALITY_SCORE,
    fetch_timestamp: new Date().toISOString(),
  };
}

// ── Per-state ingest ─────────────────────────────────────────────────────

async function ingestState(
  state: string,
  config: StateConfig,
  dryRun: boolean,
): Promise<{ fetched: number; written: number; skipped: number }> {
  const limit = limits.state_parks;
  if (!limit) throw new Error("state_parks: rate limiter missing");

  const stats = { fetched: 0, written: 0, skipped: 0 };
  const wideFilter = envelopeFilter([-125, 31, -109, 49]);

  // 1. Park-unit boundaries
  const parkConfig = config.parks;
  const parkRows: Record<string, unknown>[] = [];
  let rawParkFeatures: GeoJsonFeature[] = [];

  await limit(async () => {
    logger.info({ state, url: parkConfig.url, where: parkConfig.where }, "state_parks: fetching parks");
    const features = await fetchEsriFeatures(parkConfig.url, wideFilter, {
      where: parkConfig.where ?? "1=1",
      label: `state_parks.${state}.parks`,
      userAgent: USER_AGENT,
    });
    stats.fetched += features.length;
    rawParkFeatures = features;

    if (parkConfig.groupBy) {
      const units = dissolveBoundaries(features, parkConfig.groupBy, parkConfig.stableKey, parkConfig.disambiguateBy);
      logger.info({ state, features: features.length, dissolved: units.length }, "state_parks: dissolved");
      for (const unit of units) {
        const row = buildParkRow(state, unit, parkConfig);
        if (row) parkRows.push(row);
        else stats.skipped++;
      }
    } else {
      for (const feature of features) {
        const row = buildPointParkRow(state, feature, parkConfig);
        if (row) parkRows.push(row);
        else stats.skipped++;
      }
    }
  });

  // Build parent-lookup for campground park_id linkage (CA uses UNITNBR)
  const parentLookup = new Map<string, string>();
  if (parkConfig.groupBy) {
    for (const row of parkRows) {
      const eid = row.external_id as string;
      const key = eid.split(":").pop()!;
      parentLookup.set(key, eid);
    }
  }

  // 2. Campgrounds / facilities (1:1)
  const childRows: Record<string, unknown>[] = [];

  if (config.campgrounds) {
    await limit(async () => {
      const cfg = config.campgrounds!;
      logger.info({ state, url: cfg.url }, "state_parks: fetching campgrounds");
      const features = await fetchEsriFeatures(cfg.url, wideFilter, {
        where: cfg.where ?? "1=1",
        label: `state_parks.${state}.campgrounds`,
        userAgent: USER_AGENT,
      });
      stats.fetched += features.length;
      for (const feature of features) {
        const row = buildCampgroundRow(state, feature, cfg, parentLookup);
        if (row) childRows.push(row);
        else stats.skipped++;
      }
    });
  }

  if (config.facilities) {
    await limit(async () => {
      const cfg = config.facilities!;
      logger.info({ state, url: cfg.url, where: cfg.where }, "state_parks: fetching facilities");
      const features = await fetchEsriFeatures(cfg.url, wideFilter, {
        where: cfg.where ?? "1=1",
        label: `state_parks.${state}.facilities`,
        userAgent: USER_AGENT,
      });
      stats.fetched += features.length;
      for (const feature of features) {
        const row = buildCampgroundRow(state, feature, cfg);
        if (row) childRows.push(row);
        else stats.skipped++;
      }
    });
  }

  // 3. Campsite aggregation (AZ, WA)
  const aggRows: Record<string, unknown>[] = [];

  if (config.campsites) {
    await limit(async () => {
      const cfg = config.campsites!;
      logger.info({ state, url: cfg.url }, "state_parks: fetching campsites for aggregation");
      const features = await fetchEsriFeatures(cfg.url, wideFilter, {
        where: "1=1",
        label: `state_parks.${state}.campsites`,
        userAgent: USER_AGENT,
      });
      stats.fetched += features.length;

      if (state === "AZ") {
        const azParks = buildAzParkLookup(rawParkFeatures);
        const aggs = aggregateAzCampsites(features, azParks);
        const unresolved = aggs.filter(a => !a.parkName);
        if (unresolved.length > 0) {
          logger.warn({ codes: unresolved.map(a => a.parkAbbr4) }, "state_parks: AZ campsite groups with no matching park point");
        }
        logger.info({ state, sites: features.length, groups: aggs.length, resolved: aggs.length - unresolved.length }, "state_parks: AZ aggregated");
        for (const agg of aggs) aggRows.push(buildAzAggRow(agg));
      } else if (state === "WA") {
        const aggs = aggregateWaCampsites(features);
        logger.info({ state, sites: features.length, groups: aggs.length }, "state_parks: WA aggregated");
        for (const agg of aggs) aggRows.push(buildWaAggRow(agg));
      }
    });
  }

  // 4. Upsert
  const allRows = [...parkRows, ...childRows, ...aggRows];
  logger.info({
    state,
    parks: parkRows.length,
    children: childRows.length,
    aggregated: aggRows.length,
    total: allRows.length,
    skipped: stats.skipped,
  }, "state_parks: rows ready");

  if (dryRun) {
    stats.written = allRows.length;
    for (let i = 0; i < Math.min(3, allRows.length); i++) {
      logger.info({
        sample: i + 1,
        external_id: allRows[i].external_id,
        name: allRows[i].name,
        category: allRows[i].inferred_category,
      }, "state_parks: dry-run sample");
    }
    logger.info({ state, wouldWrite: allRows.length }, "state_parks: dry-run (no writes)");
    return stats;
  }

  if (allRows.length > 0) {
    const { written } = await batchUpsert({
      table: "source_record",
      rows: allRows,
      onConflict: "source_id,external_id",
      label: `state_parks.${state}`,
    });
    stats.written = written;
  }

  logger.info({ state, ...stats }, "state_parks: state complete");
  return stats;
}

// ── Entry ────────────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();

  const stateArg = opts.state?.toUpperCase();
  if (!stateArg) {
    throw new Error("state_parks: --state is required (CA, AZ, NV, UT, WA, OR, or ALL)");
  }

  const states = stateArg === "ALL"
    ? Object.keys(STATE_CONFIGS)
    : [stateArg];

  for (const s of states) {
    if (!STATE_CONFIGS[s]) {
      throw new Error(`state_parks: unknown state "${s}". Available: ${Object.keys(STATE_CONFIGS).join(", ")}, ALL`);
    }
  }

  const dryRun = opts.dryRun ?? false;
  const totals = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const state of states) {
    try {
      const result = await ingestState(state, STATE_CONFIGS[state], dryRun);
      totals.fetched += result.fetched;
      totals.inserted += result.written;
      totals.skipped += result.skipped;
    } catch (err) {
      logger.error({ state, err }, "state_parks: state ingest failed");
      totals.errors += 1;
    }
  }

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...totals };
  logger.info(result, "state_parks: ingestion complete");
  return result;
};

export default ingest;

export const _internals = {
  extractPoint,
  trimOrNull,
  numOrNull,
  isYes,
  getStableKey,
  classifyFacility,
  buildAzParkLookup,
  findNearestPark,
  dissolveBoundaries,
  aggregateAzCampsites,
  aggregateWaCampsites,
  buildParkRow,
  buildPointParkRow,
  buildCampgroundRow,
  buildAzAggRow,
  buildWaAggRow,
  STATE_CONFIGS,
  SOURCE_ID,
  SOURCE_QUALITY_SCORE,
  AZ_CAMPSITE_QUALITY_SCORE,
};
