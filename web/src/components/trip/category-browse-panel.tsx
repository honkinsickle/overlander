"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { ArrowLeft, ChevronsLeft, ChevronsRight } from "lucide-react";
import {
  type Category,
  categoryStyle,
  categoryIcon,
} from "@/components/primitives/detail-card";
import {
  type BrowsePlace,
  TRIP_CATEGORY_TO_SLIDE,
} from "@/lib/trip-browse/places";
import {
  browsePlaceToWaypoint,
  computeCardStats,
  computeDetour,
  formatMinutes,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import { LocationBrowseCard } from "@/components/trip/location-browse-card";
import {
  slideCategoryToBrowseCategory,
} from "@/lib/trip-browse/palette";

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
  /** Day label like "Whitefish, MT — Banff, AB" — used to derive the
   *  next-anchor name for the "new ETA at X" line. */
  dayLabel?: string;
};

// 2-up: 16 + 300 + 16 + 300 + 16 = 648 of content + a few px slack centered.
// 3-up: 8 + 356 + 12 + 356 + 12 + 356 + 8 = 1108 — sits inside the slideup
// body (1113w) with 5px slack so the panel never overhangs the slideup chrome.
const PANEL_WIDTH_2UP = 655;
const PANEL_WIDTH_3UP = 1113;
const CARD_W_3UP = 356;
const TRANSITION_MS = 280;

const PAPER_CDN = "https://app.paper.design/file-assets/01KNTTXWMR13F0Y99G08SQM12D";

/** Extra demo cards appended to the fetched results so the grid feels
 *  populated while the discovery layer is still thin. SceneryCard only
 *  reads `id`, `title`, `photoUrl`, `coords` — the rest of BrowsePlace
 *  is filled with empty placeholders to satisfy the type. */
const EXTRA_DEMO_PLACES: BrowsePlace[] = [
  {
    id: "demo-crater-lake",
    coords: [-122.108, 42.945],
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

  // Reset to 2-up whenever the panel closes so reopening starts collapsed.
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
  // For now we log so devs can confirm the kebab is wired end-to-end while
  // the menu UI is still TBD. Listener is panel-scoped so it stops when
  // the panel closes.
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

  // Push the map column so its left edge meets the panel's right edge. We
  // measure dynamically (subtracting any current marginLeft) so chrome
  // width changes don't silently break the alignment. Cleanup restores
  // the original style on close or unmount.
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

  // Cards in the body always render with the Scenic (mountain) palette,
  // so force the panel header label/icon to match regardless of which
  // category opened the panel.
  const style = target ? categoryStyle.mountain : null;
  const Icon = target ? categoryIcon.mountain : null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-hidden={!open}
      aria-label={target ? `Browse ${style!.label}` : undefined}
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
          <div
            className="flex items-center justify-center shrink-0 rounded-md"
            style={{
              width: 36,
              height: 36,
              backgroundColor: style?.bg ?? "transparent",
              border: style ? `1px solid ${style.accent}` : undefined,
            }}
          >
            {Icon ? (
              <Icon
                width={18}
                height={18}
                stroke={style!.accent}
                strokeWidth={1.75}
                fill="none"
              />
            ) : null}
          </div>

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
              Browse {target ? `Day ${target.dayNumber}` : ""}
            </span>
            <span
              className="truncate"
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 18,
                lineHeight: "22px",
                fontWeight: 700,
                color: style?.accent ?? "var(--text-primary)",
              }}
            >
              {style?.label ?? ""}
            </span>
          </div>

          {/* Expand / collapse — toggles the body grid between 2-up (655)
           *  and 3-up (964). Matches Close's chrome (60×60, --bg-card, left
           *  border) so the two read as a paired button bar. */}
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

          {/* Close — Paper ANI-0 / slideup-shell parity:
           *  60×60 · bg --bg-card · 1px left border --border-subtle ·
           *  margin-right -12 so it sits flush with the bar edge. */}
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

        <div
          className="flex-1 overflow-y-auto no-scrollbar"
          style={{ backgroundColor: "var(--bg-base)" }}
        >
          {target ? <PanelBody target={target} expanded={expanded} /> : null}
        </div>
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
function emitBrowseResults(
  category: string | null,
  places: BrowsePlace[],
): void {
  window.dispatchEvent(
    new CustomEvent("trip:browseResults", {
      detail: {
        category,
        places: places.map((p) => ({ coords: p.coords, title: p.title, id: p.id })),
      },
    }),
  );
}

