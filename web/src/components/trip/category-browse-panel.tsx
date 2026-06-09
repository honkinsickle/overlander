"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { ArrowLeft, ChevronsLeft, ChevronsRight } from "lucide-react";
import { type Category } from "@/components/primitives/detail-card";
import {
  type BrowsePlace,
  type SlideCategoryKey,
  TRIP_CATEGORY_TO_SLIDE,
} from "@/lib/trip-browse/places";
import {
  browsePlaceToWaypoint,
  computeCardStats,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import { LocationBrowseCard } from "@/components/trip/location-browse-card";
import { PlaceSearch } from "@/components/trip/place-search";
import {
  type BrowseCardCategory,
  browseCategoryToSlide,
  slideCategoryToBrowseCategory,
} from "@/lib/trip-browse/palette";
import { CategoryFilterRow } from "@/components/trip/category-filter-row";

export type BrowseTarget = {
  category: Category;
  dayNumber: number;
  /** IDs needed for the live discovery fetch — the API resolves the
   *  day's coords from these to compute its bbox. */
  tripId: string;
  dayId: string;
  /** End-of-day coords passed through from DayDetail so each card can
   *  show a real detour distance and ETA delta. */
  dayCoords?: [number, number];
  /** Start-of-day coords (previous day's overnight, or trip startCoords
   *  for Day 1). Lets cards compute perpendicular detour from the
   *  day-start → day-end polyline rather than haversine to day-end —
   *  matters for places on-route where the place-to-dayEnd distance is
   *  large but the actual detour is tiny. */
  dayStartCoords?: [number, number];
  /** Day label like "Whitefish, MT — Banff, AB" — used to derive the
   *  next-anchor name for the "new ETA at X" line. */
  dayLabel?: string;
  /** ISO date of the day being browsed (Day.date). Lets each card show
   *  TODAY's opening hours (this weekday) instead of the full week. */
  dayDate?: string;
};

// 2-up: 16 + 300 + 16 + 300 + 16 = 648 of content + a few px slack centered.
// 3-up: 8 + 354 + 12 + 354 + 12 + 354 + 8 = 1102 — sits inside the slideup
// body (1113w) with 11px slack so the panel never overhangs the slideup chrome.
const PANEL_WIDTH_2UP = 655;
const PANEL_WIDTH_3UP = 1113;
const CARD_W_3UP = 354;
const TRANSITION_MS = 280;

/** Initial active-filter set: if the panel was opened from a per-category
 *  Browse button (e.g. "Browse Sights"), pre-select that chip so the
 *  user lands on the filtered view they asked for. Empty Set = "All". */
function initialFiltersFor(
  category: Category | undefined,
): Set<BrowseCardCategory> {
  if (!category) return new Set();
  const slideKey = TRIP_CATEGORY_TO_SLIDE[category];
  if (!slideKey) return new Set();
  return new Set([slideCategoryToBrowseCategory(slideKey)]);
}

export function CategoryBrowsePanel({
  target,
  onClose,
}: {
  target: BrowseTarget | null;
  onClose: () => void;
}) {
  const open = target !== null;
  const [expanded, setExpanded] = useState(false);
  const panelWidth = expanded ? PANEL_WIDTH_3UP : PANEL_WIDTH_2UP;

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  // Broadcast open/closed so the slideup body can suppress its standalone
  // Find Nearby panel (the top-bar search drives THIS panel instead) and
  // the top-bar can reset its query when the panel closes.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("trip:browseOpen", { detail: { open } }),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // TODO: replace with a real context menu (Save / Share / Hide / Report).
  useEffect(() => {
    if (!open) return;
    const onMore = (e: Event) => {
      const detail = (e as CustomEvent<{ placeId: string; dayId: string }>)
        .detail;
      console.log("[trip:openMore]", detail);
    };
    window.addEventListener("trip:openMore", onMore);
    return () => window.removeEventListener("trip:openMore", onMore);
  }, [open]);

  useEffect(() => {
    const mapSection = document.querySelector<HTMLElement>(
      'section[aria-label="Map"]',
    );
    if (!mapSection) return;
    mapSection.style.transition = `margin-left ${TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    if (open) {
      const cs = getComputedStyle(mapSection);
      const currentMl = parseFloat(cs.marginLeft) || 0;
      const naturalLeft =
        mapSection.getBoundingClientRect().left - currentMl;
      mapSection.style.marginLeft = `${panelWidth - naturalLeft}px`;
    } else {
      mapSection.style.marginLeft = "";
    }
    return () => {
      mapSection.style.marginLeft = "";
    };
  }, [open, panelWidth]);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-hidden={!open}
      aria-label={target ? `Browse Day ${target.dayNumber}` : undefined}
      className="fixed inset-0 z-40 pointer-events-none"
    >
      <aside
        style={{
          width: panelWidth,
          transform: open ? "translateX(0)" : `translateX(-${panelWidth}px)`,
          transitionProperty: "transform, width",
          transitionDuration: `${TRANSITION_MS}ms`,
          transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
          backgroundColor: "var(--bg-panel)",
          borderRight: "1px solid var(--border-subtle)",
        }}
        className="absolute top-[68px] bottom-0 left-0 flex flex-col shadow-2xl pointer-events-auto"
      >
        <header
          className="flex items-center shrink-0"
          style={{
            height: 68,
            paddingLeft: 20,
            paddingRight: 16,
            gap: 12,
            backgroundColor: "var(--bg-base)",
            borderBottom: "1px solid var(--border-mid)",
          }}
        >
          <div className="flex flex-col min-w-0 flex-1">
            <span
              className="uppercase truncate"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 11,
                lineHeight: "14px",
                fontWeight: 600,
                letterSpacing: "0.18em",
                color: "var(--text-muted)",
              }}
            >
              Browsing today Day {target?.dayNumber ?? ""} within{" "}
              <span style={{ fontWeight: 700, color: "#FFFFFF" }}>
                10 miles
              </span>
              {" "}of route
            </span>
            <span
              className="truncate"
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 18,
                lineHeight: "22px",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {target?.dayLabel ?? ""}
            </span>
          </div>

          <button
            type="button"
            aria-label={expanded ? "Collapse to 2 columns" : "Expand to 3 columns"}
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center shrink-0 w-[60px] h-[60px] bg-bg-card border-l border-border-subtle"
          >
            {expanded ? (
              <ChevronsLeft className="w-[22px] h-[22px] text-text-muted" strokeWidth={1.5} />
            ) : (
              <ChevronsRight className="w-[22px] h-[22px] text-text-muted" strokeWidth={1.5} />
            )}
          </button>

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ marginRight: -12 }}
            className="flex items-center justify-center shrink-0 w-[60px] h-[60px] bg-bg-card border-l border-border-subtle"
          >
            <ArrowLeft className="w-[22px] h-[22px] text-text-muted" strokeWidth={1.5} />
          </button>
        </header>

        {target ? <PanelBody target={target} expanded={expanded} /> : null}
      </aside>
    </div>
  );
}

type FetchState =
  | { status: "loading" }
  | { status: "success"; places: BrowsePlace[]; source: "fixture" | "discovery" }
  | { status: "error"; message: string };

/** Tell MapColumn which places the panel is currently showing so it
 *  can drop a dot per result. Empty `places` clears the layer. */
function emitBrowseResults(places: BrowsePlace[]): void {
  window.dispatchEvent(
    new CustomEvent("trip:browseResults", {
      detail: {
        category: null,
        places: places.map((p) => ({
          coords: p.coords,
          title: p.title,
          id: p.id,
          category: p.category,
        })),
      },
    }),
  );
}

function PanelBody({ target, expanded }: { target: BrowseTarget; expanded: boolean }) {
  const [filters, setFilters] = useState<Set<BrowseCardCategory>>(() =>
    initialFiltersFor(target.category),
  );
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  // Federated corpus-search query, fed by the top-bar via `trip:search`.
  // Empty → category-browse (unchanged). Non-empty → <PlaceSearch>.
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent<{ query: string }>).detail?.query ?? "";
      setQuery(q);
    };
    window.addEventListener("trip:search", onSearch);
    return () => window.removeEventListener("trip:search", onSearch);
  }, []);
  const searching = query.trim().length > 0;

  // Reset filter selection when switching to a different day's Browse.
  useEffect(() => {
    setFilters(initialFiltersFor(target.category));
  }, [target.category, target.dayId]);

  useEffect(() => {
    const onSync = (e: Event) => {
      const ids = (e as CustomEvent<{ addedIds: string[] }>).detail?.addedIds;
      if (Array.isArray(ids)) setAddedIds(new Set(ids));
    };
    window.addEventListener("trip:addedSync", onSync);
    return () => window.removeEventListener("trip:addedSync", onSync);
  }, []);

  // Map markers track whatever's currently visible in the panel.
  // Re-emit once after a short delay so the map catches us even if its
  // listener registers slightly later than the panel mounts.
  useEffect(() => {
    if (state.status !== "success") return;
    emitBrowseResults(state.places);
    const retry = window.setTimeout(() => {
      emitBrowseResults(state.places);
    }, 200);
    return () => {
      window.clearTimeout(retry);
      emitBrowseResults([]);
    };
  }, [state]);

  // Resolve the API `categories=` param from the active filter set:
  // empty filters = "all"; non-empty = comma-joined slideKeys (urban has
  // no data backing, so it drops out — selecting urban alone yields the
  // empty state).
  const apiCategories = useMemo(() => {
    if (filters.size === 0) return "all";
    const slideKeys = Array.from(filters)
      .map(browseCategoryToSlide)
      .filter((k): k is SlideCategoryKey => k !== null);
    return slideKeys.join(",");
  }, [filters]);

  useEffect(() => {
    if (!apiCategories) {
      setState({ status: "success", places: [], source: "discovery" });
      return;
    }
    setState({ status: "loading" });
    const ctrl = new AbortController();
    const url =
      `/api/trip-browse/${encodeURIComponent(target.tripId)}/${encodeURIComponent(target.dayId)}` +
      `?categories=${apiCategories}`;
    fetch(url, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          source: "fixture" | "discovery";
          places: BrowsePlace[];
        }>;
      })
      .then((json) => {
        setState({ status: "success", places: json.places, source: json.source });
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      });
    return () => ctrl.abort();
  }, [target.tripId, target.dayId, apiCategories]);

  const toggleFilter = (c: BrowseCardCategory) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  // <PlaceSearch> facets on a single SlideCategoryKey. The chip row stays
  // multi-select; map it to one facet only when exactly one chip is active
  // (0 or 2+ → corpus-wide, matching the "All" feel).
  const searchFacet = useMemo<SlideCategoryKey | null>(() => {
    if (filters.size !== 1) return null;
    return browseCategoryToSlide(Array.from(filters)[0]);
  }, [filters]);

  // Add-to-day for a search result. <PlaceSearch>.onAdd yields only the
  // master_place id (its API is fixed), so re-hydrate that single id into
  // a full BrowsePlace and dispatch the SAME `trip:toggleAdded` event the
  // browse cards use — search and browse adds go through one path.
  const handleSearchAdd = (masterPlaceId: string) => {
    void (async () => {
      try {
        const res = await fetch("/api/places/hydrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [masterPlaceId] }),
        });
        if (!res.ok) return;
        const { places } = (await res.json()) as { places: BrowsePlace[] };
        const place = places[0];
        if (!place) return;
        window.dispatchEvent(
          new CustomEvent("trip:toggleAdded", {
            detail: {
              placeId: place.id,
              dayId: target.dayId,
              dayNumber: target.dayNumber,
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
      } catch {
        // Best-effort; the browse add path is equally tolerant.
      }
    })();
  };

  const empty = (msg: string) => (
    <div
      className="flex items-center justify-center"
      style={{
        flex: 1,
        padding: 24,
        fontFamily: "var(--ff-mono)",
        fontSize: 12,
        lineHeight: "18px",
        letterSpacing: "0.14em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
        textAlign: "center",
      }}
    >
      {msg}
    </div>
  );

  const places = state.status === "success" ? state.places : [];

  return (
    <>
      <CategoryFilterRow active={filters} onToggle={toggleFilter} />
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        {searching ? (
          <div style={{ padding: 16 }}>
            <PlaceSearch
              query={query}
              center={target.dayCoords ?? target.dayStartCoords}
              categoryFilter={searchFacet}
              dayNumber={target.dayNumber}
              dayDate={target.dayDate}
              onAdd={handleSearchAdd}
            />
          </div>
        ) : state.status === "loading"
          ? empty("Loading nearby places…")
          : state.status === "error"
            ? empty(`Couldn't load places — ${state.message}`)
            : places.length === 0
              ? empty("No places match the selected filters")
              : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: expanded
                        ? `${CARD_W_3UP}px ${CARD_W_3UP}px ${CARD_W_3UP}px`
                        : "300px 300px",
                      justifyContent: "center",
                      gap: expanded ? 12 : 16,
                      padding: expanded ? 8 : 16,
                    }}
                  >
                    {places.map((p) => (
                      <BrowseCardCell
                        key={p.id}
                        place={p}
                        target={target}
                        expanded={expanded}
                        isAdded={addedIds.has(p.id)}
                      />
                    ))}
                  </div>
                )}
      </div>
    </>
  );
}

