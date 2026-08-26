/**
 * Wikipedia Geosearch photo matcher.
 *
 * Matches corpus POIs to nearby Wikipedia articles via the MediaWiki
 * Geosearch API, scores on a compound name-similarity + distance signal,
 * and resolves the lead image + license metadata from Wikimedia Commons.
 *
 * Pure matching logic — no DB writes. The backfill script
 * (data/scripts/backfill-wikipedia-photo.ts) drives this module.
 *
 * Rate etiquette: caller must limit concurrency (≤3) and respect 429s.
 */

const UA =
  "overlander-data-ingestion/0.1 (adam@acwcreative.com)";

const DEFAULT_RADIUS = 1500; // meters

// ── Name scoring ──────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "at", "in", "on", "and", "or",
  "national", "state", "county", "park", "area", "site",
  "recreation", "historic", "historical", "monument", "memorial", "forest",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTokens(s: string): string[] {
  return normalize(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function tokenOverlap(a: string, b: string): number {
  const ta = extractTokens(a);
  const tb = extractTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  let overlap = 0;
  for (const t of ta) {
    if (tb.includes(t)) overlap++;
  }
  return overlap / Math.max(ta.length, tb.length);
}

export function substringMatch(poi: string, wiki: string): boolean {
  const a = normalize(poi);
  const b = normalize(wiki);
  return a.includes(b) || b.includes(a);
}

export type Confidence = "high" | "medium" | "none";

export function classifyConfidence(
  nameScore: number,
  distM: number,
  sub: boolean,
): Confidence {
  if ((nameScore >= 0.5 || sub) && distM <= 500) return "high";
  if (nameScore >= 0.45 && distM <= 500) return "medium";
  if (sub && distM <= 1000) return "medium";
  if (nameScore >= 0.5 && distM <= 1000) return "medium";
  return "none";
}

// ── Wikipedia API ─────────────────────────────────────────────────────

export type WikiCandidate = {
  pageid: number;
  title: string;
  dist: number;
  hasThumbnail: boolean;
};

export async function geosearch(
  lat: number,
  lng: number,
  opts?: { radius?: number; fetchImpl?: typeof fetch },
): Promise<WikiCandidate[]> {
  const f = opts?.fetchImpl ?? fetch;
  const radius = opts?.radius ?? DEFAULT_RADIUS;

  // Step 1: list=geosearch for reliable distance values
  const u1 = new URL("https://en.wikipedia.org/w/api.php");
  u1.searchParams.set("action", "query");
  u1.searchParams.set("format", "json");
  u1.searchParams.set("list", "geosearch");
  u1.searchParams.set("gscoord", `${lat}|${lng}`);
  u1.searchParams.set("gsradius", String(radius));
  u1.searchParams.set("gslimit", "10");

  const r1 = await f(u1.toString(), { headers: { "User-Agent": UA } });
  if (r1.status === 429) {
    const wait = parseInt(r1.headers.get("Retry-After") ?? "5", 10) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return geosearch(lat, lng, opts);
  }
  if (!r1.ok) return [];
  const j1 = (await r1.json()) as Record<string, unknown>;
  const items = ((j1.query as Record<string, unknown>)?.geosearch ?? []) as Array<Record<string, unknown>>;
  if (items.length === 0) return [];

  // Step 2: get pageimages for thumbnail detection
  const pageids = items.map((i) => i.pageid).join("|");
  const u2 = new URL("https://en.wikipedia.org/w/api.php");
  u2.searchParams.set("action", "query");
  u2.searchParams.set("format", "json");
  u2.searchParams.set("pageids", pageids);
  u2.searchParams.set("prop", "pageimages");
  u2.searchParams.set("piprop", "thumbnail");
  u2.searchParams.set("pithumbsize", "400");

  const r2 = await f(u2.toString(), { headers: { "User-Agent": UA } });
  const pages = r2.ok
    ? (((await r2.json()) as Record<string, unknown>).query as Record<string, unknown>)?.pages as Record<string, Record<string, unknown>> ?? {}
    : {};

  return items.map((i) => ({
    pageid: i.pageid as number,
    title: i.title as string,
    dist: i.dist as number,
    hasThumbnail: !!(pages[String(i.pageid)] as Record<string, unknown> | undefined)?.thumbnail,
  }));
}

// ── Image + license resolution ────────────────────────────────────────

export type WikiImage = {
  url: string;
  license: string;
  licenseUrl: string | null;
  artist: string | null;
};

export async function resolveImage(
  pageTitle: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<WikiImage | null> {
  const f = opts?.fetchImpl ?? fetch;

  // Get the pageimage filename
  const u1 = new URL("https://en.wikipedia.org/w/api.php");
  u1.searchParams.set("action", "query");
  u1.searchParams.set("format", "json");
  u1.searchParams.set("titles", pageTitle);
  u1.searchParams.set("prop", "pageimages");
  u1.searchParams.set("piprop", "name");

  const r1 = await f(u1.toString(), { headers: { "User-Agent": UA } });
  if (!r1.ok) return null;
  const j1 = (await r1.json()) as Record<string, unknown>;
  const pages1 = (j1.query as Record<string, unknown>)?.pages as Record<string, Record<string, unknown>> | undefined;
  const page = pages1 ? Object.values(pages1)[0] : undefined;
  const file = page?.pageimage as string | undefined;
  if (!file) return null;

  // Get license info from Commons
  const u2 = new URL("https://commons.wikimedia.org/w/api.php");
  u2.searchParams.set("action", "query");
  u2.searchParams.set("format", "json");
  u2.searchParams.set("titles", `File:${file}`);
  u2.searchParams.set("prop", "imageinfo");
  u2.searchParams.set("iiprop", "url|extmetadata");

  const r2 = await f(u2.toString(), { headers: { "User-Agent": UA } });
  if (!r2.ok) return null;
  const j2 = (await r2.json()) as Record<string, unknown>;
  const pages2 = (j2.query as Record<string, unknown>)?.pages as Record<string, Record<string, unknown>> | undefined;
  const cp = pages2 ? Object.values(pages2)[0] : undefined;
  const imageinfo = cp?.imageinfo as Array<Record<string, unknown>> | undefined;
  const ii = imageinfo?.[0];
  if (!ii) return null;

  const meta = (ii.extmetadata ?? {}) as Record<string, { value?: string }>;
  const license = meta.LicenseShortName?.value;
  if (!license) return null; // no license → don't cache

  // Strip HTML from Artist field (Commons often wraps it in <a> tags)
  const rawArtist = meta.Artist?.value ?? null;
  const artist = rawArtist
    ? rawArtist.replace(/<[^>]+>/g, "").trim()
    : null;

  return {
    url: ii.url as string,
    license,
    licenseUrl: meta.LicenseUrl?.value ?? null,
    artist,
  };
}

// ── Full match pipeline ──────────────────────────────────────────────

export type WikiMatch = {
  confidence: Confidence;
  wikiTitle: string;
  distM: number;
  nameScore: number;
  image: WikiImage;
};

export async function matchPoi(
  name: string,
  lat: number,
  lng: number,
  opts?: { radius?: number; fetchImpl?: typeof fetch },
): Promise<WikiMatch | null> {
  const candidates = await geosearch(lat, lng, opts);
  if (candidates.length === 0) return null;

  // Score and sort
  const scored = candidates.map((c) => ({
    ...c,
    nameScore: tokenOverlap(name, c.title),
    sub: substringMatch(name, c.title),
  }));

  scored.sort((a, b) => {
    const ac = classifyConfidence(a.nameScore, a.dist, a.sub);
    const bc = classifyConfidence(b.nameScore, b.dist, b.sub);
    const order: Record<string, number> = { high: 0, medium: 1, none: 2 };
    if (order[ac] !== order[bc]) return order[ac] - order[bc];
    return b.nameScore - a.nameScore || a.dist - b.dist;
  });

  const best = scored[0];
  const confidence = classifyConfidence(best.nameScore, best.dist, best.sub);
  if (confidence === "none") return null;
  if (!best.hasThumbnail) return null;

  const image = await resolveImage(best.title, opts);
  if (!image) return null;

  return {
    confidence,
    wikiTitle: best.title,
    distM: best.dist,
    nameScore: best.nameScore,
    image,
  };
}

/**
 * Build the `normalized_payload.photo` object for a Wikipedia match,
 * in the same shape as NPS uses (`{ url, altText, credit }`).
 *
 * `credit` is set only for CC-licensed images (includes artist + license).
 * Public-domain images get `credit: null` (the task says skip attribution
 * UI for PD images).
 */
export function toNormalizedPhoto(match: WikiMatch): {
  url: string;
  altText: string | null;
  credit: string | null;
  license: string;
  licenseUrl: string | null;
} {
  const isPD =
    match.image.license.toLowerCase().includes("public domain");

  const credit =
    isPD || !match.image.artist
      ? null
      : `${match.image.artist} / ${match.image.license}`;

  return {
    url: match.image.url,
    altText: match.wikiTitle,
    credit,
    license: match.image.license,
    licenseUrl: match.image.licenseUrl,
  };
}
