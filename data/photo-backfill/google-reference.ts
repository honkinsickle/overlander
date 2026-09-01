/**
 * Live Google reference-photo fetch for the photo-verification pass.
 *
 * ⚠️ COMPLIANCE — live comparison ONLY. The image bytes returned here exist
 * solely in process memory for the duration of one vision comparison and are
 * then discarded. Callers MUST NOT write them (or the Google place id / photo
 * name / URL) to any table, file, or cache. Nothing here persists anything;
 * keep it that way. See the standing rule "Google Places — live-fetch-at-render
 * is compliant; warehousing is not."
 *
 * Uses the Places API (New): searchText (name + coordinate bias) → the top
 * result's first photo → the photo `media` endpoint (302 → CDN bytes). No
 * placeId is stored; it is used only transiently to build the media URL.
 */

import { z } from "zod";

const GKEY = () => {
  const k = process.env.GOOGLE_PLACES_API_KEY;
  if (!k) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return k;
};

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const SearchResponse = z.object({
  places: z
    .array(
      z.object({
        id: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
        photos: z.array(z.object({ name: z.string() })).optional(),
      }),
    )
    .optional(),
});

export type GoogleReference =
  | { status: "ok"; imageBase64: string; mediaType: string; refSource: string }
  | { status: "no_result" };

async function withBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      // Retry transient errors only; a hard 4xx (bad request) won't improve.
      if (status && status < 500 && status !== 429) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.floor(attempt * 137)));
    }
  }
  throw new Error(`${label}: exhausted retries (${String(lastErr)})`);
}

/**
 * Fetch a live Google reference photo for a place by name + coordinate.
 * Returns `{status:'ok', imageBase64}` (bytes in memory), `{status:'no_result'}`
 * when Google has no matching place/photo, or THROWS on API/network error after
 * retries (caller treats a throw as "unverified", never as a mismatch).
 */
export async function fetchGoogleReference(
  name: string,
  lat: number,
  lng: number,
  opts?: { radiusM?: number; maxWidthPx?: number; fetchImpl?: typeof fetch },
): Promise<GoogleReference> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const radius = opts?.radiusM ?? 30000;
  const maxWidth = opts?.maxWidthPx ?? 800;

  const search = await withBackoff(async () => {
    const r = await fetchImpl(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GKEY(),
        "X-Goog-FieldMask": "places.id,places.location,places.photos",
      },
      body: JSON.stringify({
        textQuery: `${name} California`,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } },
        maxResultCount: 3,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw Object.assign(new Error(`searchText ${r.status}: ${body.slice(0, 160)}`), { status: r.status });
    }
    const parsed = SearchResponse.safeParse(await r.json());
    if (!parsed.success) throw new Error("searchText: schema mismatch");
    return parsed.data;
  }, "google.searchText");

  const withPhoto = (search.places ?? []).find((p) => (p.photos ?? []).length > 0);
  const photoName = withPhoto?.photos?.[0]?.name;
  if (!photoName) return { status: "no_result" };

  const { base64, mediaType } = await withBackoff(async () => {
    // The media endpoint 302s to a CDN URL; fetch follows redirects by default.
    const r = await fetchImpl(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${GKEY()}`,
    );
    if (!r.ok) {
      throw Object.assign(new Error(`photo media ${r.status}`), { status: r.status });
    }
    const mediaType = r.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const buf = Buffer.from(await r.arrayBuffer());
    return { base64: buf.toString("base64"), mediaType };
  }, "google.photoMedia");

  return { status: "ok", imageBase64: base64, mediaType, refSource: "google_places_text_search" };
}
