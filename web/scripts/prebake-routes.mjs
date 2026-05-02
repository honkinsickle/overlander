#!/usr/bin/env node
// Pre-bake the road-following Mapbox geometry for a trip and write it
// to a TS module that the fixture imports. Mirrors the chunk + dedupe
// + recursive-split pipeline in `src/components/trip/map-column.tsx`,
// so that the page-load path can skip 20+ Directions API calls.
//
// Usage:
//   node scripts/prebake-routes.mjs
//
// Requires: dev server running at $WEB_URL (default http://localhost:3210)
//           and NEXT_PUBLIC_MAPBOX_TOKEN set in web/.env.local.
//
// Re-run after editing day coords on the trip. The output file is
// committed to the repo.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");

const TRIP_ID = "la-to-deadhorse";
const OUT_FILE = resolve(webRoot, "src/lib/trips/alaska-route.ts");
const WEB_URL = process.env.WEB_URL ?? "http://localhost:3210";
const CHUNK_LIMIT = 25;
const POLYLINE_PRECISION = 5; // 5dp ≈ 1m, matches the runtime decoder

// Standard Google polyline encoding (5dp). Takes [[lng, lat], ...] in our
// internal order; encoded stream is lat,lng per the spec, so we swap here.
// Inverse of the decoder in `web/src/components/trip/map-column.tsx`.
function encodePolyline(coords) {
  const factor = Math.pow(10, POLYLINE_PRECISION);
  const encodeNum = (n) => {
    n = n < 0 ? ~(n << 1) : n << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>>= 5;
    }
    s += String.fromCharCode(n + 63);
    return s;
  };
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  for (const [lng, lat] of coords) {
    const latI = Math.round(lat * factor);
    const lngI = Math.round(lng * factor);
    out += encodeNum(latI - prevLat) + encodeNum(lngI - prevLng);
    prevLat = latI;
    prevLng = lngI;
  }
  return out;
}

async function loadToken() {
  const env = await readFile(resolve(webRoot, ".env.local"), "utf8");
  const match = env.match(/^NEXT_PUBLIC_MAPBOX_TOKEN=(.+)$/m);
  if (!match) throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN not in web/.env.local");
  return match[1].trim();
}

async function loadTrip() {
  const url = `${WEB_URL}/api/trips/${TRIP_ID}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status}. Is the dev server running?`);
  }
  return res.json();
}

function buildRouteCoords(trip) {
  const dayCoords = trip.days
    .map((d) => d.coords)
    .filter((c) => Array.isArray(c) && c.length === 2);
  return trip.startCoords ? [trip.startCoords, ...dayCoords] : dayCoords;
}

function dedupe(coords) {
  const out = [];
  for (const c of coords) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) out.push(c);
  }
  return out;
}

async function fetchRoute(coords, token) {
  if (coords.length < 2) return coords;
  const path = coords.map((c) => `${c[0]},${c[1]}`).join(";");
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${path}` +
    `?geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url);
  if (res.ok) {
    const json = await res.json();
    const geo = json?.routes?.[0]?.geometry?.coordinates;
    if (geo && geo.length > 0) return geo;
    // 200 + empty routes → NoRoute, fall through to split
  } else {
    console.warn(`  HTTP ${res.status} for ${coords.length}-coord chunk`);
  }
  if (coords.length === 2) {
    console.warn(
      `  unroutable pair → straight line: ${JSON.stringify(coords)}`,
    );
    return coords;
  }
  const mid = Math.floor(coords.length / 2);
  const left = await fetchRoute(coords.slice(0, mid + 1), token);
  const right = await fetchRoute(coords.slice(mid), token);
  return [...left, ...right.slice(1)];
}

async function main() {
  const token = await loadToken();
  console.log(`Loading trip ${TRIP_ID} from ${WEB_URL}…`);
  const trip = await loadTrip();
  const routeCoords = buildRouteCoords(trip);
  const deduped = dedupe(routeCoords);
  console.log(
    `  ${trip.days.length} days, ${routeCoords.length} coords (${deduped.length} after dedupe)`,
  );

  const chunks = [];
  for (let i = 0; i < deduped.length; i += CHUNK_LIMIT - 1) {
    chunks.push(deduped.slice(i, i + CHUNK_LIMIT));
    if (i + CHUNK_LIMIT >= deduped.length) break;
  }
  console.log(`  ${chunks.length} chunks of ≤${CHUNK_LIMIT} coords`);

  const chunkResults = await Promise.all(chunks.map((c) => fetchRoute(c, token)));
  const rawMerged = chunkResults.flatMap((c, i) => (i === 0 ? c : c.slice(1)));
  // Drop consecutive duplicates at 5dp (~1m). Polyline encoding is delta-
  // based, so identical-after-rounding points add 2 wasted bytes each.
  const round5 = (n) => Math.round(n * 1e5) / 1e5;
  const merged = [];
  for (const [lng, lat] of rawMerged) {
    const c = [round5(lng), round5(lat)];
    const prev = merged[merged.length - 1];
    if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) merged.push(c);
  }
  const polyline = encodePolyline(merged);
  console.log(
    `  merged: ${rawMerged.length} → ${merged.length} coords (${polyline.length} polyline chars)`,
  );

  const tripIdConst = TRIP_ID
    .toUpperCase()
    .replace(/-/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
  // Polyline strings can contain backslashes and backticks, so use a JSON-
  // escaped double-quoted string literal — JSON's escape rules cover every
  // byte the encoder can emit.
  const ts = `// Pre-baked road-following route for ${TRIP_ID}.
// Generated by scripts/prebake-routes.mjs — do not edit by hand.
// Re-run the script after editing day coords on the trip.
//
// ${trip.days.length} days · ${merged.length} merged coords · polyline${POLYLINE_PRECISION}

export const ${tripIdConst}_POLYLINE: string =
  ${JSON.stringify(polyline)};
`;

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, ts, "utf8");
  console.log(`Wrote ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