function BrowseCardCell({
  place,
  target,
  expanded,
  isAdded,
}: {
  place: BrowsePlace;
  target: BrowseTarget;
  expanded: boolean;
  isAdded: boolean;
}) {
  // Each card renders with its OWN category palette (set by the API);
  // falls back to scenic for any result that arrived without a category.
  const placeCategory: SlideCategoryKey = place.category ?? "scenic";
  const ctx: CardCtx = {
    category: placeCategory,
    dayCoords: target.dayCoords,
    dayStartCoords: target.dayStartCoords,
    dayLabel: target.dayLabel,
    dayNumber: target.dayNumber,
    // In-day browse: this ctx day IS the result's day, so the detour is real.
    dayRelative: true,
  };
  const stats = computeCardStats(place, ctx);
  const synthWaypoint = browsePlaceToWaypoint(place, ctx, stats);

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
            dayNumber: target.dayNumber,
            dayId: target.dayId,
            coords: place.coords,
            description: place.description,
            waypoint: synthWaypoint,
          },
        },
      }),
    );
  };

  return (
    <div
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("trip:flyTo", {
            detail: { coords: place.coords, name: place.title },
          }),
        );
        setTimeout(openDetail, 350);
      }}
      style={{
        cursor: "pointer",
        opacity: isAdded ? 0.45 : 1,
        filter: isAdded ? "grayscale(0.6)" : "none",
        transition: "opacity 200ms ease, filter 200ms ease",
      }}
    >
      <LocationBrowseCard
        place={place}
        category={slideCategoryToBrowseCategory(placeCategory)}
        dayNumber={target.dayNumber}
        dayDate={target.dayDate}
        width={expanded ? 354 : 300}
        stats={stats}
        onAdd={(e?: MouseEvent) => {
          e?.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("trip:toggleAdded", {
              detail: {
                placeId: place.id,
                dayId: target.dayId,
                dayNumber: target.dayNumber,
                place,
              },
            }),
          );
        }}
        onOpen={(e?: MouseEvent) => {
          e?.stopPropagation();
          openDetail();
        }}
        onMore={(e?: MouseEvent) => {
          e?.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("trip:openMore", {
              detail: { placeId: place.id, dayId: target.dayId },
            }),
          );
        }}
      />
    </div>
  );
}
