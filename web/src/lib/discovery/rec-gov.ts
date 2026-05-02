import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";

/**
 * Recreation.gov / RIDB v1 — `/facilities` endpoint covers BLM, NFS,
 * USFS, NPS, and USACE recreation sites. Free API key, register at
 * https://ridb.recreation.gov/ and set RIDB_API_KEY in web/.env.local.
 *
 * The API doesn't accept a bbox — it's point + radius (in miles).
 * We convert each bbox back to its centre + half-diagonal radius.
 */
const RIDB_BASE = "https://ridb.recreation.gov/api/v1";
const KM_PER_MILE = 1.609344;
const MAX_RIDB_RADIUS_MI = 50; // RIDB rejects above this
const MAX_RESULTS = 50;

let warnedMissingKey = false;

type RidbFacility = {
  FacilityID: string;
  FacilityName: string;
  FacilityDescription?: string;
  FacilityTypeDescription?: string;
  FacilityLatitude?: number;
  FacilityLongitude?: number;
  FacilityPhone?: string;
  FacilityAdaAccess?: string;
  Reservable?: boolean;
  FACILITYADDRESS?: Array<{
    AddressType?: string;
    City?: string;
    PostalCode?: string;
    StateCode?: string;
    StreetAddress1?: string;
  }>;
  ORGANIZATION?: Array<{ OrgName?: string; OrgAbbrevName?: string }>;
};

type RidbResponse = { RECDATA?: RidbFacility[] };

/** RIDB facility type → our slide category. Only types we surface. */
function categoryForFacility(typeDesc?: string): SlideCategoryKey | null {
  if (!typeDesc) return null;
  const t = typeDesc.toLowerCase();
  if (t.includes("camp")) return "camping";
  if (t.includes("lodge") || t.includes("cabin")) return "overnight";
  return null;
}

export const recGovSource: WaypointSource = {
  id: "rec-gov",
  async query({ bbox, categories, signal }) {
    const apiKey = process.env.RIDB_API_KEY;
    if (!apiKey) {
      if (!warnedMissingKey) {
        console.warn(
          "[rec-gov] RIDB_API_KEY not set in web/.env.local — skipping " +
            "Recreation.gov source. Get a free key at https://ridb.recreation.gov/",
        );
        warnedMissingKey = true;
      }
      return [];
    }
    // Only worth calling if camping/overnight is requested — RIDB's
    // facility types don't cover food/scenic/oddity.
    if (!categories.some((c) => c === "camping" || c === "overnight")) {
      return [];
    }

    const [w, s, e, n] = bbox;
    const centerLng = (w + e) / 2;
    const centerLat = (s + n) / 2;
    const halfDiagKm = haversineKm([w, s], [centerLng, centerLat]);
    const radiusMi = Math.min(halfDiagKm / KM_PER_MILE, MAX_RIDB_RADIUS_MI);

    const url =
      `${RIDB_BASE}/facilities?` +
      new URLSearchParams({
        latitude: centerLat.toString(),
        longitude: centerLng.toString(),
        radius: radiusMi.toString(),
        limit: MAX_RESULTS.toString(),
      }).toString();

    const res = await fetch(url, { headers: { apikey: apiKey }, signal });
    if (!res.ok) {
      console.warn(`[rec-gov] HTTP ${res.status} for ${url}`);
      return [];
    }
    const json = (await res.json()) as RidbResponse;
    const facilities = json.RECDATA ?? [];
    return facilities.flatMap((f) => facilityToSourceResult(f, categories));
  },
};

function facilityToSourceResult(
  f: RidbFacility,
  wanted: SlideCategoryKey[],
): SourceResult[] {
  const category = categoryForFacility(f.FacilityTypeDescription);
  if (!category || !wanted.includes(category)) return [];
  if (typeof f.FacilityLatitude !== "number" || typeof f.FacilityLongitude !== "number") return [];
  if (!f.FacilityName?.trim()) return [];

  return [
    {
      sourceId: "rec-gov",
      externalId: `ridb/${f.FacilityID}`,
      coords: [f.FacilityLongitude, f.FacilityLatitude],
      category,
      title: f.FacilityName.trim(),
      description: cleanText(f.FacilityDescription),
      address: composeAddress(f.FACILITYADDRESS?.[0]),
      phone: f.FacilityPhone,
      raw: f as unknown as Record<string, unknown>,
    },
  ];
}

function composeAddress(
  a?: NonNullable<RidbFacility["FACILITYADDRESS"]>[number],
): string | undefined {
  if (!a) return undefined;
  return [a.StreetAddress1, a.City, a.StateCode, a.PostalCode]
    .filter(Boolean)
    .join(", ");
}

/** RIDB descriptions sometimes contain stray HTML and HTML entities.
 *  Strip tags and decode the most common entities. */
function cleanText(s?: string): string | undefined {
  if (!s) return undefined;
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}
