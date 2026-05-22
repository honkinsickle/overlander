/* eslint-disable no-restricted-globals */

/**
 * Overlander offline cache service worker (session 1).
 *
 * Two scopes:
 *  1. api.mapbox.com — tile + style caching for the offline map
 *  2. Same-origin app shell — HTML + /_next/static/* so an offline
 *     reload actually serves the page that mounts the map
 *
 * Caches (session 1):
 *  - mb-style-v1                 : Mapbox style JSON + sprites + glyphs
 *  - mb-baseline-v1              : worldwide z=0-5 vector tiles (~1.4K tiles)
 *  - app-shell-html-<buildId>    : HTML responses, network-first
 *  - app-shell-static-<buildId>  : /_next/static/* (hashed assets), cache-first
 *
 * Per-phase tile caches (mb-phase-<phaseId>-streetsv8) land in session 3.
 *
 * Lifecycle: aggressive — skipWaiting on install, clients.claim on
 * activate. New SW takes over on first reload. On activate, stale
 * app-shell-* caches (different buildId) are evicted; mb-* untouched.
 *
 * Dev: when self.location.hostname === 'localhost' the fetch handler
 * short-circuits to network. Flip FORCE_CACHE_IN_DEV to true to test
 * cache behavior locally.
 */

// Build ID is injected by scripts/sw-version.mjs as a postbuild step.
// Generated `public/sw-version.js` overrides the default below.
// In dev the file doesn't exist; importScripts throws, default stays.
self.APP_BUILD_ID = "dev";
try {
  importScripts("/sw-version.js");
} catch {
  /* sw-version.js missing — dev mode, keep default */
}

const STYLE_CACHE = "mb-style-v1";
const BASELINE_CACHE = "mb-baseline-v1";
const APP_SHELL_HTML_CACHE = `app-shell-html-${self.APP_BUILD_ID}`;
const APP_SHELL_STATIC_CACHE = `app-shell-static-${self.APP_BUILD_ID}`;

const FORCE_CACHE_IN_DEV = true;
const IS_LOCAL = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

// Token comes from the page via postMessage once registration completes.
// Resolved when the first MAPBOX_TOKEN message arrives.
let resolveToken;
const tokenReady = new Promise((resolve) => {
  resolveToken = resolve;
});
let mapboxToken = null;
let baselineStyleUrl = null;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all clients immediately so the first page load after
  // install benefits from the SW without a reload. Also evict app-shell
  // caches from older builds — keeps storage bounded across deploys and
  // prevents the page from hydrating against an old chunk manifest.
  // Mapbox caches (mb-*) are intentionally untouched here: tiles outlive
  // app deploys and have their own version suffix (mb-*-streetsv8).
  event.waitUntil(
    Promise.all([self.clients.claim(), evictStaleAppShellCaches()]),
  );
  // Baseline prime is fire-and-forget; do not block activation on it.
  // Tile count is ~1.4K — priming synchronously could hang the SW lifecycle.
  primeBaselineWhenReady().catch((err) => {
    console.warn("[sw] baseline prime failed:", err?.message || err);
  });
});

async function evictStaleAppShellCaches() {
  const names = await caches.keys();
  await Promise.all(
    names.map(async (name) => {
      if (!name.startsWith("app-shell-")) return;
      if (name === APP_SHELL_HTML_CACHE || name === APP_SHELL_STATIC_CACHE) return;
      await caches.delete(name);
    }),
  );
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "MAPBOX_CONFIG" && typeof data.token === "string") {
    mapboxToken = data.token;
    baselineStyleUrl = typeof data.styleUrl === "string" ? data.styleUrl : null;
    resolveToken();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  // RSC payload requests share their URL with the HTML route but want
  // a different response shape. Pass through so Next handles them.
  if (request.headers.get("RSC")) return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (IS_LOCAL && !FORCE_CACHE_IN_DEV) {
    // Localhost-bypass: pass through to network, no caching in dev.
    return;
  }

  if (url.hostname === "api.mapbox.com") {
    event.respondWith(handleMapbox(request, url));
    return;
  }

  // Same-origin app shell. Hashed static assets are cache-first;
  // HTML routes are network-first so deploys stay fresh online and
  // only fall back to cache when offline.
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(handleStaticCacheFirst(request));
      return;
    }
    if (isAppHtmlRoute(url.pathname)) {
      event.respondWith(handleHtmlNetworkFirst(request));
      return;
    }
  }
  // Everything else (POST, RSC, Supabase, /api/*, /auth/*, /sw.js,
  // /sw-version.js, assorted public/ files) falls through to network.
});

async function handleMapbox(request, url) {
  const bucket = bucketFor(url);
  if (!bucket) return fetch(request);

  const cacheKey = stripCacheKey(url);
  const cache = await caches.open(bucket);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && shouldCache(url, bucket)) {
    cache.put(cacheKey, response.clone()).catch(() => {});
  }
  return response;
}

