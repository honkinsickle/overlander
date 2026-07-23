/**
 * Federated POI search — Typesense `places` collection.
 *
 * Phase 2 search slice (spec §5). Provides a single `search()` function
 * that returns ranked results combining text relevance, prominence, and
 * (when a geo center is provided) proximity.
 *
 * Uses Typesense's `SearchClient` with the scoped search-only API key
 * exposed via `NEXT_PUBLIC_TYPESENSE_SEARCH_API_KEY` — safe to ship in
 * browser bundles. The key is enforced server-side at provision time to
 * only allow `documents:search` on the `places` collection.
 *
 * Ranking strategy (spec §5.2):
 *   - query_by: canonical_name, alternative_names, description with
 *     descending weights — exact name match dominates.
 *   - sort_by: when a center is given,
 *       _text_match:desc, location(lat,lng):asc, prominence_score:desc
 *     otherwise
 *       _text_match:desc, prominence_score:desc
 *
 * Typesense's geo-sort syntax is `<geopoint_field>(lat,lng):asc` — not
 * the `_geo_distance(field, lat, lng)` shape mentioned in the spec
 * (Typesense gotcha — `_geo_distance` is the post-hoc metadata field
 * Typesense annotates onto hits, not the sort selector).
 *
 * Don't add `any` types. Don't widen the public surface speculatively.
 * Future routing/route-aware ranking belongs in a separate layer.
 */

import { SearchClient } from "typesense";
import type { SearchResponse, SearchResponseHit } from "typesense/lib/Typesense/Documents";

// ──────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────

export interface SearchCenter {
  lat: number;
  lng: number;
}

export interface SearchParams {
  query: string;
  /** Optional geo center for proximity ranking. */
  center?: SearchCenter;
  /** Facet filter on `primary_category`. */
  categories?: string[];
  /** Facet filter on `overlander_tags`. */
  overlanderTags?: string[];
  /** Optional viewport bounding box `[west, south, east, north]` (lng/lat).
   *  When set, results are geo-filtered to inside the box — the corpus half
   *  of the top-level "search this area". */
  bbox?: [number, number, number, number];
  /** Default 20; max 100 per Typesense limits. */
  limit?: number;
}

export interface SearchResult {
  id: string;
  canonical_name: string;
  primary_category: string;
  /**
   * `[lng, lat]` — matches the codebase convention (GeoJSON/Mapbox/Turf),
   * converted from Typesense's internal `[lat, lng]` geopoint format at
   * the boundary so callers don't have to remember the divergence.
   */
  location: [number, number];
  prominence_score: number;
  source_count: number;
  /** Distance from `center` in metres, when `center` was provided. */
  distance_m?: number;
  /** Typesense text-match score (higher is better). */
  text_match_score: number;
  /** Typesense highlight ranges for matched substrings. */
  highlights?: SearchResponseHit<PlaceDocument>["highlights"];
}

// ──────────────────────────────────────────────────────────────────────
// Internal document shape (mirrors data/search/sync-typesense.ts)
// ──────────────────────────────────────────────────────────────────────

interface PlaceDocument {
  id: string;
  canonical_name: string;
  alternative_names?: string[];
  primary_category: string;
  secondary_categories?: string[];
  overlander_tags?: string[];
  description?: string;
  location: [number, number];
  prominence_score: number;
  source_count: number;
  has_water?: boolean;
  has_dump_station?: boolean;
  is_federal?: boolean;
}

// ──────────────────────────────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

let _client: SearchClient | null = null;

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function getClient(): SearchClient {
  if (_client) return _client;
  _client = new SearchClient({
    nodes: [
      {
        host: requireEnv("NEXT_PUBLIC_TYPESENSE_HOST", process.env.NEXT_PUBLIC_TYPESENSE_HOST),
        port: Number(requireEnv("NEXT_PUBLIC_TYPESENSE_PORT", process.env.NEXT_PUBLIC_TYPESENSE_PORT)),
        protocol: requireEnv("NEXT_PUBLIC_TYPESENSE_PROTOCOL", process.env.NEXT_PUBLIC_TYPESENSE_PROTOCOL),
      },
    ],
    apiKey: requireEnv("NEXT_PUBLIC_TYPESENSE_SEARCH_API_KEY", process.env.NEXT_PUBLIC_TYPESENSE_SEARCH_API_KEY),
    connectionTimeoutSeconds: 5,
  });
  return _client;
}

