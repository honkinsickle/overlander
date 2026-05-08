"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  type Category,
  categoryStyle,
  categoryIcon,
} from "@/components/primitives/detail-card";
import { LocationCard } from "@/components/primitives/location-card";
import {
  type BrowsePlace,
  TRIP_CATEGORY_TO_SLIDE,
} from "@/lib/trip-browse/places";

export type BrowseTarget = {
  category: Category;
  dayNumber: number;
  /** IDs needed for the live discovery fetch — the API resolves the
   *  day's coords from these to compute its bbox. */
  tripId: string;
  dayId: string;
};

const PANEL_WIDTH = 655;
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
      mapSection.style.marginLeft = `${PANEL_WIDTH - naturalLeft}px`;
    } else {
      mapSection.style.marginLeft = "";
    }
    return () => {
      mapSection.style.marginLeft = "";
    };
  }, [open]);

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
          width: PANEL_WIDTH,
          transform: open ? "translateX(0)" : `translateX(-${PANEL_WIDTH}px)`,
          transitionProperty: "transform",
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
          {target ? <PanelBody target={target} /> : null}
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

function PanelBody({ target }: { target: BrowseTarget }) {
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
        gridTemplateColumns: "300px 300px",
        justifyContent: "center",
        gap: 16,
        padding: 16,
      }}
    >
      {placesWithExtras.map((p) => (
        <SceneryCard
          key={p.id}
          place={p}
          dayNumber={target.dayNumber}
          isAdded={addedIds.has(p.id)}
          onToggleAdded={() =>
            window.dispatchEvent(
              new CustomEvent("trip:toggleAdded", {
                detail: {
                  placeId: p.id,
                  dayId: target.dayId,
                  dayNumber: target.dayNumber,
                  place: p,
                },
              }),
            )
          }
          onCardClick={() => {
            // Body tap = fly map first, then slide the detail panel up
            // for this place (after the fly registers).
            window.dispatchEvent(
              new CustomEvent("trip:flyTo", {
                detail: { coords: p.coords, name: p.title },
              }),
            );
            setTimeout(() => {
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
                  },
                  },
                }),
              );
            }, 350);
          }}
          onDetailsClick={() => {
            // Details tap = fly map + open detail panel for this place.
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
                  },
                },
              }),
            );
          }}
        />
      ))}
    </div>
  );
}

/** Code-aligned to Paper 1E2E-0 — Mountain/Scenery compact card.
 *  Maps `BrowsePlace.title` and `photoUrl` into the canonical Scenery
 *  palette + copy from the demo page. */
function SceneryCard({
  place,
  dayNumber,
  isAdded,
  onToggleAdded,
  onCardClick,
  onDetailsClick,
}: {
  place: BrowsePlace;
  dayNumber: number;
  isAdded: boolean;
  onToggleAdded: () => void;
  onCardClick: () => void;
  onDetailsClick: () => void;
}) {
  return (
    <div
      onClick={onCardClick}
      style={{
        cursor: "pointer",
        opacity: isAdded ? 0.45 : 1,
        filter: isAdded ? "grayscale(0.6)" : "none",
        transition: "opacity 200ms ease, filter 200ms ease",
      }}
    >
      <LocationCard
        category="mountain"
        title={place.title}
        titleColor="#A6C9F9"
        badgeBg="#24354F"
        badgeBorder="#A6C9F9"
        ctaBg="#24354F"
        ctaBorder="#A6C9F9"
        photoUrl={place.photoUrl}
        dayTag={`Day ${dayNumber} / 12.4 mi off`}
        reliability={{ score: 94, label: "High reliability" }}
        cost={{
          primary: "Detour: 1h28m",
          secondary: "$30 entry · Daily",
          hero: "Adds 1h28m",
          eta: (
            <>
              New ETA at Klamath <br />Falls: 8:46pm
            </>
          ),
        }}
        rating={{ value: "4.8", count: "(12.4k)" }}
        ctaLabel={isAdded ? "Added" : `Add to Day ${dayNumber}`}
        onCtaClick={(e) => {
          // Don't bubble to the card body click (which would re-fly the
          // map and re-open the detail panel). Toggles between Added /
          // Add to Day N — re-tap restores the original state.
          e?.stopPropagation();
          onToggleAdded();
        }}
        onOpenClick={(e) => {
          // Stop the body-click handler from also firing — Details has its
          // own behavior (open detail panel) that supersedes the body tap.
          e?.stopPropagation();
          onDetailsClick();
        }}
      />
    </div>
  );
}