/** Routes whose HTML the iPad might reload offline. Keep narrow:
 *  caching the whole site invites stale-deploy / auth-leakage risk. */
function isAppHtmlRoute(pathname) {
  if (pathname === "/") return true;
  if (pathname === "/trips") return true;
  if (pathname.startsWith("/trips/")) return true;
  return false;
}

async function handleStaticCacheFirst(request) {
  const cache = await caches.open(APP_SHELL_STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function handleHtmlNetworkFirst(request) {
  const cache = await caches.open(APP_SHELL_HTML_CACHE);
  try {
    const response = await fetch(request);
    // Only cache successful 2xx responses. Server-redirect chains for
    // auth (3xx) and error states (4xx/5xx) would poison the cache
    // for the offline path.
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err; // browser handles its own offline error UI
  }
}

/** Mapbox URL → cache bucket name, or null to pass through. */
function bucketFor(url) {
  if (url.pathname.startsWith("/v4/")) return BASELINE_CACHE;
  if (url.pathname.startsWith("/styles/v1/")) return STYLE_CACHE;
  if (url.pathname.startsWith("/fonts/v1/")) return STYLE_CACHE;
  return null;
}

/** Session 1: baseline only caches z=0-5. Higher zooms pass through
 *  uncached (phase caches in session 3 will own them). Style resources
 *  always cache. */
function shouldCache(url, bucket) {
  if (bucket === STYLE_CACHE) return true;
  if (bucket === BASELINE_CACHE) {
    const z = parseTileZoom(url);
    return z !== null && z <= 5;
  }
  return false;
}

/** Tile path: /v4/{tileset_ids}/{z}/{x}/{y}.{ext}. Returns z or null. */
function parseTileZoom(url) {
  const m = url.pathname.match(/^\/v4\/[^/]+\/(\d+)\/\d+\/\d+\./);
  return m ? parseInt(m[1], 10) : null;
}

/** Strip token + session params so cache keys are deterministic and
 *  rotate-resilient. Returns a string (Cache API accepts URL strings). */
function stripCacheKey(url) {
  const u = new URL(url);
  u.searchParams.delete("access_token");
  return u.toString();
}

// --- Baseline prime (z=0-5 worldwide vector tiles) -----------------------

async function primeBaselineWhenReady() {
  // Already primed? Check cache contents rather than an in-memory flag —
  // the SW can be terminated and restarted any time; only the cache is
  // durable state.
  const cache = await caches.open(BASELINE_CACHE);
  const existing = await cache.keys();
  if (existing.length > 0) return;

  if (IS_LOCAL && !FORCE_CACHE_IN_DEV) return; // skip prime in dev

  // Wait for the page to send the token. If the user closes the tab
  // before a message arrives, the Promise just sits — no harm done.
  await tokenReady;
  if (!mapboxToken || !baselineStyleUrl) return;

  const styleApiUrl = mapboxStyleUrlToApi(baselineStyleUrl, mapboxToken);
  if (!styleApiUrl) return;

  const styleResp = await fetch(styleApiUrl);
  if (!styleResp.ok) throw new Error(`style ${styleResp.status}`);
  // Cache the style JSON while we have it — saves a round-trip on next
  // load (the page will also fetch it, but the SW intercepts that too).
  const styleCache = await caches.open(STYLE_CACHE);
  styleCache.put(stripCacheKey(new URL(styleApiUrl)), styleResp.clone()).catch(() => {});
  const style = await styleResp.json();

  const vectorSources = Object.values(style.sources || {}).filter(
    (s) => s.type === "vector" && typeof s.url === "string" && s.url.startsWith("mapbox://"),
  );

  for (const source of vectorSources) {
    const tilesetIds = source.url.replace("mapbox://", "");
    const urls = enumerateTileUrls(tilesetIds, 0, 5, mapboxToken);
    await fetchInBatches(urls, 8, cache);
  }
}

/** mapbox://styles/{user}/{id} → https://api.mapbox.com/styles/v1/... */
function mapboxStyleUrlToApi(mapboxUrl, token) {
  const m = mapboxUrl.match(/^mapbox:\/\/styles\/([^/]+)\/([^/?]+)/);
  if (!m) return null;
  return `https://api.mapbox.com/styles/v1/${m[1]}/${m[2]}?access_token=${token}`;
}

function enumerateTileUrls(tilesetIds, zMin, zMax, token) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const count = 1 << z; // 2^z
    for (let x = 0; x < count; x++) {
      for (let y = 0; y < count; y++) {
        out.push(
          `https://api.mapbox.com/v4/${tilesetIds}/${z}/${x}/${y}.vector.pbf?access_token=${token}`,
        );
      }
    }
  }
  return out;
}

async function fetchInBatches(urls, batchSize, cache) {
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (u) => {
        try {
          const resp = await fetch(u);
          if (resp.ok) {
            const key = stripCacheKey(new URL(u));
            await cache.put(key, resp);
          }
        } catch {
          // skip failed tile, keep priming the rest
        }
      }),
    );
  }
}
