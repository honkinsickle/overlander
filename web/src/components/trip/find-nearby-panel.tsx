"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BedDouble,
  Coffee,
  Droplet,
  Footprints,
  Fuel,
  Mountain,
  ShoppingCart,
  ShowerHead,
  Tent,
  Trash2,
  Triangle,
  UtensilsCrossed,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Trip, Day } from "@/lib/trips/types";
import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";
import { LocationBrowseCard } from "@/components/trip/location-browse-card";
import {
  browsePlaceToWaypoint,
  computeCardStats,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import {
  slideCategoryToBrowseCategory,
  type BrowseCardCategory,
} from "@/lib/trip-browse/palette";
import { CategoryFilterRow } from "@/components/trip/category-filter-row";
import { pointToPolylineMi } from "@/lib/routing/point-to-polyline";

/**
 * Find Nearby — the top-level "Search for anything" surface, shown when no
 * day panel is open (Search Active slideup state, Paper frame 5WK-0).
 *
 * RICH "search this area": the top-bar text query and the category tiles both
 * hit GET /api/search-area bounded to the CURRENT MAP VIEWPORT (read at query
 * time via `getViewportBbox`). That route merges the same live Google +
 * federated corpus pipeline the in-panel slide browse uses, so results render
 * through the identical LocationBrowseCard (photos / ratings / hours where the
 * source has them; honest-absent otherwise).
 *
 * States:
 *   - empty query AND no active tile → tile palette (launcher / zero-state)
 *   - typed query OR active tile      → viewport-bounded results
 *
 * ADD has no preselected day, so it opens a route-proximity-sorted day picker
 * and adds via the existing `trip:toggleAdded` mechanism. The full BrowsePlace
 * is already in hand from /api/search-area — no re-hydrate needed.
 *
 * The in-panel slide browse (CategoryBrowsePanel) is a separate, day-scoped
 * surface and stays untouched.
 */

type Tile = {
  id: string;
  label: string;
  icon: LucideIcon;
  isNew?: boolean;
  /** Corpus `primary_category` values this tile filters on. */
  primaryCategories: string[];
};

type Bucket = {
  id: string;
  label: string;
  color: string;
  tiles: Tile[];
};

// Tile → corpus primary_category mapping. Values verified against the live
// Typesense `primary_category` facet; only categories that exist in the
// corpus are listed. Sparse ones (coffee, auto/repair, dispersed) honestly
// return few/no hits rather than borrowing from unrelated types.
const BUCKETS: Bucket[] = [
  {
    id: "camp-explore",
    label: "CAMP & EXPLORE",
    color: "#4D9A6E",
    tiles: [
      {
        id: "dispersed",
        label: "Dispersed",
        icon: Triangle,
        isNew: true,
        primaryCategories: ["dispersed_camping"],
      },
      {
        id: "campgrounds",
        label: "Campgrounds",
        icon: Tent,
        isNew: true,
        // Mirrors the broad "camping" chip set (BROAD_PRIMARY_BY_CATEGORY.camping)
        // together with the Dispersed tile: dispersed_camping (Dispersed) +
        // campground/rv_park/camping_cabin/recreation_area (here).
        primaryCategories: [
          "campground",
          "rv_park",
          "camping_cabin",
          "recreation_area",
        ],
      },
      {
        id: "trailheads",
        label: "Trailheads",
        icon: Footprints,
        isNew: true,
        primaryCategories: ["trailhead", "hiking_area"],
      },
      {
        id: "viewpoints",
        label: "Viewpoints",
        icon: Mountain,
        isNew: true,
        primaryCategories: ["viewpoint", "peak", "mountain_peak", "scenic_spot"],
      },
    ],
  },
  {
    id: "fuel-repair",
    label: "FUEL & REPAIR",
    color: "var(--cat-mountain)",
    tiles: [
      {
        id: "gas",
        label: "Gas",
        icon: Fuel,
        primaryCategories: ["gas_station", "truck_stop", "ev_charging"],
      },
      {
        id: "auto-repair",
        label: "Auto / Repair",
        icon: Wrench,
        isNew: true,
        primaryCategories: ["car_repair", "car_wash"],
      },
    ],
  },
  {
    id: "food",
    label: "FOOD",
    color: "var(--cat-food)",
    tiles: [
      {
        id: "coffee",
        label: "Coffee",
        icon: Coffee,
        primaryCategories: ["cafe"],
      },
      {
        id: "restaurants",
        label: "Restaurants",
        icon: UtensilsCrossed,
        primaryCategories: [
          "restaurant",
          "fast_food_restaurant",
          "diner",
          "american_restaurant",
          "italian_restaurant",
          "mexican_restaurant",
          "chinese_restaurant",
          "indian_restaurant",
          "french_restaurant",
          "brazilian_restaurant",
          "taco_restaurant",
          "pizza_restaurant",
          "hamburger_restaurant",
          "chicken_restaurant",
          "breakfast_restaurant",
          "family_restaurant",
          "fine_dining_restaurant",
          "steak_house",
          "sandwich_shop",
          "bar_and_grill",
          "gastropub",
          "brewpub",
        ],
      },
    ],
  },
  {
    id: "supply",
    label: "SUPPLY",
    color: "var(--cat-attraction)",
    tiles: [
      {
        id: "groceries",
        label: "Groceries",
        icon: ShoppingCart,
        primaryCategories: ["grocery", "grocery_store"],
      },
      {
        id: "water-fill",
        label: "Water fill",
        icon: Droplet,
        isNew: true,
        primaryCategories: ["water"],
      },
    ],
  },
  {
    id: "service",
    label: "SERVICE",
    color: "var(--cat-camping)",
    tiles: [
      {
        id: "showers",
        label: "Showers",
        icon: ShowerHead,
        isNew: true,
        primaryCategories: ["shower"],
      },
      {
        id: "dump-stations",
        label: "Dump stations",
        icon: Trash2,
        isNew: true,
        primaryCategories: ["dump_station"],
      },
    ],
  },
  {
    id: "stay",
    label: "STAY",
    color: "var(--cat-oddity)",
    tiles: [
      {
        id: "hotels",
        label: "Hotels",
        icon: BedDouble,
        primaryCategories: ["hotel", "motel", "resort_hotel"],
      },
    ],
  },
];

/** The 7 broad filter-row categories → the corpus `primary_category` set each
 *  one searches. Lets an icon tap reuse the SAME /api/search-area call the
 *  palette tiles make (via the `primaryCategories` arg). The route maps these
 *  back to a live slide bucket for the Google fanout; `urban` has no data
 *  backing (empty), matching the Add-Waypoints panel where urban drops out. */
const BROAD_PRIMARY_BY_CATEGORY: Record<BrowseCardCategory, string[]> = {
  camping: [
    "dispersed_camping",
    "campground",
    "rv_park",
    "camping_cabin",
    "recreation_area",
  ],
  urban: [],
  scenic: ["viewpoint", "peak", "mountain_peak", "scenic_spot", "trailhead", "hiking_area"],
  food: ["restaurant", "cafe", "grocery", "grocery_store"],
  fuel: ["gas_station", "truck_stop", "ev_charging"],
  hotel: ["hotel", "motel", "resort_hotel"],
  oddity: ["museum", "art_gallery", "historical_landmark"],
};

export function FindNearbyPanel({
  trip,
  getViewportBbox,
}: {
  trip: Trip;
  /** Reads the live map viewport bbox [W,S,E,N] at query time, so a search
   *  is bounded to "this area". Null until the map has emitted bounds. */
  getViewportBbox: () => [number, number, number, number] | null;
  /** Reserved — panel dismissal is owned by the parent (Escape + the Top
   *  Bar's exit ✕). */
  onClose?: () => void;
}) {
  // Query mirrors the top-bar "Search for anything" input via `trip:search`.
  const [query, setQuery] = useState("");
  const [activeTile, setActiveTile] = useState<Tile | null>(null);
  // Active broad-category chip from the inline filter row (single-select).
  // Supersedes an active palette tile; cleared when free-text takes over.
  const [activeIcon, setActiveIcon] = useState<BrowseCardCategory | null>(null);
  // The day used for "today's hours" on cards + the day-picker proximity
  // seed. From the URL (?day=), falling back to the first day. Search is
  // bounded by viewport, not by day.
  const [activeDayId, setActiveDayId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("day");
      if (fromUrl) return fromUrl;
    }
    return trip.days[0]?.id ?? "";
  });
  // When set, the day-picker overlay is open for this place.
  const [pending, setPending] = useState<BrowsePlace | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  // Bumped when the user presses Enter in the search box — forces a refetch
  // against the current viewport even when the query/tile is unchanged.
  const [submitNonce, setSubmitNonce] = useState(0);
  // Bumped on map moveEnd (only while results are showing) — refreshes the
  // active query against the new viewport as the user pans/zooms.
  const [moveNonce, setMoveNonce] = useState(0);

  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent<{ query: string }>).detail?.query ?? "";
      setQuery(q);
      // Free-text supersedes a category selection. (Empty query, e.g. from
      // clearSearch, leaves an active chip/tile alone.)
      if (q.trim() !== "") {
        setActiveTile(null);
        setActiveIcon(null);
      }
    };
    window.addEventListener("trip:search", onSearch);
    return () => window.removeEventListener("trip:search", onSearch);
  }, []);

  useEffect(() => {
    const onSubmit = () => setSubmitNonce((n) => n + 1);
    window.addEventListener("trip:searchSubmit", onSubmit);
    return () => window.removeEventListener("trip:searchSubmit", onSubmit);
  }, []);

  useEffect(() => {
    const onActiveDay = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setActiveDayId(id);
    };
    window.addEventListener("trip:activeDay", onActiveDay);
    return () => window.removeEventListener("trip:activeDay", onActiveDay);
  }, []);

  const activeDay = useMemo(
    () => trip.days.find((d) => d.id === activeDayId) ?? trip.days[0],
    [trip.days, activeDayId],
  );

  const showResults =
    query.trim() !== "" || activeTile !== null || activeIcon !== null;

  // Refresh on map move ONLY while results are showing (never the idle
  // palette). A ref keeps the window listener current without re-subscribing.
  const showResultsRef = useRef(showResults);
  useEffect(() => {
    showResultsRef.current = showResults;
  }, [showResults]);
  useEffect(() => {
    const onMoved = () => {
      if (showResultsRef.current) setMoveNonce((n) => n + 1);
    };
    window.addEventListener("trip:viewportMoved", onMoved);
    return () => window.removeEventListener("trip:viewportMoved", onMoved);
  }, []);

  const backToPalette = () => {
    setActiveTile(null);
    setActiveIcon(null);
    // Clears the top-bar text too so query + tile reset together.
    window.dispatchEvent(new CustomEvent("trip:clearSearch"));
  };

  // Inline category switch (filter row). Single-select: tap to switch, tap the
  // active one again to clear back to the palette. Clears the text query and
  // any palette tile so the chip drives the search.
  const handleIconToggle = (c: BrowseCardCategory) => {
    setActiveIcon((prev) => (prev === c ? null : c));
    setActiveTile(null);
    window.dispatchEvent(new CustomEvent("trip:clearSearch"));
  };

  // What the results fetch filters on: the active chip wins, else the palette
  // tile, else none (free-text path).
  const resultPrimaryCategories: string[] | null = activeIcon
    ? BROAD_PRIMARY_BY_CATEGORY[activeIcon]
    : (activeTile?.primaryCategories ?? null);

  // ADD with no preselected day → open the day picker. The full BrowsePlace
  // is already in hand from /api/search-area (live or federated), so no
  // re-hydrate is needed.
  const handleAdd = (place: BrowsePlace) => {
    setPending(place);
  };

  const addToDay = (day: Day) => {
    if (!pending) return;
    const place = pending;
    // Paint the confirmation + close the picker first, then dispatch the
    // add on the next tick. The add triggers an RSC refresh (revalidatePath
    // in addWaypointAction) that would otherwise race the toast render.
    setConfirmation(`Added to Day ${day.dayNumber}`);
    setPending(null);
    window.setTimeout(() => setConfirmation(null), 2600);
    // Reuse the existing add-to-day mechanism, parameterized by the chosen
    // day (DayDetail listens for trip:toggleAdded → addWaypointAction).
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("trip:toggleAdded", {
          detail: {
            placeId: place.id,
            dayId: day.id,
            dayNumber: day.dayNumber,
            place: {
              id: place.id,
              title: place.title,
              description: place.description,
              photoUrl: place.photoUrl,
              coords: place.coords,
            },
          },
        }),
      );
    }, 0);
  };

  return (
    <div
      role="region"
      aria-label="Find nearby"
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-panel)" }}
    >
      <FindScopeHeader />

      {pending ? (
        <DayPicker
          place={pending}
          trip={trip}
          onPick={addToDay}
          onCancel={() => setPending(null)}
        />
      ) : showResults ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Inline category switcher — same icon row as the Add-Waypoints
           *  panel. Tap to switch category in the current viewport without
           *  returning to the palette. */}
          <CategoryFilterRow
            active={activeIcon ? new Set([activeIcon]) : new Set()}
            onToggle={handleIconToggle}
          />
          <button
            type="button"
            onClick={backToPalette}
            className="flex items-center shrink-0"
            style={{
              gap: 8,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 4,
              paddingBottom: 12,
              fontFamily: "var(--ff-display)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--amber)",
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
            {activeTile ? `Categories · ${activeTile.label}` : "Categories"}
          </button>
          <div
            className="flex-1 overflow-y-auto no-scrollbar"
            style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 24 }}
          >
            <SearchAreaResults
              query={query}
              primaryCategories={resultPrimaryCategories}
              getViewportBbox={getViewportBbox}
              submitNonce={submitNonce}
              moveNonce={moveNonce}
              dayNumber={activeDay?.dayNumber ?? 1}
              dayDate={activeDay?.date}
              dayId={activeDay?.id}
              dayLabel={activeDay?.label}
              dayCoords={activeDay?.coords}
              dayStartCoords={
                activeDay?.startCoord ??
                (activeDay?.dayNumber === 1 ? trip.startCoords : undefined)
              }
              onAdd={handleAdd}
            />
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto no-scrollbar"
          style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 24 }}
        >
          {BUCKETS.map((bucket) => (
            <BucketSection
              key={bucket.id}
              bucket={bucket}
              onPick={setActiveTile}
            />
          ))}
        </div>
      )}

      {confirmation ? (
        <div
          role="status"
          className="shrink-0 flex items-center justify-center"
          style={{
            margin: 12,
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "rgba(77,154,110,0.18)",
            border: "1px solid #4D9A6E",
            color: "#9CD4B0",
            fontFamily: "var(--ff-display)",
            fontSize: 13,
            letterSpacing: "0.04em",
          }}
        >
          {confirmation}
        </div>
      ) : null}
    </div>
  );
}

