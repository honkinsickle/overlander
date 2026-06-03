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
  bbox: BoundingBox,
  opts: EsriFetchOptions,
): Promise<GeoJsonFeature[]> {
  const { where, outFields = "*", pageSize = 1000, label, userAgent } = opts;
  const features: GeoJsonFeature[] = [];
  let offset = 0;

  while (true) {
    const url = new URL(`${serviceUrl}/query`);
    url.searchParams.set("where", where);
    url.searchParams.set("geometry", bbox.join(","));
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("outFields", outFields);
    url.searchParams.set("f", "geojson");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(pageSize));

    const page = await defaultRetry(async () => {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": userAgent },
      });
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
  bbox: BoundingBox,
  opts: { where: string; label: string; userAgent: string },
): Promise<number> {
  const url = new URL(`${serviceUrl}/query`);
  url.searchParams.set("where", opts.where);
  url.searchParams.set("geometry", bbox.join(","));
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("returnCountOnly", "true");
  url.searchParams.set("f", "json");

  const json = await defaultRetry(async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": opts.userAgent },
    });
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
