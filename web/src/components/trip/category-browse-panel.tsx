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
import {
  type BrowseCardCategory,
  BROWSE_CARD_CATEGORIES,
  browseCardPalette,
  browseCategoryToSlide,
  slideCategoryToBrowseCategory,
} from "@/lib/trip-browse/palette";
import { CategoryIconV2 } from "@/components/icons/category-icons-v2";

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
};

// 2-up: 16 + 300 + 16 + 300 + 16 = 648 of content + a few px slack centered.
// 3-up: 8 + 354 + 12 + 354 + 12 + 354 + 8 = 1102 — sits inside the slideup
// body (1113w) with 11px slack so the panel never overhangs the slideup chrome.
const PANEL_WIDTH_2UP = 655;
const PANEL_WIDTH_3UP = 1113;
const CARD_W_3UP = 354;
const TRANSITION_MS = 280;

const PAPER_CDN = "https://app.paper.design/file-assets/01KNTTXWMR13F0Y99G08SQM12D";

/** Extra demo cards appended to the fetched results so the grid feels
 *  populated while the discovery layer is still thin. */
const EXTRA_DEMO_PLACES: BrowsePlace[] = [
  {
    id: "demo-crater-lake",
    coords: [-122.108, 42.945],
    category: "scenic",
    title: "Crater Lake National Park",
    photoUrl: `${PAPER_CDN}/78R7DE7V2NKT3G0EDJFF24TDKZ.png`,
    photoAlt: "Crater Lake at golden hour",
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description:
      "Caldera lake formed when Mount Mazama collapsed 7,700 years ago — the deepest in the U.S. at 1,949 ft. Rim Drive loops the rim with 30+ overlooks.",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "",
  },
  {
    id: "demo-diamond-lake",
    coords: [-122.135, 43.165],
    category: "scenic",
    title: "Diamond Lake Overlook",
    photoUrl: `${PAPER_CDN}/01KQXV7RGFDADF3EDNVB4THDV5.png`,
    photoAlt: "Diamond Lake reflection",
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description:
      "Mile-wide alpine lake with Mount Bailey to the west and Mount Thielsen to the east. Ringed by the Rim Trail and a paved bike path.",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "",
  },
  {
    id: "demo-klamath-falls",
    coords: [-121.78, 42.225],
    category: "scenic",
    title: "Klamath Falls Vista",
    photoUrl: `${PAPER_CDN}/01KQXWN6ZC3T2VGR430QM8EHYH.png`,
    photoAlt: "Klamath Falls autumn street",
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description:
      "Birding capital of the Pacific Flyway — Upper Klamath Lake and the surrounding refuges host bald eagles in winter and white pelicans in summer.",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "",
  },
];

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
              Browse Day {target?.dayNumber ?? ""}
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
              Within 10 mi of today
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
        places: places.map((p) => ({ coords: p.coords, title: p.title, id: p.id })),
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

  // For the "scenic-only" demo augment we just append the demo cards
  // unconditionally when scenic is in the active set (or filters are
  // empty = "all"). Keeps the grid feeling populated while discovery
  // remains thin on this category.
  const showScenicDemo =
    filters.size === 0 || filters.has("scenic");
  const placesWithExtras =
    state.status === "success"
      ? showScenicDemo
        ? [...state.places, ...EXTRA_DEMO_PLACES]
        : state.places
      : [];

  return (
    <>
      <FilterChipRow active={filters} onToggle={toggleFilter} />
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        {state.status === "loading"
          ? empty("Loading nearby places…")
          : state.status === "error"
            ? empty(`Couldn't load places — ${state.message}`)
            : placesWithExtras.length === 0
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
                    {placesWithExtras.map((p) => (
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

function FilterChipRow({
  active,
  onToggle,
}: {
  active: Set<BrowseCardCategory>;
  onToggle: (c: BrowseCardCategory) => void;
}) {
  return (
    <div
      className="flex items-center justify-center shrink-0"
      role="toolbar"
      aria-label="Filter by category"
      style={{
        gap: 12,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 12,
        paddingBottom: 12,
        backgroundColor: "var(--bg-base)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      {BROWSE_CARD_CATEGORIES.map((c) => {
        const palette = browseCardPalette[c];
        const isActive = active.has(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={isActive}
            aria-label={`Filter: ${palette.label}`}
            onClick={() => onToggle(c)}
            className="flex items-center justify-center transition-all"
            style={{
              width: 54,
              height: 54,
              borderRadius: 6,
              backgroundColor: palette.badgeBg,
              border: `1px solid ${palette.badgeBorder}`,
              opacity: active.size === 0 || isActive ? 1 : 0.4,
              boxShadow: isActive
                ? `0 0 0 1px ${palette.badgeBorder}`
                : "none",
            }}
          >
            <CategoryIconV2 category={c} size={28} />
          </button>
        );
      })}
    </div>
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
  // Each card renders with its OWN category palette (set by the API,
  // falling back to scenic for demo-augmented entries that bypassed the
  // pipeline).
  const placeCategory: SlideCategoryKey = place.category ?? "scenic";
  const ctx: CardCtx = {
    category: placeCategory,
    dayCoords: target.dayCoords,
    dayStartCoords: target.dayStartCoords,
    dayLabel: target.dayLabel,
    dayNumber: target.dayNumber,
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
