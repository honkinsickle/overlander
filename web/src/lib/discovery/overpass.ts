import type { SlideCategoryKey } from "@/lib/trip-browse/places";
import type { SourceResult, WaypointSource } from "./types";
import { OSM_TAG_QUERIES, categoryFromTags } from "./overpass-tags";
import { enrichWithMapillary } from "./mapillary";
import { enrichWithWikipedia } from "./wikipedia";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** Cap per query so a tag-rich bbox can't return ten thousand nodes
 *  and freeze the panel. Sites already get filtered down by the
 *  named-only filters in `OSM_TAG_QUERIES`. */
const MAX_RESULTS = 60;

type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassNode[];
};

export const overpassSource: WaypointSource = {
  id: "osm",
  async query({ bbox, categories, signal }) {
    const filters = categories.flatMap((c) => OSM_TAG_QUERIES[c] ?? []);
    if (filters.length === 0) return [];

    const [w, s, e, n] = bbox;
    const bboxArg = `${s},${w},${n},${e}`;
    const ql =
      `[out:json][timeout:30];(` +
      filters.map((f) => `${f}(${bboxArg});`).join("") +
      `);out body ${MAX_RESULTS};`;

    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      // Overpass needs the form-url-encoded content type to read `data`
      // as a form param. Without this header `fetch` sends text/plain
      // and the body is silently ignored — empty results, no error.
      // It also rejects requests without a descriptive user agent (HTTP
      // 406) — undici's default lands in that bucket.
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "overlander-web/0.1 (+adam@acwcreative.com)",
      },
      body: `data=${encodeURIComponent(ql)}`,
      signal,
    });
    if (!res.ok) {
      console.warn(`[overpass] HTTP ${res.status} for query`, ql.slice(0, 120));
      return [];
    }
    const json = (await res.json()) as OverpassResponse;
    const elements = json.elements ?? [];
    const wanted = new Set(categories);
    const results = elements.flatMap((el) =>
      elementToSourceResult(el, wanted),
    );
    await enrichWithWikidata(results, signal);
    // Wikipedia summary thumbnails by name (geosearch-matched) — much
    // higher hit rate on rural features that have an article but no
    // Wikidata P18 claim.
    await enrichWithWikipedia(results, signal);
    // Mapillary fills in street-level imagery for the remaining gaps,
    // mostly roadside places without Wikipedia articles. Skipped
    // silently when MAPILLARY_TOKEN isn't set.
    await enrichWithMapillary(results, signal);
    return results;
  },
};

/** For OSM nodes that carry a `wikidata=Q...` tag, fetch the Wikidata
 *  entity and pull its image (P18) — yields a Wikimedia Commons URL we
 *  can use as the slide hero. Free, no auth, batchable up to 50 ids
 *  per call. Hit rate is uneven (most OSM nodes lack wikidata tags),
 *  but famous places are usually linked. */
const WIKIDATA_BATCH_SIZE = 50;
async function enrichWithWikidata(
  results: SourceResult[],
  signal?: AbortSignal,
): Promise<void> {
  const ids = new Set<string>();
  for (const r of results) {
    const wd = (r.raw as { wikidata?: unknown } | undefined)?.wikidata;
    if (typeof wd === "string" && /^Q\d+$/.test(wd)) ids.add(wd);
  }
  if (ids.size === 0) return;
  const photos = new Map<string, string>();
  const all = Array.from(ids);
  for (let i = 0; i < all.length; i += WIKIDATA_BATCH_SIZE) {
    const chunk = all.slice(i, i + WIKIDATA_BATCH_SIZE);
    const url =
      `https://www.wikidata.org/w/api.php?action=wbgetentities` +
      `&ids=${chunk.join("|")}&props=claims&format=json&origin=*`;
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "overlander-web/0.1 (+adam@acwcreative.com)" },
        signal,
      });
      if (!res.ok) {
        console.warn(`[wikidata] HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        entities?: Record<
          string,
          { claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> } }
        >;
      };
      for (const [id, ent] of Object.entries(json.entities ?? {})) {
        const filename = ent.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        if (typeof filename === "string") {
          // Special:FilePath redirects to the active CDN URL for the
          // file, with width-resizing as a query param. No need to
          // compute the MD5-based file path manually.
          photos.set(
            id,
            `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`,
          );
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      console.warn("[wikidata] fetch failed:", err);
    }
  }
  for (const r of results) {
    const wd = (r.raw as { wikidata?: unknown } | undefined)?.wikidata;
    if (typeof wd === "string" && photos.has(wd)) {
      r.photoUrl = photos.get(wd);
    }
  }
}

function elementToSourceResult(
  el: OverpassNode,
  wanted: Set<SlideCategoryKey>,
): SourceResult[] {
  const tags = el.tags;
  const title = tags?.name?.trim();
  if (!title) return []; // we only surface named places — no anonymous nodes
  const category = categoryFromTags(tags);
  if (!category) return [];
  // A node can match a query filter for one category yet derive to a
  // different one — e.g. an RV park tagged `tourism=caravan_site` AND
  // `leisure=park` matches the scenic query but categoryFromTags
  // (which checks camping first) puts it in camping. Drop those so
  // each panel only shows what it asked for.
  if (!wanted.has(category)) return [];

  const result: SourceResult = {
    sourceId: "osm",
    externalId: `node/${el.id}`,
    coords: [el.lon, el.lat],
    category,
    title,
    description: tags?.description,
    address: composeAddress(tags),
    website: tags?.website,
    phone: tags?.phone,
    openingHours: tags?.opening_hours,
    raw: tags as Record<string, unknown>,
  };
  return [result];
}

function composeAddress(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  const parts = [
    [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" "),
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}