function PanelBody({ target, expanded }: { target: BrowseTarget; expanded: boolean }) {
  const slideKey = TRIP_CATEGORY_TO_SLIDE[target.category];
  const [state, setState] = useState<FetchState>({ status: "loading" });
  // Local mirror of DayDetail's added-place set, kept in sync via
  // `trip:addedSync`. Drives the dim/CTA-label state on each card.
  // DayDetail is the source of truth; this panel only dispatches
  // `trip:toggleAdded` to mutate it.
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const onSync = (e: Event) => {
      const ids = (e as CustomEvent<{ addedIds: string[] }>).detail?.addedIds;
      if (Array.isArray(ids)) setAddedIds(new Set(ids));
    };
    window.addEventListener("trip:addedSync", onSync);
    return () => window.removeEventListener("trip:addedSync", onSync);
  }, []);

  // Sync map markers to whatever's currently in the panel. Cleanup
  // fires both on category change (markers are replaced) and on panel
  // close (PanelBody unmounts, markers cleared).
  useEffect(() => {
    if (state.status !== "success") return;
    emitBrowseResults(slideKey ?? null, state.places);
    return () => emitBrowseResults(null, []);
  }, [state, slideKey]);

  useEffect(() => {
    if (!slideKey) {
      setState({ status: "success", places: [], source: "fixture" });
      return;
    }
    setState({ status: "loading" });
    const ctrl = new AbortController();
    const url =
      `/api/trip-browse/${encodeURIComponent(target.tripId)}/${encodeURIComponent(target.dayId)}` +
      `?category=${slideKey}`;
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
  }, [target.tripId, target.dayId, slideKey]);

  const empty = (msg: string) => (
    <div
      className="flex items-center justify-center"
      style={{
        minHeight: "100%",
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

  if (!slideKey) return empty(`No browse for ${target.category} yet`);
  if (state.status === "loading") return empty("Loading nearby places…");
  if (state.status === "error") return empty(`Couldn't load places — ${state.message}`);
  if (state.places.length === 0) {
    return empty(`No places found for this category on Day ${target.dayNumber}`);
  }

  // Augment the fetched results with a few extra demo cards so the grid
  // shows enough rows to feel populated while the discovery layer is
  // still thin on this category.
  const placesWithExtras = [...state.places, ...EXTRA_DEMO_PLACES];

  return (
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
      {placesWithExtras.map((p) => {
        const ctx: CardCtx = {
          category: slideKey ?? "scenic",
          dayCoords: target.dayCoords,
          dayLabel: target.dayLabel,
          dayNumber: target.dayNumber,
        };
        const synthWaypoint = browsePlaceToWaypoint(
          p,
          ctx,
          computeCardStats(p, ctx),
        );
        const { miles, minutes } = computeDetour(p, ctx);
        const detour =
          miles < 0.1
            ? ({ onRoute: true } as const)
            : {
                time: `+${formatMinutes(minutes)}`,
                distanceMi: miles,
              };
        const isAdded = addedIds.has(p.id);
        const openDetail = () => {
          window.dispatchEvent(
            new CustomEvent("trip:flyTo", {
              detail: { coords: p.coords, name: p.title },
            }),
          );
          window.dispatchEvent(
            new CustomEvent("trip:openDetail", {
              detail: {
                place: {
                  id: p.id,
                  title: p.title,
                  photoUrl: p.photoUrl,
                  dayNumber: target.dayNumber,
                  dayId: target.dayId,
                  coords: p.coords,
                  description: p.description,
                  waypoint: synthWaypoint,
                },
              },
            }),
          );
        };
        return (
          <div
            key={p.id}
            onClick={() => {
              // Body tap = fly map first, then slide the detail panel up
              // for this place (after the fly registers).
              window.dispatchEvent(
                new CustomEvent("trip:flyTo", {
                  detail: { coords: p.coords, name: p.title },
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
              place={p}
              category={slideCategoryToBrowseCategory(slideKey ?? "scenic")}
              dayNumber={target.dayNumber}
              width={expanded ? 356 : 300}
              detour={detour}
              onAdd={(e?: MouseEvent) => {
                e?.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent("trip:toggleAdded", {
                    detail: {
                      placeId: p.id,
                      dayId: target.dayId,
                      dayNumber: target.dayNumber,
                      place: p,
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
                    detail: { placeId: p.id, dayId: target.dayId },
                  }),
                );
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

