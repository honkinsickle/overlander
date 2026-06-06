// wfs-adapter.js
// OGC WFS 2.0 adapter for DataBC (GeoServer) layers.
// Mirrors the ESRI adapter contract: corridor-buffer clip + OBJECTID keyset
// paging, yields canonical rows for the shared EWKT -> PostGIS write path.
// Node 18+ (global fetch). Zero external deps. BC sources only.

const DEFAULT_PAGE = 10000;
const DEFAULT_TIMEOUT_MS = 60000;
const SLEEP_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function geojsonToWkt(g) {
  const pt = ([x, y]) => `${x} ${y}`;
  const ring = (r) => `(${r.map(pt).join(', ')})`;
  switch (g.type) {
    case 'Point': return `POINT(${pt(g.coordinates)})`;
    case 'MultiPoint': return `MULTIPOINT(${g.coordinates.map(pt).join(', ')})`;
    case 'LineString': return `LINESTRING(${g.coordinates.map(pt).join(', ')})`;
    case 'Polygon': return `POLYGON(${g.coordinates.map(ring).join(', ')})`;
    case 'MultiPolygon':
      return `MULTIPOLYGON(${g.coordinates.map((p) => `(${p.map(ring).join(', ')})`).join(', ')})`;
    default: throw new Error(`Unsupported geometry: ${g.type}`);
  }
}
const toEWKT = (g) => `SRID=4326;${geojsonToWkt(g)}`;
const pointEWKT = ([lon, lat]) => `SRID=4326;POINT(${lon} ${lat})`;

function ringCentroid(coords) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i]; const [x1, y1] = coords[i + 1];
    const f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a === 0) {
    const n = coords.length - 1;
    const s = coords.slice(0, n).reduce((m, [x, y]) => [m[0] + x, m[1] + y], [0, 0]);
    return [s[0] / n, s[1] / n];
  }
  a *= 0.5; return [cx / (6 * a), cy / (6 * a)];
}
function featureCentroid(g) {
  switch (g.type) {
    case 'Point': return g.coordinates;
    case 'MultiPoint': return g.coordinates[0];
    case 'Polygon': return ringCentroid(g.coordinates[0]);
    case 'MultiPolygon': {
      let best = null, n = -1;
      for (const p of g.coordinates) if (p[0].length > n) { n = p[0].length; best = p[0]; }
      return ringCentroid(best);
    }
    default: throw new Error(`Cannot derive pin for geometry: ${g.type}`);
  }
}
function oidOf(feature, oidField) {
  const p = feature.properties || {};
  const v = p[oidField] ?? p[oidField.toLowerCase()] ?? p[oidField.toUpperCase()];
  if (v != null) return Number(v);
  if (typeof feature.id === 'string') {
    const tail = feature.id.split('.').pop();
    if (tail && !Number.isNaN(Number(tail))) return Number(tail);
  }
  throw new Error(`No ${oidField} on feature ${feature.id ?? '(no id)'} — set oidField to the layer PK`);
}
// GET by default; POST the params as form-urlencoded KVP when `postBody` is
// given (large corridor WKT overflows GET URL length → HTTP 414). GeoServer
// accepts KVP-over-POST identically to the query string — same form (a) CQL.
async function getJson(url, timeoutMs, postBody) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = postBody
      ? { method: 'POST', signal: ctrl.signal, headers: { 'User-Agent': 'overlander-loader/1.0', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: postBody }
      : { signal: ctrl.signal, headers: { 'User-Agent': 'overlander-loader/1.0', Accept: 'application/json' } };
    const res = await fetch(url, init);
    const body = await res.text();
    if (!res.ok) throw new Error(`WFS HTTP ${res.status}: ${body.slice(0, 300)}`);
    let json;
    try { json = JSON.parse(body); }
    catch { throw new Error(`WFS returned non-JSON (likely a ServiceException): ${body.slice(0, 300)}`); }
    if (json.exceptions) throw new Error(`WFS exception: ${JSON.stringify(json.exceptions).slice(0, 300)}`);
    return json;
  } finally { clearTimeout(t); }
}
function normalize(feature, ctx) {
  const p = feature.properties || {};
  const oid = oidOf(feature, ctx.oidField);
  const row = { source: ctx.source, source_id: oid };
  for (const [canon, remote] of Object.entries(ctx.fieldMap)) row[canon] = p[remote] ?? null;
  if (ctx.role) { row.is_overlay = true; row.geom_ewkt = toEWKT(feature.geometry); }
  else { const [lon, lat] = featureCentroid(feature.geometry); row.lon = lon; row.lat = lat; row.geom_ewkt = pointEWKT([lon, lat]); }
  return row;
}
export async function* wfsFeatures(config, corridorGeoJSON, opts = {}) {
  const { id, base, typeName, geomField = 'SHAPE', oidField = 'OBJECTID', pageMax = DEFAULT_PAGE,
    outputSrs = 'EPSG:4326', filter: extraCql, role, fieldMap = {} } = config;
  const page = Math.min(opts.pageSize || pageMax, pageMax);
  const geom = corridorGeoJSON.geometry || corridorGeoJSON;
  const corridorWkt = geojsonToWkt(geom);
  // form (a) verified against DataBC: SRID-prefixed 4326 literal, no reprojection.
  const spatial = `INTERSECTS(${geomField}, SRID=4326;${corridorWkt})`;
  let cursor = opts.startOid ?? 0; let total = 0;
  for (;;) {
    const conds = [spatial, `${oidField} > ${cursor}`];
    if (extraCql) conds.push(`(${extraCql})`);
    const qs = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName,
      outputFormat: 'json', srsName: outputSrs, sortBy: oidField, count: String(page),
      CQL_FILTER: conds.join(' AND '),
    });
    // POST when the GET URL would overflow (~241-vertex corridor WKT → 414).
    const getUrl = `${base}?${qs}`;
    const fc = getUrl.length > 7000
      ? await getJson(base, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, qs.toString())
      : await getJson(getUrl, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const feats = fc.features || [];
    if (feats.length === 0) break;
    for (const f of feats) yield normalize(f, { source: id, oidField, role, fieldMap });
    total += feats.length;
    cursor = feats.reduce((m, f) => Math.max(m, oidOf(f, oidField)), cursor);
    if (feats.length < page) break;
    await sleep(opts.sleepMs ?? SLEEP_MS);
  }
  return total;
}
export { geojsonToWkt, toEWKT, featureCentroid };
