/**
 * Wikimedia Commons photo-candidate matcher (photo-backfill pilot).
 *
 * Distinct from ingestion/sources/wikipedia.ts, which matches POIs to nearby
 * Wikipedia ARTICLES (high precision, low recall — most campgrounds have no
 * article). This module queries Wikimedia Commons DIRECTLY in the File
 * namespace, which surfaces geotagged CC/PD photos even when no article
 * exists (higher recall, lower precision — hence the strict scoring +
 * license allowlist applied by ../photo-backfill/matcher.ts).
 *
 * Pure fetch/parse — no DB writes, no accept/reject decision. The matcher and
 * the driver script own scoring and persistence.
 *
 * Rate etiquette (Wikimedia): send a descriptive User-Agent, keep concurrency
 * low (<=3), and honor 429 Retry-After. The driver enforces concurrency.
 */

import { z } from "zod";

const UA =
  "overlander-data-photo-pilot/0.1 (github.com/honkinsickle/overlander; adam@acwcreative.com)";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

export type CommonsCandidate = {
  /** File page title, e.g. "File:Foo Campground.jpg" */
  title: string;
  /** Full-resolution original URL */
  imageUrl: string;
  /** Scaled thumbnail URL (<=1024px) when available */
  thumbUrl: string | null;
  /** The Commons File: description page */
  sourcePageUrl: string | null;
  /** LicenseShortName, e.g. "CC BY-SA 2.0", "Public domain", "CC0" */
  license: string | null;
  licenseUrl: string | null;
  /** Author/uploader, HTML-stripped */
  artist: string | null;
  /** Free-text image description (HTML-stripped), used for name matching */
  imageDescription: string | null;
  /** Distance in meters from the query coordinate (geosearch only) */
  distanceM: number | null;
  /** How this candidate was found */
  via: "geosearch" | "text";
};

// ── Response validation ──────────────────────────────────────────────────

// extmetadata values are mostly {value: string} but some entries carry a
// numeric value (e.g. CommonsMetadataExtension: 1.2). Tolerate any value type
// here; the fields we actually read (LicenseShortName, Artist, …) are strings
// and are coerced via `asString` on read.
const ExtMetaValue = z.object({ value: z.unknown().optional() });

const ImageInfo = z.object({
  url: z.string().optional(),
  thumburl: z.string().optional(),
  descriptionurl: z.string().optional(),
  extmetadata: z.record(z.string(), ExtMetaValue).optional(),
});

const CommonsPage = z.object({
  title: z.string().optional(),
  imageinfo: z.array(ImageInfo).optional(),
});

const GeoHit = z.object({
  title: z.string(),
  dist: z.number().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
});

const CommonsResponse = z.object({
  query: z
    .object({
      // imageinfo (prop) keys pages by pageid; list=geosearch / list=search
      // return arrays.
      pages: z.record(z.string(), CommonsPage).optional(),
      geosearch: z.array(GeoHit).optional(),
      search: z
        .array(z.object({ title: z.string() }))
        .optional(),
    })
    .optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function stripHtml(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

async function commonsGet(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<z.infer<typeof CommonsResponse>> {
  const u = new URL(COMMONS_API);
  u.searchParams.set("format", "json");
  u.searchParams.set("formatversion", "1");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetchImpl(u.toString(), { headers: { "User-Agent": UA } });
    if (r.status === 429) {
      const wait = parseInt(r.headers.get("Retry-After") ?? "5", 10) * 1000;
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (!r.ok) return {};
    const parsed = CommonsResponse.safeParse(await r.json());
    return parsed.success ? parsed.data : {};
  }
  return {};
}

function toCandidate(
  page: z.infer<typeof CommonsPage>,
  via: CommonsCandidate["via"],
  distanceM: number | null,
): CommonsCandidate | null {
  const ii = page.imageinfo?.[0];
  if (!ii?.url) return null;
  const meta = ii.extmetadata ?? {};
  return {
    title: page.title ?? "",
    imageUrl: ii.url,
    thumbUrl: ii.thumburl ?? null,
    sourcePageUrl: ii.descriptionurl ?? null,
    license: asString(meta.LicenseShortName?.value) ?? null,
    licenseUrl: asString(meta.LicenseUrl?.value) ?? null,
    artist: stripHtml(asString(meta.Artist?.value)),
    imageDescription:
      stripHtml(asString(meta.ImageDescription?.value)) ??
      stripHtml(asString(meta.ObjectName?.value)),
    distanceM,
    via,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Find CC/PD File-namespace photos geotagged within `radiusM` of (lat,lng).
 * Returns candidates with license + description metadata, sorted nearest-first.
 */
export async function geosearchPhotos(
  lat: number,
  lng: number,
  opts?: { radiusM?: number; limit?: number; fetchImpl?: typeof fetch },
): Promise<CommonsCandidate[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const radius = opts?.radiusM ?? 2000;
  const limit = opts?.limit ?? 8;

  // Step 1: list=geosearch in the File namespace → per-file distance + coords.
  const geo = await commonsGet(
    {
      action: "query",
      list: "geosearch",
      gscoord: `${lat}|${lng}`,
      gsradius: String(radius),
      gslimit: String(limit),
      gsnamespace: "6", // File:
    },
    fetchImpl,
  );
  const hits = geo.query?.geosearch ?? [];
  if (hits.length === 0) return [];
  const distByTitle = new Map<string, number | null>(
    hits.map((h) => [h.title, h.dist ?? null]),
  );

  // Step 2: resolve imageinfo + license for those file titles.
  const info = await commonsGet(
    {
      action: "query",
      titles: hits.map((h) => h.title).join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "1024",
    },
    fetchImpl,
  );
  const pages = info.query?.pages ?? {};
  const out: CommonsCandidate[] = [];
  for (const page of Object.values(pages)) {
    const c = toCandidate(
      page,
      "geosearch",
      page.title != null ? distByTitle.get(page.title) ?? null : null,
    );
    if (c) out.push(c);
  }
  out.sort((a, b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12));
  return out;
}

/**
 * Text search Commons File namespace by place name (name-anchored recall).
 * Resolves imageinfo + license for the top hits.
 */
export async function textSearchPhotos(
  query: string,
  opts?: { limit?: number; fetchImpl?: typeof fetch },
): Promise<CommonsCandidate[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const limit = opts?.limit ?? 5;

  const search = await commonsGet(
    {
      action: "query",
      list: "search",
      srsearch: query,
      srnamespace: "6",
      srlimit: String(limit),
    },
    fetchImpl,
  );
  const titles = (search.query?.search ?? []).map((s) => s.title);
  if (titles.length === 0) return [];

  const info = await commonsGet(
    {
      action: "query",
      titles: titles.join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "1024",
    },
    fetchImpl,
  );
  const pages = info.query?.pages ?? {};
  const out: CommonsCandidate[] = [];
  for (const page of Object.values(pages)) {
    const c = toCandidate(page, "text", null);
    if (c) out.push(c);
  }
  return out;
}
