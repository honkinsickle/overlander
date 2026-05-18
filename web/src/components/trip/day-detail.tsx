"use client";

import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from "react";
import { ArrowRight } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { DayHeader } from "@/components/trip/day-header";
import { DayDetailHero } from "@/components/trip/day-detail-hero";
import { SuggestedSection } from "@/components/trip/suggested-section";
import { BrowseDaySection } from "@/components/trip/browse-day-section";
import { FuelStopCard } from "@/components/trip/fuel-stop-card";
import { TripDetailHeader } from "@/components/trip/trip-detail-header";
import { WaypointCard } from "@/components/trip/waypoint-card";
import {
  CategoryBrowsePanel,
  type BrowseTarget,
} from "@/components/trip/category-browse-panel";
import type { Trip, Day, Waypoint } from "@/lib/trips/types";
import type { Category } from "@/components/primitives/detail-card";
import {
  addedPlaceToWaypoint,
  type AddedPlace,
} from "@/lib/trips/added-place";
import {
  addWaypointAction,
  removeWaypointAction,
  reorderWaypointsAction,
} from "@/lib/trips/actions";

const SCROLL_TRIGGER = 100;

const FUEL_THRESHOLD_MI = 300;

/** Returns the set of day IDs that should display a synthesized fuel
 *  waypoint. Walks the trip cumulatively: each day's miles add to the
 *  running counter; the counter resets to 0 whenever the day already
 *  has a fuel-category waypoint OR when this function tags the day as
 *  needing one. */
function computeFuelDays(days: Day[]): Set<string> {
  const out = new Set<string>();
  let milesSinceFuel = 0;
  for (const day of days) {
    const hasFuel = day.waypoints.some((wp) => wp.category === "fuel");
    milesSinceFuel += day.miles || 0;
    if (hasFuel) {
      milesSinceFuel = 0;
    } else if (milesSinceFuel >= FUEL_THRESHOLD_MI) {
      out.add(day.id);
      milesSinceFuel = 0;
    }
  }
  return out;
}

/**
 * Centre-column Day Detail — stacks all days into one long scroll.
 *
 * Each day renders the Paper GDB-0 / GDH-0 card with its four zones:
 *   1. Day Section Header  GDI-0 (440×80)
 *   2. Day Detail Hero wrapper GDL-0 → Hero GDM-0 (404×175)
 *   3. WAY POINTS label GDQ-0
 *   4. Waypoints list GDR-0 · rows GDS-0
 *
 * Each day section is anchored (`id="day-<dayId>"`). The DaySidebar emits
 * `?day=<id>` links and this component scrolls the matching section into
 * view when the param changes. The initial scroll is instant; subsequent
 * changes use smooth scrolling.
 */
