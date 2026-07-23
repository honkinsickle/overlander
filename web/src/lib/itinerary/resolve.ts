/**
 * Tier-2 live place resolution (spec §8.3, three-tier grounding).
 *
 * The LLM references pooled places by corpus id and OTHER real places by
 * NAME. This resolves a name → a real Google place_id + coords via
 * `places:searchText` (the same endpoint `googleTextSearchSource` uses).
 *
 * IMPORTANT — this only RESOLVES. It does NOT decide whether the result is
 * trustworthy: `locationBias` is a soft preference, so an ambiguous name can
 * still return a place far off-route (bare "Bear Glacier" resolves to the
 * Alaska one, ~1400 mi from the BC-37A one). The caller MUST verify the
 * returned coords sit on the day's corridor before grounding — that guard is
 * what keeps live resolution navigation-grade.
 *
 * Cost: each call is a Google Text Search (~2.5-3.2¢). A PlaceResolver
 * dedupes by name and caps the number of live calls per generation.
 */

const TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const RESOLVE_FIELD_MASK =
  "places.id,places.displayName,places.location,places.formattedAddress,places.types,places.primaryType";

/**
 * Map Google's `primaryType` to a corpus `primary_category`.
 *
 * TWIN — this is a deliberate byte-for-byte duplicate of `inferCategory` in
 * data/ingestion/sources/google-places.ts (the rich `google` corpus source).
 * The two MUST stay identical so a live-resolved place and an ingested Google
 * place land under the SAME category vocabulary — the one the entity-resolution
 * matcher keys on (data/entity-resolution/matcher.ts CATEGORY_COMPATIBILITY).
 * They are copied, not shared, because web/ must not import from data/ at
 * runtime (CLAUDE.md cross-workspace rule). If you change one arm, change BOTH.
 *
 * Do NOT substitute discovery/google-places.ts `categoryForGoogleTypes` here —
 * it returns the 9 slide buckets (fuel/camping/scenic…), the WRONG vocabulary,
 * which scores 0 in the matcher.
 */
export function inferCategory(primaryType: string | null | undefined): string | null {
  switch (primaryType) {
    case "gas_station":
      return "gas_station";
    case "lodging":
      return "lodging";
    case "restaurant":
      return "restaurant";
    case "car_repair":
      return "car_repair";
    case "supermarket":
    case "convenience_store":
      return "grocery";
    default:
      return primaryType ?? null;
  }
}
// Google's max locationBias circle radius.
const BIAS_RADIUS_M = 50_000;
/** Per-generation ceiling on live resolutions (hard cost cap). */
export const RESOLVE_CAP = 15;

export type ResolvedName = {
  placeId: string;
  displayName: string;
  coords: [number, number];
  /** Corpus primary_category from Google's primaryType (see inferCategory). */
  category: string | null;
};

export type ResolveStatus =
  | { status: "resolved"; place: ResolvedName }
  | { status: "not-found" }
  | { status: "capped" }
  | { status: "no-key" };

/**
 * A per-generation resolver: dedupes repeated names, enforces the cap, and
 * keeps a running count of live calls (for cost reporting).
 */
export class PlaceResolver {
  private cache = new Map<string, ResolveStatus>();
  private liveCalls = 0;
  private cap: number;

  /** `cap` is a runaway guard, not a budget throttle — scale it so it never
   *  clips a legitimate trip (default {@link RESOLVE_CAP}). */
  constructor(cap: number = RESOLVE_CAP) {
    this.cap = cap;
  }

  get callCount(): number {
    return this.liveCalls;
  }

  async resolve(
    name: string,
    biasCoords: [number, number],
  ): Promise<ResolveStatus> {
    const key = name.trim().toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      const r: ResolveStatus = { status: "no-key" };
      this.cache.set(key, r);
      return r;
    }
    if (this.liveCalls >= this.cap) {
      return { status: "capped" }; // not cached — a later dedupe hit is free
    }

    this.liveCalls++;
    let result: ResolveStatus;
    try {
      const res = await fetch(TEXT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": RESOLVE_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: name,
          maxResultCount: 1,
          locationBias: {
            circle: {
              center: { latitude: biasCoords[1], longitude: biasCoords[0] },
              radius: BIAS_RADIUS_M,
            },
          },
        }),
        // Never let one slow lookup stall the whole sequential audit.
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        result = { status: "not-found" };
      } else {
        const json = (await res.json()) as {
          places?: {
            id: string;
            displayName?: { text: string };
            location: { latitude: number; longitude: number };
            primaryType?: string;
          }[];
        };
        const p = json.places?.[0];
        result = p
          ? {
              status: "resolved",
              place: {
                placeId: p.id,
                displayName: p.displayName?.text ?? name,
                coords: [p.location.longitude, p.location.latitude],
                category: inferCategory(p.primaryType),
              },
            }
          : { status: "not-found" };
      }
    } catch {
      result = { status: "not-found" };
    }

    this.cache.set(key, result);
    return result;
  }
}
