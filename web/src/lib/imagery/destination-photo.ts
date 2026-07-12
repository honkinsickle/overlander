import type { SourceResult } from "@/lib/discovery/types";
import { enrichWithMapillary } from "@/lib/discovery/mapillary";
import type { Trip } from "@/lib/trips/types";

/**
 * Best-effort photo URL for a trip destination.
 *
 * Cascade (cheapest + most-likely-to-hit first):
 *
 *   1. Wikipedia REST by label ("Stewart, BC" → "Stewart, British
 *      Columbia" → `originalimage`, else the article's first real media
 *      image). Catches every named town/landmark with an article. Auth-free.
 *   2. Mapillary street-level imagery near `coords`. Used when the label
 *      isn't a Wikipedia article (small unnamed crossroads).
 *
 * Returns `null` if no source produced an image.
 */
export async function destinationPhotoFor(
  label: string,
  coords: [number, number],
): Promise<string | null> {
  // Stage 1 — Wikipedia by label.
  const wiki = await wikipediaPhotoForPlace(label);
  if (wiki) return wiki;

  // Stage 2 — Mapillary nearby street-level.
  const synth: SourceResult = {
    sourceId: "fixture",
    externalId: `dest:${label}`,
    coords,
    category: "scenic",
    title: label,
  };
  try {
    await enrichWithMapillary([synth]);
  } catch {
    // swallow
  }
  return synth.photoUrl ?? null;
}

/**
 * Enrich a generated Trip with real destination photos: each day's hero is
 * a photo of where the day ENDS (parsed from `Day.label` — generated days
 * carry no end coords, but the destination NAME is always in the label),
 * and the trip hero is a photo of the final destination.
 *
 * Label-based Wikipedia/Commons lookup only (permanent, keyless
 * upload.wikimedia.org URLs — safe to persist in the payload). Days that
 * already carry a hero, or whose place has no article image, are left
 * untouched — the Day Detail hero falls back to its own CSS background.
 *
 * Concurrent across days with in-fetch 429 backoff; the generation this
 * runs inside already takes minutes, so the added lookups are negligible.
 */
export async function attachHeroPhotos(trip: Trip): Promise<Trip> {
  const endPlace = (label: string): string =>
    label.split(" — ").pop()?.trim() || label;

  const dayHeroes = await Promise.all(
    trip.days.map((d) =>
      d.heroImage
        ? Promise.resolve<string | null>(d.heroImage)
        : wikipediaPhotoForPlace(endPlace(d.label)),
    ),
  );
  const days = trip.days.map((d, i) =>
    dayHeroes[i] ? { ...d, heroImage: dayHeroes[i] as string } : d,
  );

  const heroImage =
    trip.heroImage ??
    dayHeroes[dayHeroes.length - 1] ??
    (await wikipediaPhotoForPlace(trip.endLocation)) ??
    undefined;

  return { ...trip, days, heroImage };
}

// ── Wikipedia label → photo ────────────────────────────────────────────

const WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
const WIKI_UA = "overlander/1.0 (adam@acwcreative.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve a place label to a photo: try each candidate title's summary
 *  lead image first (cheapest, best), then fall back to the first real
 *  image in each candidate's media list (catches articles with no lead
 *  image). Returns null when nothing usable is found. */
export async function wikipediaPhotoForPlace(
  label: string,
): Promise<string | null> {
  const cands = placeCandidates(label);
  for (const c of cands) {
    const p = await summaryPhoto(c);
    if (p) return p;
  }
  for (const c of cands) {
    const p = await mediaListPhoto(c);
    if (p) return p;
  }
  return null;
}

type WikiSummary = {
  type?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
};
type WikiMediaList = {
  items?: { type?: string; srcset?: { src?: string }[] }[];
};

async function wikiJson<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${WIKI_REST}/${path}`, {
        headers: { Accept: "application/json", "User-Agent": WIKI_UA },
      });
      if (res.status === 429) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await sleep(400);
    }
  }
  return null;
}

async function summaryPhoto(title: string): Promise<string | null> {
  const j = await wikiJson<WikiSummary>(
    `page/summary/${encodeURIComponent(title)}`,
  );
  if (!j || j.type === "disambiguation") return null;
  return j.originalimage?.source ?? j.thumbnail?.source ?? null;
}

async function mediaListPhoto(title: string): Promise<string | null> {
  const j = await wikiJson<WikiMediaList>(
    `page/media-list/${encodeURIComponent(title)}`,
  );
  for (const item of j?.items ?? []) {
    if (item.type !== "image") continue;
    const src = item.srcset?.[0]?.src;
    if (!src) continue;
    // Skip non-photo assets (maps, locators, logos, svg icons).
    if (/\.svg|Commons-logo|OpenStreetMap|_map|locator|Location_/i.test(src)) {
      continue;
    }
    return src.startsWith("//") ? `https:${src}` : src;
  }
  return null;
}

/** Candidate Wikipedia titles for a place label. Expands a trailing
 *  2-letter region code to its full name (US states + Canadian
 *  provinces — Wikipedia articles use full names), and tries each part of
 *  a compound "A / B" label (e.g. "Tatchun Creek / Carmacks, YT" →
 *  "Carmacks, Yukon"). Bare names included as a last resort. */
function placeCandidates(label: string): string[] {
  const m = label.match(/,\s*([A-Za-z]{2})$/);
  const region = m ? m[1] : "";
  const core = label
    .replace(/,\s*[A-Za-z]{2}$/, "")
    .replace(/\s+area$/i, "")
    .trim();
  const parts = core.split("/").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const n of [core, ...parts]) {
    out.push(expandRegion(region ? `${n}, ${region}` : n));
    out.push(n);
  }
  return [...new Set(out)].filter(Boolean);
}

function expandRegion(label: string): string {
  const trimmed = label.trim();
  const m = trimmed.match(/^(.+),\s*([A-Za-z]{2})$/);
  if (!m) return trimmed;
  const full = REGION_CODES[m[2].toUpperCase()];
  return full ? `${m[1].trim()}, ${full}` : trimmed;
}

/** US state + Canadian province two-letter codes → full names. */
const REGION_CODES: Record<string, string> = {
  // US states
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming",
  // Canadian provinces + territories
  BC: "British Columbia", YT: "Yukon", AB: "Alberta", SK: "Saskatchewan",
  MB: "Manitoba", ON: "Ontario", QC: "Quebec", NB: "New Brunswick",
  NS: "Nova Scotia", PE: "Prince Edward Island",
  NL: "Newfoundland and Labrador", NT: "Northwest Territories",
  NU: "Nunavut",
};
