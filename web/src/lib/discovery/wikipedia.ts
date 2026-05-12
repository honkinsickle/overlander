import type { SourceResult } from "./types";

/**
 * Wikipedia summary thumbnail enrichment.
 *
 * Three-stage lookup per result:
 *
 *   1. OSM `wikipedia` tag (e.g. `en:Mount Hollywood`) — highest confidence,
 *      already author-attached. Use the title directly.
 *   2. Geosearch around the result's coords for nearby Wikipedia pages.
 *      Pick the closest page whose title matches (exact, then substring).
 *   3. If neither path yields a candidate, leave the result alone — the
 *      next pipeline step (Mapillary) gets a chance.
 *
 * Coverage uplift over Wikidata-P18 alone: significant. Many Wikipedia
 * articles have lead images without a structured P18 claim, and most
 * named US hills/peaks/landmarks have at least a stub article.
 *
 * Free, no API key, no batched-coords endpoint — but `prop=pageimages`
 * batches up to 50 titles per request, which we use to keep latency low.
 */

const REST_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const ACTION_API = "https://en.wikipedia.org/w/api.php";
const UA = "overlander-web/0.1 (+adam@acwcreative.com)";

const SEARCH_RADIUS_M = 500;
const CONCURRENCY = 5;
const MAX_LOOKUPS = 30;
const PAGEIMAGES_BATCH = 50;

type GeosearchResponse = {
  query?: { geosearch?: Array<{ pageid: number; title: string; lat: number; lon: number; dist: number }> };
};

type PageImagesResponse = {
  query?: { pages?: Record<string, { title?: string; original?: { source?: string } }> };
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** "en:Mount Hollywood" → "Mount Hollywood". Falls back to the input. */
function stripLangPrefix(raw: string): string {
  const m = raw.match(/^[a-z]{2,3}:(.+)$/i);
  return m ? m[1] : raw;
}

/** Extract a Wikipedia title from an OSM-tag string, if present. */
function titleFromOsmTag(r: SourceResult): string | null {
  const wp = (r.raw as { wikipedia?: unknown } | undefined)?.wikipedia;
  if (typeof wp !== "string" || wp.length === 0) return null;
  // OSM convention: `en:Title` (lang-prefixed). Sometimes language codes
  // for non-English wikis, in which case we'd need a different REST host
  // — for v1 we only follow English-language refs.
  if (/^[a-z]{2,3}:/i.test(wp) && !/^en:/i.test(wp)) return null;
  return stripLangPrefix(wp);
}

async function geosearchTitle(
  result: SourceResult,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const [lng, lat] = result.coords;
  const url =
    `${ACTION_API}?action=query&list=geosearch` +
    `&gscoord=${lat}|${lng}&gsradius=${SEARCH_RADIUS_M}&gslimit=5` +
    `&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal });
    if (!res.ok) return null;
    const json = (await res.json()) as GeosearchResponse;
    const hits = json.query?.geosearch ?? [];
    if (hits.length === 0) return null;
    const wantedNorm = normalize(result.title);
    // Exact normalized title match wins.
    const exact = hits.find((h) => normalize(h.title) === wantedNorm);
    if (exact) return exact.title;
    // Substring match (either direction) — handles "Mount X" vs "X (mountain)".
    const partial = hits.find(
      (h) =>
        normalize(h.title).includes(wantedNorm) ||
        wantedNorm.includes(normalize(h.title)),
    );
    if (partial) return partial.title;
    // Last resort: closest page within the radius, but only if it's
    // genuinely close (≤100m). Prevents unrelated nearby articles from
    // attaching wrong photos to obscure features.
    const closest = hits.reduce((a, b) => (a.dist < b.dist ? a : b));
    if (closest.dist <= 100) return closest.title;
    return null;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return null;
    return null;
  }
}

/** Run async tasks with a concurrency cap. */
async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** Fetch lead-image URLs for up to `PAGEIMAGES_BATCH` titles per call. */
async function fetchPageImages(
  titles: string[],
  signal: AbortSignal | undefined,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < titles.length; i += PAGEIMAGES_BATCH) {
    const chunk = titles.slice(i, i + PAGEIMAGES_BATCH);
    const url =
      `${ACTION_API}?action=query&prop=pageimages&piprop=original` +
      `&titles=${encodeURIComponent(chunk.join("|"))}` +
      `&format=json&origin=*`;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal });
      if (!res.ok) continue;
      const json = (await res.json()) as PageImagesResponse;
      for (const page of Object.values(json.query?.pages ?? {})) {
        if (page.title && page.original?.source) {
          out.set(page.title, page.original.source);
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return out;
      // skip this chunk
    }
  }
  return out;
}

export async function enrichWithWikipedia(
  results: SourceResult[],
  signal?: AbortSignal,
): Promise<void> {
  const targets = results.filter((r) => !r.photoUrl).slice(0, MAX_LOOKUPS);
  if (targets.length === 0) return;

  // Stage 1: pull whatever titles OSM already gave us (no network).
  const titlesByResult = new Map<SourceResult, string>();
  const needGeosearch: SourceResult[] = [];
  for (const r of targets) {
    const osmTitle = titleFromOsmTag(r);
    if (osmTitle) titlesByResult.set(r, osmTitle);
    else needGeosearch.push(r);
  }

  // Stage 2: geosearch the rest.
  const geosearched = await mapWithConcurrency(needGeosearch, CONCURRENCY, (r) =>
    geosearchTitle(r, signal),
  );
  needGeosearch.forEach((r, i) => {
    const t = geosearched[i];
    if (t) titlesByResult.set(r, t);
  });

  if (titlesByResult.size === 0) return;

  // Stage 3: batch-fetch lead images for all candidate titles.
  const uniqueTitles = Array.from(new Set(titlesByResult.values()));
  const photos = await fetchPageImages(uniqueTitles, signal);

  for (const [result, title] of titlesByResult) {
    const url = photos.get(title);
    if (url) result.photoUrl = url;
  }
}
