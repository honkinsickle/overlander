import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceId, SourceResult } from "./types";

const SOURCE_LABEL: Record<SourceId, string> = {
  osm: "OpenStreetMap",
  nps: "NPS",
  "rec-gov": "Recreation.gov",
  ioverlander: "iOverlander",
  wikipedia: "Wikipedia",
  foursquare: "Foursquare",
  usfs: "USFS",
  blm: "BLM",
  fixture: "Editorial",
};

const PILLS_BY_CATEGORY: Record<SlideCategoryKey, BrowsePlace["pills"]> = {
  scenic: [{ label: "Scenic" }, { label: "Photo Spot" }],
  food: [{ label: "Casual" }, { label: "Local Favorite" }],
  oddity: [{ label: "Roadside" }, { label: "Quirky" }],
  camping: [{ label: "Tent sites" }],
  overnight: [{ label: "Hotel" }],
  fuel: [{ label: "Fuel" }],
};

/** Build a `BrowsePlace` from one or more source results that have
 *  already been deduped to the same physical place. The first result
 *  is treated as canonical for title/coords/description; later ones
 *  contribute to `mention.secondary` (the "Compiled from …" line) and
 *  fill in fields the canonical one is missing. */
export function toBrowsePlace(results: SourceResult[]): BrowsePlace {
  if (results.length === 0) {
    throw new Error("toBrowsePlace called with empty results");
  }
  const head = results[0];
  const merged: SourceResult = results.slice(1).reduce(
    (acc, r) => ({
      ...acc,
      description: acc.description ?? r.description,
      photoUrl: acc.photoUrl ?? r.photoUrl,
      address: acc.address ?? r.address,
      website: acc.website ?? r.website,
      phone: acc.phone ?? r.phone,
      openingHours: acc.openingHours ?? r.openingHours,
    }),
    head,
  );

  const sourceLabels = Array.from(
    new Set(results.map((r) => SOURCE_LABEL[r.sourceId])),
  );

  const stats: BrowsePlace["stats"] = [];
  if (merged.openingHours) {
    stats.push({ label: "HOURS", value: merged.openingHours });
  }

  return {
    id: head.externalId,
    coords: head.coords,
    category: head.category,
    photoUrl: merged.photoUrl,
    photoAlt: merged.title,
    title: merged.title,
    pills: PILLS_BY_CATEGORY[head.category],
    stats,
    mention: {
      primary: results.length > 1 ? "Cross-referenced from" : "Sourced from",
      secondary: sourceLabels.join(" · "),
    },
    // Real OSM/RIDB descriptions when present; otherwise fall back to a
    // neutral one-liner instead of the apologetic "no editorial..."
    // copy. The CategoryPlanningSlide always renders something here.
    description:
      merged.description ??
      `${merged.title} — ${head.category} · ${sourceLabels.join(", ")}.`,
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: {
      address: merged.address ?? "",
      ...(merged.phone
        ? { phone: { display: merged.phone, href: `tel:${merged.phone}` } }
        : {}),
      ...(merged.website
        ? {
            website: {
              display: merged.website.replace(/^https?:\/\//, ""),
              href: merged.website,
            },
          }
        : {}),
    },
    cta: "Add to day",
  };
}
