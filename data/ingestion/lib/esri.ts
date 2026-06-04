/**
 * Shared ESRI ArcGIS REST query helper.
 *
 * Parks Canada and Alberta Parks both query ESRI Feature/MapServer layers
 * with the identical `/query` contract: bbox envelope filter, server-side
 * reprojection to WGS84, GeoJSON output, and resultOffset pagination
 * terminated by ESRI's `exceededTransferLimit` signal. This module is that
 * shared path (confirmed by two concrete ESRI-REST sources).
 *
 * NOT for BC Parks: its boundary layer is OGC WFS (a different query shape
 * — startIndex/sortBy/axis-swapped bbox) and its enrichment side is a
 * Strapi REST API. Neither rides this helper; both stay in bc-parks.ts
 * until a second WFS source justifies extracting the WFS path.
 *
 * PAD-US / BLM SMA / USFS (the 3rd–5th ESRI-REST sources) also ride this
 * helper. PAD-US additionally needs a cheap pre-flight feature count to
 * size a corridor before pulling geometry — `fetchEsriCount` below.
 */

import type { BoundingBox } from "./geometry.ts";
import { GeoJsonFeatureCollectionSchema, type GeoJsonFeature } from "./geojson.ts";
import { logger } from "./logger.ts";
import { defaultRetry } from "./retry.ts";

export interface EsriFetchOptions {
  /** ESRI `where` clause, e.g. "1=1" or "TYPE IN ('PP','PRA','WPP')". */
  where: string;
  /** ESRI `outFields`. Defaults to "*" (raw payload retains everything). */
  outFields?: string;
  /** Page size (resultRecordCount). Defaults to 1000. */
  pageSize?: number;
  /** Label for logs, retry key, and error messages (e.g. "parks_canada.boundaries"). */
  label: string;
  /** User-Agent header value. */
  userAgent: string;
}

// ──────────────────────────────────────────────────────────────────────
// Spatial filter — bbox envelope OR corridor buffer polygon
// ──────────────────────────────────────────────────────────────────────
//
// Corridor-buffer clipping: the bbox envelope (a rectangle) over-pulls dense
// layers (PAD-US, MVUM) far beyond the actual route. Filtering by the corridor
// BUFFER POLYGON cuts that volume substantially. ESRI accepts an
// esriGeometryPolygon as the spatial filter; it is too large for a GET query
// string, so polygon filters are POSTed.

/** ESRI polygon geometry JSON. Exterior ring MUST be clockwise (ESRI reads a
 *  CCW outer ring as a hole → ~0 results). */
export interface EsriPolygon {
  rings: number[][][];
  spatialReference: { wkid: number };
}

/** Spatial filter for an ESRI `/query`: either a bbox envelope or a polygon. */
export type EsriSpatialFilter =
  | { kind: "envelope"; bbox: BoundingBox }
  | { kind: "polygon"; polygon: EsriPolygon };

/** Wrap a bbox as an envelope filter. */
export function envelopeFilter(bbox: BoundingBox): EsriSpatialFilter {
  return { kind: "envelope", bbox };
}

/**
 * Signed-area (shoelace) test: true if a linear ring is wound clockwise in
 * ESRI/screen terms. Pure; used to orient rings for ESRI and unit-tested.
 */
export function ringIsClockwise(ring: ReadonlyArray<readonly number[]>): boolean {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    sum += (b[0] - a[0]) * (b[1] + a[1]);
  }
  // Positive shoelace sum over (x2-x1)(y2+y1) ⇒ clockwise.
  return sum > 0;
}

function reversedRing(ring: number[][]): number[][] {
  return [...ring].reverse();
}

/**
 * Build an ESRI polygon from a GeoJSON Polygon, enforcing ESRI ring winding:
 * exterior ring CLOCKWISE, interior rings COUNTER-clockwise. The active
 * corridor buffer arrives already CW from the `active_corridor_buffer_cw_geojson`
 * RPC (ST_ForcePolygonCW); this is defense-in-depth so the JS path is correct
 * (and testable) regardless of input winding.
 */
export function esriPolygonFromGeoJson(
  geojson: { type?: string; coordinates?: unknown },
  wkid = 4326,
): EsriPolygon {
  if (geojson?.type !== "Polygon" || !Array.isArray(geojson.coordinates)) {
    throw new Error(`esriPolygonFromGeoJson: expected a GeoJSON Polygon, got ${String(geojson?.type)}`);
  }
  const rings = (geojson.coordinates as number[][][]).map((ring, idx) => {
    const cw = ringIsClockwise(ring);
    if (idx === 0) return cw ? ring : reversedRing(ring); // exterior → CW
    return cw ? reversedRing(ring) : ring; // interior holes → CCW
  });
  return { rings, spatialReference: { wkid } };
}

