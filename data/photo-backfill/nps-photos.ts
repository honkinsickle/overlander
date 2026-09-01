/**
 * NPS campground photo source (photo-backfill pilot).
 *
 * NPS content is generally public domain (works of U.S. federal employees),
 * but the API's per-image `credit` sometimes names a non-NPS photographer
 * whose rights are unclear. This module fetches CA NPS campgrounds once and
 * exposes a name+geo matcher; the license judgement (NPS-credited → public
 * domain; third-party-credited → manual_review) is applied by the caller via
 * matcher.adjudicateNps.
 *
 * Auth: NPS_API_KEY (query param). Only ~100 CA campgrounds exist, so the
 * whole set is prefetched into memory and matched locally — no per-place API
 * call.
 */

import { z } from "zod";
import { haversineMeters } from "../entity-resolution/matcher.ts";
import { substringMatch, tokenOverlap } from "../ingestion/sources/wikipedia.ts";
import { weakPlaceName } from "./matcher.ts";

const UA = "overlander-data-photo-pilot/0.1 (adam@acwcreative.com)";
const NPS_BASE = "https://developer.nps.gov/api/v1";

const NpsImage = z.object({
  url: z.string(),
  credit: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  altText: z.string().optional().nullable(),
  caption: z.string().optional().nullable(),
});

const NpsCampgroundRaw = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional().nullable(),
  latitude: z.string().optional().nullable(),
  longitude: z.string().optional().nullable(),
  images: z.array(NpsImage).optional(),
});

const NpsListResponse = z.object({
  total: z.string().optional(),
  data: z.array(NpsCampgroundRaw).optional(),
});

export type NpsCampground = {
  id: string;
  name: string;
  pageUrl: string | null;
  lng: number;
  lat: number;
  images: Array<z.infer<typeof NpsImage>>;
};

function requireKey(): string {
  const k = process.env.NPS_API_KEY;
  if (!k) throw new Error("NPS_API_KEY is not set");
  return k;
}

/** Prefetch all CA NPS campgrounds that have coordinates + at least one image. */
export async function fetchCaCampgrounds(
  opts?: { fetchImpl?: typeof fetch },
): Promise<NpsCampground[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const key = requireKey();
  const out: NpsCampground[] = [];
  const pageSize = 50;
  for (let start = 0; ; start += pageSize) {
    const u = new URL(`${NPS_BASE}/campgrounds`);
    u.searchParams.set("stateCode", "CA");
    u.searchParams.set("limit", String(pageSize));
    u.searchParams.set("start", String(start));
    u.searchParams.set("api_key", key);

    const r = await fetchImpl(u.toString(), {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (!r.ok) throw new Error(`NPS campgrounds ${r.status}`);
    const parsed = NpsListResponse.safeParse(await r.json());
    if (!parsed.success) throw new Error("NPS campgrounds: schema mismatch");
    const rows = parsed.data.data ?? [];
    for (const c of rows) {
      const lat = c.latitude ? Number(c.latitude) : NaN;
      const lng = c.longitude ? Number(c.longitude) : NaN;
      const images = (c.images ?? []).filter((i) => i.url);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (images.length === 0) continue;
      out.push({ id: c.id, name: c.name, pageUrl: c.url ?? null, lng, lat, images });
    }
    if (rows.length < pageSize) break;
  }
  return out;
}

// NPS `images[]` mixes real photos with maps, diagrams, logos, and signs.
// Filename/title/caption tokens are the only reliable signal available, so
// drop candidates that look like non-photographic graphics.
const NON_PHOTO_RE =
  /\b(map|maps|diagram|schematic|chart|graphic|logo|brochure|floorplan|sign|signage|infographic|illustration)\b|[-_](map|diagram|logo|sign)[-_.]/i;

/** First image in an NPS campground's set that looks like an actual photo. */
export function pickPhoto(
  images: Array<z.infer<typeof NpsImage>>,
): z.infer<typeof NpsImage> | null {
  for (const img of images) {
    const hay = `${img.url} ${img.title ?? ""} ${img.altText ?? ""} ${img.caption ?? ""}`;
    if (NON_PHOTO_RE.test(hay)) continue;
    return img;
  }
  return null;
}

export type NpsMatch = {
  campground: NpsCampground;
  distanceM: number;
  nameScore: number;
  sub: boolean;
  /** A photo (non-map) image from the matched campground, or null if it has none. */
  image: z.infer<typeof NpsImage> | null;
};

/** Nearest NPS campground within 5km for a place, with a photo image picked. */
export function matchNps(
  placeName: string,
  lng: number,
  lat: number,
  campgrounds: NpsCampground[],
): NpsMatch | null {
  let best: NpsMatch | null = null;
  for (const cg of campgrounds) {
    const distanceM = haversineMeters([lng, lat], [cg.lng, cg.lat]);
    if (distanceM > 5000) continue;
    const nameScore = tokenOverlap(placeName, cg.name);
    const sub = !weakPlaceName(placeName) && substringMatch(placeName, cg.name);
    if (!best || distanceM < best.distanceM) {
      best = { campground: cg, distanceM, nameScore, sub, image: pickPhoto(cg.images) };
    }
  }
  return best;
}
