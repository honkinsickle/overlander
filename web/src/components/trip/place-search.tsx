"use client";

import { useEffect, useRef, useState } from "react";
import { search } from "@/lib/search";
import { LocationBrowseCard } from "@/components/trip/location-browse-card";
import {
  computeCardStats,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import { SLIDE_TO_PRIMARY_CATEGORY } from "@/lib/trip-browse/federated";
import { slideCategoryToBrowseCategory } from "@/lib/trip-browse/palette";

/**
 * <PlaceSearch> — self-contained federated place search.
 *
 * Designed to drop into the Add-Waypoints panel later UNCHANGED. It owns
 * the full pipeline behind a search box but NOT the box itself:
 *
 *   query (host-owned)  →  debounce  →  Typesense match (lib/search)
 *     →  POST /api/places/hydrate { ids }  →  BrowsePlace[]  →  results grid
 *
 * Typesense is the matcher only (returns master_place IDs + thin fields);
 * the hydrate route projects those IDs into full federated cards rendered
 * with the SHARED LocationBrowseCard, so standalone looks identical to the
 * eventual panel (pills, MVUM corridor, attribution).
 *
 * No trip / day / panel context lives in here. The host owns the input and
 * passes `query` in; `center` is optional proximity ranking; `categoryFilter`
 * is an optional slide-pill facet; `onAdd` reports the chosen master_place id.
 */

export type PlaceSearchProps = {
  /** Current search text. Owned by the host (the input lives there). */
  query: string;
  /** Optional `[lng, lat]` proximity center for ranking. */
  center?: [number, number];
  /** Optional slide-pill facet. Maps to primary_category filter on
   *  Typesense. `null`/absent = no facet (corpus-wide). */
  categoryFilter?: SlideCategoryKey | null;
  /** Explicit primary_category values to filter on (e.g. a Find-Nearby
   *  tile → ["campground","rv_park"]). Takes precedence over
   *  `categoryFilter` when provided. `null`/absent = no facet. */
  primaryCategories?: string[] | null;
  /** Overrides the card's CTA label (default "Add to Day N"). Used by the
   *  top-level search where ADD opens a day picker rather than targeting a
   *  preselected day, so the label reads e.g. "Add to a day". */
  addLabel?: string;
  /** Day the results would be added to — drives each card's "Add to Day N"
   *  label. Defaults to 1 for the standalone host; the panel passes the
   *  real target day. */
  dayNumber?: number;
  /** ISO date of the day being browsed — lets each card show TODAY's
   *  opening hours. Absent on the standalone host (no day context). */
  dayDate?: string;
  /** Reports the master_place id of an added result. */
  onAdd: (id: string) => void;
};

const DEBOUNCE_MS = 200;
const LIMIT = 24;
const CARD_WIDTH = 300;

export function PlaceSearch({
  query,
  center,
  categoryFilter,
  primaryCategories,
  addLabel,
  dayNumber = 1,
  dayDate,
  onAdd,
}: PlaceSearchProps): React.ReactElement {
  const [places, setPlaces] = useState<BrowsePlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // Serialize the deps that change a query so the effect re-runs on any of
  // them. center is stringified so a new array identity each render doesn't
  // refire (the host stubs a stable center today, but be defensive).
  const centerKey = center ? `${center[0]},${center[1]}` : "";
  // Stable key for the primary_category array so a new array identity each
  // render doesn't refire the effect.
  const primaryKey = primaryCategories ? primaryCategories.join(",") : "";

  useEffect(() => {
    const q = query.trim();
    // Empty query: nothing to fetch. Render gates on `hasQuery` below, so
    // no synchronous state reset is needed here (and the in-flight reqId
    // guard already drops any late response).
    if (q.length === 0) return;

    const timer = setTimeout(() => {
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);

      // Explicit primary_category list (Find-Nearby tile) wins; otherwise
      // fall back to the coarse slide-pill → primary_category mapping.
      const facet = primaryCategories
        ? primaryCategories
        : categoryFilter
          ? SLIDE_TO_PRIMARY_CATEGORY[categoryFilter]
          : undefined;

      (async () => {
        // 1. Typesense match → ranked master_place IDs.
        const hits = await search({
          query: q,
          center: center ? { lat: center[1], lng: center[0] } : undefined,
          categories: facet,
          limit: LIMIT,
        });
        if (reqId !== reqIdRef.current) return;
        if (hits.length === 0) {
          setPlaces([]);
          return;
        }
        // 2. Hydrate IDs → full federated cards (order preserved).
        const res = await fetch("/api/places/hydrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: hits.map((h) => h.id) }),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(
            detail?.error ?? `hydrate failed (${res.status})`,
          );
        }
        const { places: hydrated } = (await res.json()) as {
          places: BrowsePlace[];
        };
        if (reqId !== reqIdRef.current) return;
        setPlaces(hydrated);
      })()
        .catch((e: unknown) => {
          if (reqId !== reqIdRef.current) return;
          setError(e instanceof Error ? e.message : "search failed");
          setPlaces([]);
        })
        .finally(() => {
          if (reqId !== reqIdRef.current) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, centerKey, categoryFilter, primaryKey, primaryCategories, center]);

  const hasQuery = query.trim().length > 0;
  // Gate everything on hasQuery: when the input is empty, the stale results
  // (and any error) from a prior query stay in state but are never shown.
  const shownPlaces = hasQuery ? places : [];
  const shownError = hasQuery ? error : null;

  return (
    <div>
      <div
        style={{
          fontFamily: "var(--ff-mono)",
          fontSize: 12,
          color: "var(--text-muted)",
          minHeight: 16,
          marginBottom: 16,
        }}
      >
        {!hasQuery
          ? "type to search"
          : loading
            ? "searching…"
            : shownError
              ? null
              : `${shownPlaces.length} result${shownPlaces.length === 1 ? "" : "s"}`}
      </div>

      {shownError !== null && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            border: "1px solid var(--input-error)",
            borderRadius: 6,
            color: "var(--input-error)",
            fontFamily: "var(--ff-mono)",
            fontSize: 13,
          }}
        >
          {shownError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {shownPlaces.map((place) => {
          const slideKey: SlideCategoryKey = place.category ?? "scenic";
          const ctx: CardCtx = { category: slideKey, dayNumber };
          const stats = computeCardStats(place, ctx);
          return (
            <LocationBrowseCard
              key={place.id}
              place={place}
              category={slideCategoryToBrowseCategory(slideKey)}
              dayNumber={dayNumber}
              dayDate={dayDate}
              addLabel={addLabel}
              width={CARD_WIDTH}
              stats={stats}
              // Corpus-wide hits have no real corridor detour — omit the
              // "Adds <time>" row rather than show a fabricated estimate.
              showDetour={false}
              onAdd={(e) => {
                e?.stopPropagation();
                onAdd(place.id.replace(/^mp:/, ""));
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
