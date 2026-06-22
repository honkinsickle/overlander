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

type PageDataResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        original?: { source?: string };
        extract?: string;
      }
    >;
  };
};

type PageData = { photo?: string; extract?: string };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Grammatical glue + generic STRUCTURAL nouns dropped before the
 *  name-affinity check. A co-located article sharing only one of these with
 *  the place (e.g. "… Building", "… Tower") is NOT evidence they're the same
 *  place — that's exactly the failure mode the 2c guard blocks. */
const AFFINITY_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "of", "a", "an", "and", "at", "in", "on",
  "building", "buildings", "tower", "hall", "center", "centre",
  "plaza", "house", "block", "complex",
]);

/** Significant tokens of a title: lowercased alphanumeric words minus the
 *  AFFINITY_STOPWORDS. */
function significantTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0 && !AFFINITY_STOPWORDS.has(t)),
  );
}

/** Name-affinity guard for the LOW-confidence proximity fallback (2c) only:
 *  the co-located article must share at least one SIGNIFICANT token with the
 *  place title. Blocks "Bottega Louie" → "Brockman Building" and "Grand
 *  Central Market" → "Homer Laughlin Building" (co-located but unrelated)
 *  while keeping "Bixby Creek Bridge" → "Bixby Bridge". */
function sharesSignificantToken(
  placeTitle: string,
  articleTitle: string,
): boolean {
  const placeTokens = significantTokens(placeTitle);
  if (placeTokens.size === 0) return false;
  for (const t of significantTokens(articleTitle)) {
    if (placeTokens.has(t)) return true;
  }
  return false;
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
    // genuinely close (≤100m) AND shares a significant token with the place
    // title. The distance gate alone let co-located but differently-named
    // articles attach (a restaurant picking up the Wikipedia article for the
    // historic BUILDING it sits in); the name-affinity guard blocks those
    // while keeping legitimate wording differences ("Bixby Creek Bridge" →
    // "Bixby Bridge").
    const closest = hits.reduce((a, b) => (a.dist < b.dist ? a : b));
    if (closest.dist <= 100 && sharesSignificantToken(result.title, closest.title)) {
      return closest.title;
    }
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

/** Fetch lead image + intro extract for up to `PAGEIMAGES_BATCH` titles
 *  per call. Combining `pageimages` + `extracts` keeps the round-trip
 *  count flat — same Action API call, two extra props.
 *
 *  `exintro=1` limits the extract to the lead section; `explaintext=1`
 *  strips the wiki markup so we get plain text suitable for a card
 *  description; `exsentences=3` caps each at ~3 sentences. */
async function fetchPageData(
  titles: string[],
  signal: AbortSignal | undefined,
): Promise<Map<string, PageData>> {
  const out = new Map<string, PageData>();
  for (let i = 0; i < titles.length; i += PAGEIMAGES_BATCH) {
    const chunk = titles.slice(i, i + PAGEIMAGES_BATCH);
    const url =
      `${ACTION_API}?action=query` +
      `&prop=pageimages|extracts&piprop=original` +
      `&exintro=1&explaintext=1&exsentences=3` +
      `&titles=${encodeURIComponent(chunk.join("|"))}` +
      `&format=json&origin=*`;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal });
      if (!res.ok) continue;
      const json = (await res.json()) as PageDataResponse;
      for (const page of Object.values(json.query?.pages ?? {})) {
        if (!page.title) continue;
        const entry: PageData = {};
        if (page.original?.source) entry.photo = page.original.source;
        const extract = page.extract?.trim();
        if (extract) entry.extract = extract;
        if (entry.photo || entry.extract) out.set(page.title, entry);
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
  // Enrich anything missing EITHER a photo or a description — Google-
  // sourced places already have photos but lack descriptions, and OSM
  // places often have neither. The single batched call below fetches
  // both, so the cost of "also wanted description" is zero round-trips.
  const targets = results
    .filter((r) => !r.photoUrl || !r.description)
    .slice(0, MAX_LOOKUPS);
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

  // Stage 3: batch-fetch lead image + intro extract for all candidates.
  const uniqueTitles = Array.from(new Set(titlesByResult.values()));
  const pages = await fetchPageData(uniqueTitles, signal);

  for (const [result, title] of titlesByResult) {
    const page = pages.get(title);
    if (!page) continue;
    if (page.photo && !result.photoUrl) result.photoUrl = page.photo;
    if (page.extract && !result.description) result.description = page.extract;
  }
}