export function DayDetail({ trip }: { trip: Trip }) {
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  const scrollRef = useRef<HTMLDivElement>(null);
  const didInitialScroll = useRef(false);
  // While a programmatic smooth scroll is in flight, the scroll-spy must
  // NOT rewrite ?day= mid-flight — otherwise the active-id flips through
  // every intermediate section, and the scroll effect re-targets each,
  // which cancels the smooth scroll and produces the "stops at each day"
  // feel the user reported.
  const programmaticScrollRef = useRef(false);

  // Scroll the centre to a requested day — fired once on mount if
  // `?day=` is in the URL (deep link), and on every sidebar click via
  // the `trip:activeDay` custom event (emitted with source: "sidebar").
  const scrollToDay = (id: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `#day-${CSS.escape(id)}`,
    );
    if (!el) return;
    const offset = el.offsetTop - container.scrollTop;
    if (offset >= 0 && offset <= SCROLL_TRIGGER) return;
    const smooth = didInitialScroll.current;
    if (smooth) programmaticScrollRef.current = true;
    el.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      block: "start",
    });
    didInitialScroll.current = true;
    if (!smooth) return;
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 600);
  };

  // Deep-link scroll on mount.
  useEffect(() => {
    if (queried) scrollToDay(queried);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar click → scroll via the trip:activeDay event.
  useEffect(() => {
    const onSidebar = (e: Event) => {
      const detail = (
        e as CustomEvent<{ id: string; source?: string }>
      ).detail;
      if (!detail?.id || detail.source !== "sidebar") return;
      scrollToDay(detail.id);
    };
    window.addEventListener("trip:activeDay", onSidebar);
    return () => window.removeEventListener("trip:activeDay", onSidebar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Overview row click → scroll to the anchor (e.g. top of the scroll
  // container for the TripDetailHeader / EXPLORE section).
  useEffect(() => {
    const onScrollTo = (e: Event) => {
      const anchor = (e as CustomEvent<{ anchor: string }>).detail?.anchor;
      const container = scrollRef.current;
      if (!container) return;
      if (anchor === "top") {
        programmaticScrollRef.current = true;
        container.scrollTo({ top: 0, behavior: "smooth" });
        // clear ?day= since the scroll-spy suppresses during programmatic scroll
        const url = new URL(window.location.href);
        url.searchParams.delete("day");
        window.history.replaceState(null, "", url);
        setTimeout(() => {
          programmaticScrollRef.current = false;
        }, 600);
      }
    };
    window.addEventListener("trip:scrollTo", onScrollTo);
    return () => window.removeEventListener("trip:scrollTo", onScrollTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll-spy: update the active day without touching Next's router.
  // `history.replaceState` keeps the URL bar in sync for share/reload,
  // and a custom event lets the sidebar follow the scroll without an
  // RSC refetch (router.replace in this spot previously caused hundreds
  // of chunk requests during scroll).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let lastEmitted: string | null = null;
    let ticking = false;

    const update = () => {
      ticking = false;
      if (programmaticScrollRef.current) return;
      const sections = root.querySelectorAll<HTMLElement>(
        'section[id^="day-"]',
      );
      let currentId: string | null = null;
      for (const s of sections) {
        if (s.offsetTop - root.scrollTop <= SCROLL_TRIGGER) {
          currentId = s.id.replace(/^day-/, "");
        }
      }
      if (!currentId || currentId === lastEmitted) return;
      lastEmitted = currentId;
      const url = new URL(window.location.href);
      url.searchParams.set("day", currentId);
      window.history.replaceState(null, "", url);
      window.dispatchEvent(
        new CustomEvent("trip:activeDay", { detail: { id: currentId } }),
      );
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [trip.id]);

  const [browseTarget, setBrowseTarget] = useState<BrowseTarget | null>(null);
  const openBrowse =
    (dayNumber: number, day: Day) => (category: Category) =>
      setBrowseTarget({
        category,
        dayNumber,
        tripId: trip.id,
        dayId: day.id,
        dayCoords: day.coords,
        dayLabel: day.label,
      });

  // ── Added places (per day) ──────────────────────────────────
  // Optimistic per-day buffer of places the user just tapped "Add to
  // Day N" on. CategoryBrowsePanel (cards grid) and MapDetailOverlay
  // (detail slide-up) dispatch trip:toggleAdded; this listener writes
  // the change to public.trips.payload via server action AND updates
  // the optimistic buffer, then re-broadcasts addedIds via
  // trip:addedSync so the dim/CTA-label state in siblings stays in
  // sync. After revalidatePath fires, the added place flows back as a
  // canonical day.waypoints entry on the next render; the buffer
  // entry is filtered out at render-time to avoid double-rendering
  // (see addedPlaces filter in DaySection).
  const [addedByDay, setAddedByDay] = useState<
    Record<string, AddedPlace[]>
  >({});
  // Per-day Set of fixed-waypoint IDs the user has tapped X on. Used
  // for an instant optimistic hide; the server action persists the
  // removal and revalidatePath drops the row from day.waypoints on
  // the next render.
  const [removedFixedByDay, setRemovedFixedByDay] = useState<
    Record<string, Set<string>>
  >({});

  // Refs so the toggleAdded handler can read current trip + optimistic
  // state without re-registering the event listener on every change.
  const tripRef = useRef(trip);
  useEffect(() => {
    tripRef.current = trip;
  }, [trip]);
  const addedByDayRef = useRef(addedByDay);
  useEffect(() => {
    addedByDayRef.current = addedByDay;
  }, [addedByDay]);

  const [, startTransition] = useTransition();

  useEffect(() => {
    const onToggle = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          placeId: string;
          dayId: string;
          place: AddedPlace;
        }>
      ).detail;
      if (!detail?.placeId || !detail?.dayId || !detail?.place) return;

      const currentTrip = tripRef.current;
      const currentAdded = addedByDayRef.current;
      const isCanonical =
        currentTrip.days
          .find((d) => d.id === detail.dayId)
          ?.waypoints.some((wp) => wp.id === detail.placeId) ?? false;
      const isOptimistic = (currentAdded[detail.dayId] ?? []).some(
        (p) => p.id === detail.placeId,
      );
      const currentlyAdded = isCanonical || isOptimistic;

      setAddedByDay((prev) => {
        const list = prev[detail.dayId] ?? [];
        const exists = list.some((p) => p.id === detail.placeId);
        const nextList = exists
          ? list.filter((p) => p.id !== detail.placeId)
          : [...list, detail.place];
        return { ...prev, [detail.dayId]: nextList };
      });

      startTransition(async () => {
        if (currentlyAdded) {
          await removeWaypointAction(
            currentTrip.id,
            detail.dayId,
            detail.placeId,
          );
        } else {
          await addWaypointAction(
            currentTrip.id,
            detail.dayId,
            detail.place,
          );
        }
      });
    };
    window.addEventListener("trip:toggleAdded", onToggle);
    return () => window.removeEventListener("trip:toggleAdded", onToggle);
  }, []);

  useEffect(() => {
    const ids = Object.values(addedByDay)
      .flat()
      .map((p) => p.id);
    window.dispatchEvent(
      new CustomEvent("trip:addedSync", { detail: { addedIds: ids } }),
    );
  }, [addedByDay]);

  const fuelDayIds = computeFuelDays(trip.days);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar">
        <TripDetailHeader trip={trip} />
        <div
          className="uppercase bg-bg-card"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 16,
            lineHeight: "24px",
            fontWeight: 600,
            letterSpacing: "0.19em",
            color: "var(--amber-light)",
            paddingInline: 17,
            paddingBlock: 6,
          }}
        >
          Itinerary
        </div>
        {trip.days.map((day, i) => (
          <DaySection
            key={day.id}
            trip={trip}
            day={day}
            needsFuel={fuelDayIds.has(day.id)}
            addedPlaces={addedByDay[day.id] ?? []}
            removedFixedIds={removedFixedByDay[day.id] ?? EMPTY_SET}
            onDeleteFixed={(waypointId) => {
              setRemovedFixedByDay((prev) => ({
                ...prev,
                [day.id]: new Set([...(prev[day.id] ?? []), waypointId]),
              }));
              startTransition(async () => {
                await removeWaypointAction(trip.id, day.id, waypointId);
              });
            }}
            onDeleteAdded={(placeId) =>
              window.dispatchEvent(
                new CustomEvent("trip:toggleAdded", {
                  detail: {
                    placeId,
                    dayId: day.id,
                    place: (addedByDay[day.id] ?? []).find(
                      (p) => p.id === placeId,
                    ),
                  },
                }),
              )
            }
            // The browse panel always renders results in the Scenic palette
            // (see CategoryBrowsePanel.style override) regardless of opening
            // category, so the generic "Add Waypoints" CTA defaults to it.
            onAddWaypoints={() => openBrowse(i + 1, day)("mountain")}
            extra={
              <>
                <SuggestedSection
                  tripId={trip.id}
                  day={day}
                  onBrowse={openBrowse(i + 1, day)}
                />
                <BrowseDaySection tripId={trip.id} day={day} />
              </>
            }
          />
        ))}
      </div>

      <CategoryBrowsePanel
        target={browseTarget}
        onClose={() => {
          setBrowseTarget(null);
          // Browse panel and detail overlay are part of the same flow —
          // closing the panel should also tuck the detail back away.
          window.dispatchEvent(
            new CustomEvent("trip:openDetail", {
              detail: { place: null },
            }),
          );
        }}
      />
    </div>
  );
}

function overnightToWaypoint(day: Day) {
  const sel = day.overnight?.selected;
  if (!sel) return null;
  const e = sel.enriched;
  const costSuffix = sel.cost ? ` · ${sel.cost}` : "";
  // Prefer trip-plan notes for description (curated copy beats raw OSM/USFS
  // boilerplate); fall back to enriched description when no plan notes.
  const description = sel.notes || e?.description || "";
  return {
    id: `overnight-${day.id}-${sel.id}`,
    slug: sel.id,
    category: "camping" as const,
    title: sel.name,
    subtitle: `Day ${day.dayNumber} · ${sel.type}${costSuffix}`,
    description,
    stats: [
      { label: "TYPE", value: sel.type },
      { label: "COST", value: sel.cost },
      { label: "DETOUR", value: `+${sel.detourMiles} mi` },
    ],
    tags: [sel.type],
    coords: e?.coords,
    photoUrl: e?.photoUrl,
    logistics: {
      entry: sel.cost,
      phone: e?.phone,
      website: e?.website,
    },
    routeOffsetMi: sel.detourMiles,
    dataSources: e?.sources?.length ? ["Trip plan", ...e.sources] : ["Trip plan"],
  };
}

const EMPTY_SET = new Set<string>();

function DaySection({
  trip,
  day,
  hideHeader = false,
  extra,
  addedPlaces = [],
  removedFixedIds = EMPTY_SET,
  needsFuel = false,
  onDeleteFixed,
  onDeleteAdded,
  onAddWaypoints,
}: {
  trip: Trip;
  day: Day;
  hideHeader?: boolean;
  extra?: React.ReactNode;
  addedPlaces?: AddedPlace[];
  removedFixedIds?: Set<string>;
  needsFuel?: boolean;
  onDeleteFixed?: (waypointId: string) => void;
  onDeleteAdded?: (placeId: string) => void;
  onAddWaypoints?: () => void;
}) {
  const visibleFixed = useMemo(
    () => day.waypoints.filter((wp) => !removedFixedIds.has(wp.id)),
    [day.waypoints, removedFixedIds],
  );
  // Optimistic local order for drag-reorder. Resynced from `visibleFixed`
  // when its reference changes (revalidatePath after a server action, or
  // an optimistic-remove updating `removedFixedIds`). Uses the
  // "store-prop-in-state" pattern so we don't cascade renders via effect.
  const [orderedFixed, setOrderedFixed] = useState<Waypoint[]>(visibleFixed);
  const [lastFixedRef, setLastFixedRef] = useState<Waypoint[]>(visibleFixed);
  if (visibleFixed !== lastFixedRef) {
    setLastFixedRef(visibleFixed);
    setOrderedFixed(visibleFixed);
  }

  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [, startSortTransition] = useTransition();
  const onWaypointDragEnd = (event: DragEndEvent) => {
    const activeId = event.active.id as string;
    const overId = event.over?.id as string | undefined;
    if (!overId || activeId === overId) return;
    const fromIdx = orderedFixed.findIndex((wp) => wp.id === activeId);
    const toIdx = orderedFixed.findIndex((wp) => wp.id === overId);
    if (fromIdx === -1 || toIdx === -1) return;
    const nextOrder = [...orderedFixed];
    const [moved] = nextOrder.splice(fromIdx, 1);
    nextOrder.splice(toIdx, 0, moved);
    setOrderedFixed(nextOrder);
    // Translate visible-list positions to canonical `day.waypoints`
    // positions: lookup each visible waypoint's index in the canonical
    // array. Only diverges if optimistic deletes are pending; in that
    // case the action returns ok:false and the next revalidate
    // reconciles.
    const canonicalFromIdx = day.waypoints.findIndex(
      (wp) => wp.id === activeId,
    );
    const canonicalToIdx = day.waypoints.findIndex(
      (wp) => wp.id === overId,
    );
    if (canonicalFromIdx === -1 || canonicalToIdx === -1) return;
    startSortTransition(async () => {
      await reorderWaypointsAction(
        trip.id,
        day.id,
        canonicalFromIdx,
        canonicalToIdx,
      );
    });
  };

  const overnightWp = orderedFixed.some((wp) => wp.category === "camping")
    ? null
    : overnightToWaypoint(day);
  // `last:min-h-full` guarantees the final day can scroll to the top of
  // the viewport even if its content is shorter than the scroll container.
  return (
    <section id={`day-${day.id}`} className="scroll-mt-0 last:min-h-full">
      {/* ── Day Detail Card (GDH-0) ─────────────────────────── */}
      <article className="flex flex-col items-stretch bg-bg-card">
        {!hideHeader && (
          <div className="sticky top-0 z-10 bg-bg-panel pb-[10px]">
            <DayHeader tripId={trip.id} day={day} referenceId={trip.referenceId} />
          </div>
        )}

        {/* Hero wrapper (GDL-0) */}
        <div className="flex justify-center pt-[14px]">
          <DayDetailHero day={day} />
        </div>

        {/* 📍 WAYPOINTS sub-label (N98-0) — Space Mono 13/18, muted,
         *  0.14em tracking. */}
        <div
          className="uppercase"
          style={{
            fontFamily: "var(--ff-mono)",
            fontSize: 13,
            lineHeight: "18px",
            letterSpacing: "0.14em",
            color: "var(--text-muted)",
            paddingInline: 15,
            paddingTop: 16,
            paddingBottom: 10,
          }}
        >
          📍 Waypoints
        </div>

        {/* Waypoints list (GDR-0) — flex-col with 10px inline padding,
         *  no frame of its own (rows carry their own top borders). The
         *  canonical (visibleFixed) list is sortable via dnd-kit; added
         *  places and synthesized overnight/fuel rows render below and
         *  stay fixed (they're not part of day.waypoints). */}
        <div className="flex flex-col px-[10px]">
          <DndContext
            sensors={sortSensors}
            collisionDetection={closestCenter}
            onDragEnd={onWaypointDragEnd}
          >
            <SortableContext
              items={orderedFixed.map((wp) => wp.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedFixed.map((wp) => (
                <SortableWaypointCard
                  key={wp.id}
                  tripId={trip.id}
                  waypoint={wp}
                  onDelete={
                    onDeleteFixed ? () => onDeleteFixed(wp.id) : undefined
                  }
                />
              ))}
            </SortableContext>
          </DndContext>
          {addedPlaces
            .filter((p) => !day.waypoints.some((wp) => wp.id === p.id))
            .map((p) => (
              <WaypointCard
                key={`added-${p.id}`}
                tripId={trip.id}
                waypoint={addedPlaceToWaypoint(p)}
                onDelete={
                  onDeleteAdded ? () => onDeleteAdded(p.id) : undefined
                }
              />
            ))}
          {needsFuel && <FuelStopCard tripId={trip.id} day={day} />}
          {overnightWp && (
            <WaypointCard
              key={overnightWp.id}
              tripId={trip.id}
              waypoint={overnightWp}
            />
          )}
        </div>

        {/* Add Waypoints button (N8F-0) — full-width muted button,
         *  borders on top + bottom from the waypoint list rhythm. */}
        <div
          className="flex items-stretch justify-center border-b border-border-subtle bg-bg-card"
          style={{
            paddingTop: 34,
            paddingBottom: 14,
            paddingInline: 13,
          }}
        >
          <button
            type="button"
            onClick={onAddWaypoints}
            className="flex items-center justify-center gap-2 rounded-sm border"
            style={{
              height: 36,
              width: "80%",
              transform: "translateY(-20%)",
              backgroundColor: "var(--cat-urban-bg)",
              borderColor: "var(--cat-urban)",
              cursor: onAddWaypoints ? "pointer" : "default",
            }}
          >
            <span
              style={{
                fontSize: 14,
                lineHeight: "18px",
                fontFamily: "var(--ff-sans)",
                color: "#FFFFFF",
              }}
            >
              Add Waypoints
            </span>
            <ArrowRight
              className="w-3 h-3 shrink-0"
              strokeWidth={1.75}
              color="#FFFFFF"
            />
          </button>
        </div>

        {extra}
      </article>
      {/* ── End Day Detail Card ─────────────────────────────── */}
    </section>
  );
}

/** Wraps `WaypointCard` with a sortable container div. The drag handle
 *  is the whole card (`cursor: grab`); PointerSensor activation
 *  distance of 8px in DaySection's sensor config keeps short clicks
 *  flowing through to the card's open-panel / delete buttons. */
function SortableWaypointCard({
  tripId,
  waypoint,
  onDelete,
}: {
  tripId: string;
  waypoint: Waypoint;
  onDelete?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: waypoint.id });

  const style: CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    cursor: isDragging ? "grabbing" : "grab",
    zIndex: isDragging ? 30 : undefined,
    boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.55)" : undefined,
    touchAction: "none",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <WaypointCard tripId={tripId} waypoint={waypoint} onDelete={onDelete} />
    </div>
  );
}