/** Apply a spatial filter to an ESRI query param bag. Returns whether the
 *  request must be POSTed (polygon geometry is too large for a GET). */
function applySpatialFilter(params: URLSearchParams, filter: EsriSpatialFilter): { mustPost: boolean } {
  params.set("spatialRel", "esriSpatialRelIntersects");
  params.set("inSR", "4326");
  if (filter.kind === "envelope") {
    params.set("geometry", filter.bbox.join(","));
    params.set("geometryType", "esriGeometryEnvelope");
    return { mustPost: false };
  }
  params.set("geometry", JSON.stringify(filter.polygon));
  params.set("geometryType", "esriGeometryPolygon");
  return { mustPost: true };
}

/** Issue an ESRI `/query` request — GET for envelope, POST (form body) for a
 *  polygon filter (too large for a query string). Returns the raw Response. */
async function esriRequest(
  serviceUrl: string,
  params: URLSearchParams,
  mustPost: boolean,
  userAgent: string,
): Promise<Response> {
  if (mustPost) {
    return fetch(`${serviceUrl}/query`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: params.toString(),
    });
  }
  // GET for the envelope path — pass a URL object so callers/tests can read
  // searchParams directly.
  return fetch(new URL(`${serviceUrl}/query?${params.toString()}`), {
    headers: { Accept: "application/json", "User-Agent": userAgent },
  });
}

/**
 * Query an ESRI REST layer for all features intersecting `bbox`, merging
 * paginated GeoJSON pages.
 *
 * Coercion: `inSR=4326` interprets the bbox as WGS84; `outSR=4326` forces
 * WGS84 output (layers native to 3857 / 3400 reproject server-side);
 * `f=geojson` bypasses ESRI JSON encoding. The ESRI Envelope is
 * xmin,ymin,xmax,ymax — matching the [W,S,E,N] BoundingBox tuple directly.
 *
 * Pagination terminates on a short page that did NOT also set
 * `exceededTransferLimit` (which would mean "more remain"); a zero-length
 * page always breaks as an infinite-loop guard.
 */
export async function fetchEsriFeatures(
  serviceUrl: string,
  filter: EsriSpatialFilter,
  opts: EsriFetchOptions,
): Promise<GeoJsonFeature[]> {
  const { where, outFields = "*", pageSize = 1000, label, userAgent } = opts;
  const features: GeoJsonFeature[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set("where", where);
    const { mustPost } = applySpatialFilter(params, filter);
    params.set("outSR", "4326");
    params.set("outFields", outFields);
    params.set("f", "geojson");
    params.set("resultOffset", String(offset));
    params.set("resultRecordCount", String(pageSize));

    const page = await defaultRetry(async () => {
      const res = await esriRequest(serviceUrl, params, mustPost, userAgent);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${label} ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      const parsed = GeoJsonFeatureCollectionSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(
          { err: parsed.error.flatten(), label },
          "esri: response failed FeatureCollection validation",
        );
        throw new Error(`${label}: schema mismatch`);
      }
      return parsed.data;
    }, `${label}.fetch`);

    features.push(...page.features);
    logger.debug(
      { label, offset, pageSize: page.features.length, total: features.length },
      "esri: page",
    );

    const shortPage = page.features.length < pageSize;
    const transferLimitHit = page.exceededTransferLimit === true;
    if (shortPage && !transferLimitHit) break;
    offset += page.features.length;
    if (page.features.length === 0) break; // safety: never infinite-loop
  }

  return features;
}

/**
 * Cheap pre-flight: how many features intersect `bbox`, via ESRI
 * `returnCountOnly`. No geometry transfer. Used to size a corridor (and
 * assert it's non-empty / not absurd) before pulling full geometry.
 */
export async function fetchEsriCount(
  serviceUrl: string,
  filter: EsriSpatialFilter,
  opts: { where: string; label: string; userAgent: string },
): Promise<number> {
  const params = new URLSearchParams();
  params.set("where", opts.where);
  const { mustPost } = applySpatialFilter(params, filter);
  params.set("returnCountOnly", "true");
  params.set("f", "json");

  const json = await defaultRetry(async () => {
    const res = await esriRequest(serviceUrl, params, mustPost, opts.userAgent);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${opts.label} count ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as { count?: unknown };
  }, `${opts.label}.count`);

  if (typeof json.count !== "number") {
    throw new Error(`${opts.label}: returnCountOnly response missing numeric count`);
  }
  return json.count;
}