// One shared cluster, one collection per environment (e.g. places_prod /
// places_test) — never share a collection across envs, or a sync from one
// prunes the other's docs. No default: unset → fails loud (Missing required
// env var), which is the bug we're preventing.
let _collection: string | null = null;
function collectionName(): string {
  if (_collection) return _collection;
  _collection = requireEnv(
    "NEXT_PUBLIC_TYPESENSE_COLLECTION",
    process.env.NEXT_PUBLIC_TYPESENSE_COLLECTION,
  );
  return _collection;
}

// ──────────────────────────────────────────────────────────────────────
// Filter construction
// ──────────────────────────────────────────────────────────────────────

/**
 * Typesense filter_by expects e.g. `primary_category:=[campground,fuel]`.
 * Escapes commas in tag values (rare but possible) by surrounding each
 * value in backticks.
 */
function buildFilter(params: SearchParams): string | undefined {
  const clauses: string[] = [];
  if (params.categories && params.categories.length > 0) {
    const list = params.categories.map((c) => `\`${c}\``).join(",");
    clauses.push(`primary_category:=[${list}]`);
  }
  if (params.overlanderTags && params.overlanderTags.length > 0) {
    const list = params.overlanderTags.map((t) => `\`${t}\``).join(",");
    clauses.push(`overlander_tags:=[${list}]`);
  }
  if (params.bbox) {
    // Typesense geo-filter on the `location` geopoint takes a polygon as a
    // flat lat,lng list (min 3 vertices). Express the bbox as its 4 corners
    // (CCW). Note the field stores [lat,lng], so each pair is lat THEN lng.
    const [w, s, e, n] = params.bbox;
    clauses.push(
      `location:(${s}, ${w}, ${s}, ${e}, ${n}, ${e}, ${n}, ${w})`,
    );
  }
  return clauses.length > 0 ? clauses.join(" && ") : undefined;
}

function buildSortBy(center: SearchCenter | undefined): string {
  if (center) {
    return `_text_match:desc,location(${center.lat},${center.lng}):asc,prominence_score:desc`;
  }
  return "_text_match:desc,prominence_score:desc";
}

// ──────────────────────────────────────────────────────────────────────
// Search
// ──────────────────────────────────────────────────────────────────────

export async function search(params: SearchParams): Promise<SearchResult[]> {
  const client = getClient();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const response = (await client
    .collections<PlaceDocument>(collectionName())
    .documents()
    .search(
      {
        q: params.query,
        query_by: "canonical_name,alternative_names,description",
        query_by_weights: "4,3,1",
        sort_by: buildSortBy(params.center),
        filter_by: buildFilter(params),
        per_page: limit,
        // Typesense annotates `geo_distance_meters` on each hit when a
        // geo sort is active. Asking for highlights keeps the response
        // shape consistent across queries.
        highlight_fields: "canonical_name,alternative_names,description",
      },
      // typesense-js@3 SearchOnlyDocuments.search wants the 2nd arg even
      // though it's marked optional in the type (destructure-with-default
      // doesn't pass as undefined-acceptable under strict TS).
      {},
    )) as SearchResponse<PlaceDocument>;

  return (response.hits ?? []).map((hit) => toSearchResult(hit));
}

function toSearchResult(hit: SearchResponseHit<PlaceDocument>): SearchResult {
  const doc = hit.document;
  // Typesense stores `[lat, lng]`; codebase uses `[lng, lat]` everywhere.
  // Swap once at the boundary.
  const [lat, lng] = doc.location;
  const result: SearchResult = {
    id: doc.id,
    canonical_name: doc.canonical_name,
    primary_category: doc.primary_category,
    location: [lng, lat],
    prominence_score: doc.prominence_score,
    source_count: doc.source_count,
    text_match_score: hit.text_match ?? 0,
  };
  const distance = hit.geo_distance_meters?.location;
  if (typeof distance === "number") result.distance_m = distance;
  if (hit.highlights && hit.highlights.length > 0) result.highlights = hit.highlights;
  return result;
}
