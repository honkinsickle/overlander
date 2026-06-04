/**
 * Read-only smoke for corridor-buffer clipping. Exercises the NEW polygon
 * spatial-filter path (esri.ts → applySpatialFilter(polygon) → POST) against
 * the live ESRI endpoints with returnCountOnly — proves the code path, not just
 * the unit tests. NO DB writes, NO ingest.
 *
 * Supply the corridor buffer polygon as GeoJSON via the CORRIDOR_GEOJSON env
 * var (e.g. ST_AsGeoJSON(ST_ForcePolygonCW(buffer_geom)) from the active
 * corridor). Endpoints + where-clauses are copied verbatim from the loaders.
 *
 *   CORRIDOR_GEOJSON='{"type":"Polygon",...}' tsx scripts/smoke-corridor-clip.ts
 */

import { esriPolygonFromGeoJson, fetchEsriCount, type EsriSpatialFilter } from "../ingestion/lib/esri.ts";

const USER_AGENT = "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

const SOURCES = [
  {
    name: "padus",
    url: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Fee_Managers_PADUS/FeatureServer/0",
    where: "1=1",
    expect: 11204,
  },
  {
    name: "mvum",
    url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer/1",
    where: "1=1",
    expect: 10123,
  },
  {
    name: "usfs",
    url: "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationOpportunities_01/MapServer/0",
    where: "markeractivity='Dispersed Camping'",
    expect: 20,
  },
] as const;

async function main(): Promise<void> {
  const raw = process.env.CORRIDOR_GEOJSON;
  if (!raw) throw new Error("CORRIDOR_GEOJSON env var required (active corridor buffer as GeoJSON).");
  const polygon = esriPolygonFromGeoJson(JSON.parse(raw) as { type?: string; coordinates?: unknown });
  const filter: EsriSpatialFilter = { kind: "polygon", polygon };
  // eslint-disable-next-line no-console
  console.log(`buffer polygon: ${polygon.rings.length} ring(s), ${polygon.rings[0]?.length} exterior vertices`);
  for (const s of SOURCES) {
    const count = await fetchEsriCount(s.url, filter, { where: s.where, label: s.name, userAgent: USER_AGENT });
    // eslint-disable-next-line no-console
    console.log(`${s.name}: buffer count = ${count} (expected ~${s.expect})`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("smoke-corridor-clip failed:", err);
  process.exit(1);
});