const CARD_WIDTH = 300;
const DEBOUNCE_MS = 200;

/** Fetches the merged live + federated result set from /api/search-area,
 *  bounded to the current viewport bbox (read at fetch time), and renders it
 *  through the shared LocationBrowseCard — identical to the in-panel slide
 *  browse cards. Free-text query takes precedence over an active tile. */
function SearchAreaResults({
  query,
  primaryCategories,
  getViewportBbox,
  submitNonce,
  moveNonce,
  dayNumber,
  dayDate,
  dayId,
  dayLabel,
  dayCoords,
  dayStartCoords,
  onAdd,
}: {
  query: string;
  primaryCategories: string[] | null;
  getViewportBbox: () => [number, number, number, number] | null;
  /** Incremented on Enter — forces a refetch against the current viewport
   *  even when query/tile is unchanged (re-search after a map pan). */
  submitNonce: number;
  /** Incremented on map moveEnd while results show — refetches against the
   *  new viewport, keeping the active query/category. */
  moveNonce: number;
  dayNumber: number;
  dayDate?: string;
  /** Active day context — drives the detour ("Adds ~Xm" vs this day's route)
   *  and the DETAILS overlay, mirroring the in-panel slide browse. The active
   *  day is the proximity reference; ADD still lets you pick the real day. */
  dayId?: string;
  dayLabel?: string;
  dayCoords?: [number, number];
  dayStartCoords?: [number, number];
  onAdd: (place: BrowsePlace) => void;
}) {
  const [places, setPlaces] = useState<BrowsePlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);
  // The result currently linked from the map (marker tap) or tapped in the
  // list — gets the active-POI ring-glow.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const primaryKey = primaryCategories ? primaryCategories.join(",") : "";
  const hasInput = q.length > 0 || primaryKey.length > 0;

  useEffect(() => {
    if (!hasInput) return;

    const timer = setTimeout(() => {
      const bbox = getViewportBbox();
      const reqId = ++reqIdRef.current;
      setLoading(true);
      setError(null);

      // Free-text wins; otherwise the tile's corpus primary_category set.
      const params = new URLSearchParams();
      if (!bbox) {
        setError("Map isn't ready yet — pan the map, then search.");
        setLoading(false);
        return;
      }
      params.set("bbox", bbox.join(","));
      if (q.length > 0) params.set("q", q);
      else params.set("categories", primaryKey);

      (async () => {
        const res = await fetch(`/api/search-area?${params.toString()}`);
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(detail?.error ?? `search failed (${res.status})`);
        }
        const { places: found } = (await res.json()) as {
          places: BrowsePlace[];
        };
        if (reqId !== reqIdRef.current) return;
        setPlaces(found);
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
    // getViewportBbox is a stable getter; bbox is read at fetch time.
    // submitNonce (Enter) and moveNonce (map move) both re-run the fetch
    // against the current viewport, keeping the active query/category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, primaryKey, hasInput, submitNonce, moveNonce]);

  const shownPlaces = hasInput ? places : [];
  const shownError = hasInput ? error : null;

  // Plot the visible results on the map by reusing the in-day browse marker
  // layer: trip:browseResults → MapColumn renders one 22px category-colored
  // dot per place (no camera move). Re-emits whenever the result set changes
  // (pan / category switch / new query) so markers stay in sync with the
  // cards. `places`/`hasInput` are stable refs, so this doesn't fire per
  // render. An empty set (0 results) clears the dots.
  useEffect(() => {
    const visible = hasInput ? places : [];
    window.dispatchEvent(
      new CustomEvent("trip:browseResults", {
        detail: {
          category: null,
          // Area-search markers link to their card on click (no fly).
          interact: "link",
          places: visible.map((p) => ({
            coords: p.coords,
            title: p.title,
            id: p.id,
            category: p.category,
          })),
        },
      }),
    );
  }, [places, hasInput]);

  // Clear the result markers when the results view goes away (back to the idle
  // palette, or the panel closes) — MapColumn restores the trip-day pins.
  useEffect(() => {
    return () => {
      window.dispatchEvent(
        new CustomEvent("trip:browseResults", {
          detail: { category: null, places: [] },
        }),
      );
    };
  }, []);

  // Marker → card: a result-marker tap highlights its card and scrolls it into
  // view. No camera move, no re-query — just the link.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setFocusedId(id);
      const el = gridRef.current?.querySelector(`[data-place-id="${id}"]`);
      if (el) {
        (el as HTMLElement).scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    };
    window.addEventListener("trip:areaResultFocus", onFocus);
    return () => window.removeEventListener("trip:areaResultFocus", onFocus);
  }, []);

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
        {!hasInput
          ? "type to search"
          : loading
            ? "searching this area…"
            : shownError
              ? null
              : `${shownPlaces.length} result${shownPlaces.length === 1 ? "" : "s"} in view`}
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

      <div ref={gridRef} style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {shownPlaces.map((place) => {
          const slideKey: SlideCategoryKey = place.category ?? "scenic";
          const ctx: CardCtx = {
            category: slideKey,
            dayNumber,
            dayDate,
            dayLabel,
            dayCoords,
            dayStartCoords,
          };
          const stats = computeCardStats(place, ctx);
          const synthWaypoint = browsePlaceToWaypoint(place, ctx, stats);
          // Open the shared detail overlay — same dispatch the in-panel
          // slide cards use, so DETAILS behaves identically here.
          const openDetail = () => {
            window.dispatchEvent(
              new CustomEvent("trip:flyTo", {
                detail: { coords: place.coords, name: place.title },
              }),
            );
            window.dispatchEvent(
              new CustomEvent("trip:openDetail", {
                detail: {
                  place: {
                    id: place.id,
                    title: place.title,
                    photoUrl: place.photoUrl,
                    dayNumber,
                    dayId,
                    coords: place.coords,
                    description: place.description,
                    waypoint: synthWaypoint,
                  },
                },
              }),
            );
          };
          const focused = place.id === focusedId;
          return (
            // Card → marker: tapping the card body (not the ADD/DETAILS
            // buttons, which stopPropagation) pulses the matching marker and
            // highlights this card. No camera move.
            <div
              key={place.id}
              data-place-id={place.id}
              onClick={() => {
                setFocusedId(place.id);
                window.dispatchEvent(
                  new CustomEvent("trip:areaCardFocus", {
                    detail: { id: place.id },
                  }),
                );
              }}
              style={{
                borderRadius: 8,
                cursor: "pointer",
                transition: "box-shadow 160ms ease",
                boxShadow: focused
                  ? "0 0 0 2px #c8a96e, 0 0 18px 2px rgba(200,169,110,0.55)"
                  : "none",
              }}
            >
              <LocationBrowseCard
                place={place}
                category={slideCategoryToBrowseCategory(slideKey)}
                dayNumber={dayNumber}
                dayDate={dayDate}
                addLabel="Add to a day"
                width={CARD_WIDTH}
                stats={stats}
                // Area search runs against the active day, not the result's
                // day, so any "Adds <time>" detour would be fabricated —
                // omit it (DETAILS still opens the panel).
                showDetour={false}
                onAdd={(e) => {
                  e?.stopPropagation();
                  onAdd(place);
                }}
                onOpen={(e) => {
                  e?.stopPropagation();
                  openDetail();
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FindScopeHeader() {
  // Scope label: search is bounded to the current map viewport (the visible
  // area), refreshed as the user pans/zooms. Not GPS, not a route leg — the
  // leg concept was dropped here.
  return (
    <div
      className="flex items-center shrink-0"
      style={{
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 18,
        paddingBottom: 14,
        gap: 12,
      }}
    >
      <span
        style={{
          fontFamily: "var(--ff-sans)",
          fontSize: 22,
          lineHeight: "28px",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        Find on:
      </span>
      <span
        role="status"
        aria-label="Scope: Current Location (the visible map area)"
        title="Search is scoped to the current map viewport"
        style={{
          display: "inline-flex",
          alignItems: "center",
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: 14,
          paddingRight: 14,
          borderRadius: 5,
          border: "1.5px solid #4D9A6E",
          backgroundColor: "rgba(77,154,110,0.12)",
          color: "#9CD4B0",
          fontFamily: "var(--ff-sans)",
          fontSize: 16,
          lineHeight: "20px",
          fontWeight: 500,
        }}
      >
        Current Location
      </span>
    </div>
  );
}

function BucketSection({
  bucket,
  onPick,
}: {
  bucket: Bucket;
  onPick: (tile: Tile) => void;
}) {
  return (
    <section style={{ marginTop: 18 }}>
      <div
        className="flex items-center"
        style={{ gap: 8, marginBottom: 10, paddingLeft: 4 }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: bucket.color,
            display: "inline-block",
            boxShadow: `0 0 6px ${bucket.color}55`,
          }}
        />
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
          }}
        >
          {bucket.label}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        {bucket.tiles.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            color={bucket.color}
            onClick={() => onPick(tile)}
          />
        ))}
      </div>
    </section>
  );
}

function TileButton({
  tile,
  color,
  onClick,
}: {
  tile: Tile;
  color: string;
  onClick: () => void;
}) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tile.label}
      className="flex items-center transition-colors hover:bg-white/[0.08]"
      style={{
        height: 44,
        paddingLeft: 8,
        paddingRight: 12,
        gap: 10,
        borderRadius: 8,
        backgroundColor: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden
        className="flex items-center justify-center shrink-0"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      >
        <Icon size={18} strokeWidth={2} style={{ color }} />
      </span>
      <span
        className="truncate"
        style={{
          flex: 1,
          fontFamily: "var(--ff-sans)",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {tile.label}
      </span>
      {tile.isNew && (
        <span
          className="uppercase shrink-0"
          style={{
            fontFamily: "var(--ff-mono)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "var(--amber)",
            backgroundColor: "rgba(200,169,110,0.12)",
            border: "1px solid rgba(200,169,110,0.28)",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          NEW
        </span>
      )}
    </button>
  );
}

/** Day picker for the top-level ADD action. Lists every trip day, sorted by
 *  route proximity to the place so the likely targets float to the top —
 *  essential when the trip spans dozens of days. */
function DayPicker({
  place,
  trip,
  onPick,
  onCancel,
}: {
  place: BrowsePlace;
  trip: Trip;
  onPick: (day: Day) => void;
  onCancel: () => void;
}) {
  const ranked = useMemo(() => {
    return trip.days
      .map((day, i) => {
        const prev = trip.days[i - 1];
        const start: [number, number] | undefined =
          prev?.coords ?? (i === 0 ? trip.startCoords : undefined);
        const end = day.coords;
        const segment: [number, number][] =
          start && end ? [start, end] : end ? [end] : start ? [start] : [];
        const milesOff =
          segment.length > 0
            ? pointToPolylineMi(place.coords, segment)
            : Infinity;
        return { day, milesOff };
      })
      .sort((a, b) => a.milesOff - b.milesOff);
  }, [trip.days, trip.startCoords, place.coords]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex items-center shrink-0"
        style={{
          gap: 10,
          paddingLeft: 20,
          paddingRight: 16,
          paddingBottom: 12,
        }}
      >
        <div className="flex flex-col min-w-0 flex-1">
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 11,
              letterSpacing: "0.16em",
              color: "var(--text-muted)",
            }}
          >
            Add to which day?
          </span>
          <span
            className="truncate"
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {place.title}
          </span>
        </div>
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="flex items-center justify-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)",
            color: "var(--text-muted)",
          }}
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}
      >
        {ranked.map(({ day, milesOff }) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onPick(day)}
            className="flex items-center w-full transition-colors hover:bg-white/[0.06]"
            style={{
              gap: 12,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
              textAlign: "left",
            }}
          >
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: 44,
                height: 36,
                borderRadius: 6,
                backgroundColor: "rgba(255,255,255,0.05)",
                fontFamily: "var(--ff-display)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              D{day.dayNumber}
            </span>
            <span className="flex flex-col min-w-0 flex-1">
              <span
                className="truncate"
                style={{
                  fontFamily: "var(--ff-sans)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {day.label || `Day ${day.dayNumber}`}
              </span>
              <span
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                {formatShortDate(day.date)}
                {Number.isFinite(milesOff)
                  ? ` · ${milesOff < 10 ? milesOff.toFixed(1) : Math.round(milesOff)} mi off route`
                  : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
}

