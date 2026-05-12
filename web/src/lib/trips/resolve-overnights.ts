import type { Trip } from "./types";
import { bboxFromCoords, discover } from "@/lib/discovery/discovery";
import { overpassSource } from "@/lib/discovery/overpass";
import { recGovSource } from "@/lib/discovery/rec-gov";
import { foursquareSource } from "@/lib/discovery/foursquare";
import { usfsSource } from "@/lib/discovery/usfs";
import { blmSource } from "@/lib/discovery/blm";
import type { BrowsePlace } from "@/lib/trip-browse/places";

/**
 * Server-side pass that tries to match each day's `overnight.selected`
 * to a real record in our discovery sources (USFS / Recreation.gov /
 * Foursquare / OSM). When found, fills `overnight.selected.enriched`
 * so the synthesized camping waypoint's slide-up can render real
 * description / photo / website / phone instead of just trip-plan text.
 *
 * Run once at trip-load; the result is cached in `getAlaskaTrip()`.
 *
 * Search radius is wide (50 km) because dispersed and BLM/NF sites
 * frequently sit between named towns — narrower bboxes miss them.
 *
 * Fuzzy match: normalised string equality on first significant word
 * of the overnight name vs. discovery title. Avoids over-matching on
 * common words ("Campground", "RV", etc.) by considering only the
 * proper-noun head. Falls back to substring match.
 */
const RADIUS_KM = 50;

export async function resolveOvernights(trip: Trip): Promise<Trip> {
  const days = await Promise.all(
    trip.days.map(async (day) => {
      const sel = day.overnight?.selected;
      if (!sel || !day.coords) return day;
      // Re-resolution skip — already enriched (caller hit cache?).
      if (sel.enriched) return day;

      try {
        const places = await discover({
          bboxes: [bboxFromCoords(day.coords, RADIUS_KM)],
          categories: ["camping", "overnight"],
          sources: [overpassSource, recGovSource, usfsSource, blmSource, foursquareSource],
        });
        const match = bestMatch(sel.name, places);
        if (!match) return day;
        return {
          ...day,
          overnight: {
            ...day.overnight!,
            selected: {
              ...sel,
              enriched: {
                description: match.description || undefined,
                photoUrl: match.photoUrl,
                address: match.placeInfo.address || undefined,
                phone: match.placeInfo.phone?.display,
                website: match.placeInfo.website?.display,
                coords: match.coords,
                sources: match.mention.secondary
                  .split(" · ")
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            },
          },
        };
      } catch {
        return day;
      }
    }),
  );
  return { ...trip, days };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "campground",
  "camp",
  "ground",
  "rv",
  "park",
  "site",
  "sites",
  "the",
  "a",
  "of",
  "and",
  "dispersed",
  "lodge",
  "cabin",
]);

function headWord(s: string): string {
  const tokens = normalize(s)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return tokens[0] ?? "";
}

function bestMatch(name: string, places: BrowsePlace[]): BrowsePlace | null {
  const head = headWord(name);
  const normName = normalize(name);
  if (!head) return null;

  // Pass 1: head-word equals head-word of a candidate title
  const headHit = places.find((p) => headWord(p.title) === head);
  if (headHit) return headHit;

  // Pass 2: full-name substring of candidate title (or vice versa)
  const subHit = places.find((p) => {
    const t = normalize(p.title);
    return t.includes(normName) || normName.includes(t);
  });
  if (subHit) return subHit;

  return null;
}
