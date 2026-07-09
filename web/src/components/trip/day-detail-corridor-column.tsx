"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  DayDetailOverview,
  type OverviewGuide,
} from "@/components/trip/day-detail-overview";
import {
  DayDetailCorridor,
  type CorridorPlace,
} from "@/components/trip/day-detail-corridor";
import { topPlacesForTrip } from "@/lib/trips/top-places";
import {
  CategoryBrowsePanel,
  type BrowseTarget,
} from "@/components/trip/category-browse-panel";
import {
  addWaypointAction,
  removeWaypointAction,
} from "@/lib/trips/actions";
import type { AddedPlace } from "@/lib/trips/added-place";
import type { CorridorCity, Day, Trip } from "@/lib/trips/types";

/**
 * Slideup center column for the corridor integration — single-day model:
 *
 *   selectedDayId === null → Overview state: the trip-level hero
 *     (TripDetailHeader), which previously sat at the top of DayDetail's
 *     scroll, lives here now.
 *   selectedDayId → that day's DayDetailCorridor (v4), fed real
 *     Day.corridorCities with the spec-§4 degraded two-node fallback for
 *     trips finalized before the corridor engine.
 *
 * Phase 3 editing (model A1 — an add is a waypoint, reroutes the day):
 *   - "Explore more of Day NN" opens the re-homed CategoryBrowsePanel
 *     scoped to the selected day; panel cards dispatch `trip:toggleAdded`.
 *   - The listener here is the single consumer: add → addWaypointAction,
 *     re-toggle/✕ → removeWaypointAction — both run Phase 0's decoupled
 *     recomputeDay (reroute → miles/driveHours → corridor re-derive +
 *     re-bucket), then revalidate; the corridor re-renders with the place
 *     under its server-assigned node. NO client-side geometry — during
 *     the round-trip the column shows a lightweight "Updating route…"
 *     pending state.
 *   - Remove controls appear ONLY on waypoint-backed tiles (`removable`,
 *     set from day.waypoints membership); suggestions stay read-only.
 *   - The map-overlay / FindNearby add paths stay INERT this phase (their
 *     events reach this listener only if this column is mounted — they
 *     are deferred deliberately; see Phase 3 scope).
 */

/** Static, presentational guides for the Overview (Phase A). NOT tied to
 *  the trip — the same two cards show on any trip (e.g. "Coast" guides on
 *  la-to-deadhorse). Real per-trip guides are a deferred Phase B data
 *  decision. Hero images are the design's Paper-CDN assets (placeholder;
 *  swap for hosted assets when real guides land). Taps are stubbed. */
const OVERVIEW_GUIDES_CDN =
  "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";
const OVERVIEW_GUIDES: OverviewGuide[] = [
  {
    title: "Foodies Guide to the Coast",
    description: "Delectable stops — find breakfast, lunch and dinner along the way.",
    byline: "yoTrippin staff",
    imageUrl: `${OVERVIEW_GUIDES_CDN}/01KV6GTWMQCVFS0ZJXB6TBED9B.png`,
  },
  {
    title: "Places not to miss on-route.",
    description: "Recommendations from like-minded yoTrippin staff.",
    byline: "yoTrippin staff",
    imageUrl: `${OVERVIEW_GUIDES_CDN}/5ZBSPM9YYA57R1ENM5ZKSJ4R88.jpg`,
  },
];

export function DayDetailCorridorColumn({
  trip,
  selectedDayId,
  scrollRequest,
  onActiveSection,
}: {
  trip: Trip;
  selectedDayId: string | null;
  /** Bumped by the rail's Overview/Guides/Places nav to scroll the
   *  Overview to a section. `nonce` re-triggers even on the same anchor. */
  scrollRequest?: {
    anchor: "overview" | "guides" | "places";
    nonce: number;
  } | null;
  /** Scroll-spy callback (Overview only): the topmost visible section
   *  (#overview / #guides / #places). Lets the rail highlight the
   *  matching nav item as the user scrolls. */
  onActiveSection?: (section: "overview" | "guides" | "places") => void;
}) {
  const day = selectedDayId
    ? trip.days.find((d) => d.id === selectedDayId)
    : undefined;

  // Rail Guides/Places → scroll the mounted Overview to the section.
  // Batched with the Overview switch upstream, so by the time this
  // effect fires (post-commit) the section is in the DOM.
  useEffect(() => {
    if (!scrollRequest) return;
    document
      .getElementById(scrollRequest.anchor)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollRequest]);

  // Scroll-spy — Overview only. Mirrors the old DayDetail logic: the
  // active section is the DEEPEST one whose top has scrolled to within
  // SPY_TRIGGER of the column top ("the section you most recently reached").
  // (An IntersectionObserver's "topmost intersecting" is too sticky here —
  // a sliver of the previous section keeps it active.) Passive listener,
  // three cheap rect reads per scroll → no jank. Disconnects on a day
  // selection (the rail's day highlight takes over).
  useEffect(() => {
    if (selectedDayId !== null || !onActiveSection) return;
    const ORDER = ["overview", "guides", "places"] as const;
    const scrollRoot = document
      .getElementById("overview")
      ?.closest(".overflow-y-auto");
    if (!scrollRoot) return;

    const SPY_TRIGGER = 100;
    const detect = () => {
      const rootTop = scrollRoot.getBoundingClientRect().top;
      let active: (typeof ORDER)[number] = "overview";
      for (const id of ORDER) {
        const sec = document.getElementById(id);
        if (sec && sec.getBoundingClientRect().top - rootTop <= SPY_TRIGGER) {
          active = id;
        }
      }
      onActiveSection(active);
    };

    detect();
    scrollRoot.addEventListener("scroll", detect, { passive: true });
    return () => scrollRoot.removeEventListener("scroll", detect);
  }, [selectedDayId, onActiveSection]);

  const [browseTarget, setBrowseTarget] = useState<BrowseTarget | null>(null);
  const [isPending, startTransition] = useTransition();
  // Keep the listener's trip fresh across revalidations without
  // re-registering (day-detail's tripRef pattern).
  const tripRef = useRef(trip);
  tripRef.current = trip;

  // Optimistic set of the selected day's added place ids. Seeded from
  // server waypoints and flipped IMMEDIATELY on add/remove so the browse
  // panel's "Added ✓" state updates without waiting on revalidation — the
  // decoupled recompute (and, for the modal-intercept slideup, an
  // unreliable revalidatePath) can't be depended on to re-emit this.
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Re-seed from server truth on day switch / revalidation landing.
  useEffect(() => {
    setAddedIds(new Set(day?.waypoints.map((wp) => wp.id) ?? []));
  }, [day]);
  // Broadcast on every change (seed + optimistic flips) so the panel's
  // trip:addedSync listener stays in sync.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("trip:addedSync", {
        detail: { addedIds: [...addedIds] },
      }),
    );
  }, [addedIds]);

  // ── Add flow: single listener for the browse panel's toggle events ──
  useEffect(() => {
    const onToggle = (e: Event) => {
      const d = (
        e as CustomEvent<{
          placeId?: string;
          dayId?: string;
          place?: AddedPlace;
        }>
      ).detail;
      if (!d?.placeId || !d?.dayId) return;
      const t = tripRef.current;
      const targetDay = t.days.find((x) => x.id === d.dayId);
      if (!targetDay) return;
      const { placeId, dayId, place } = d;
      const exists = targetDay.waypoints.some((wp) => wp.id === placeId);
      // Optimistic panel flip — immediate, before the server round-trip.
      setAddedIds((prev) => {
        const next = new Set(prev);
        if (exists) next.delete(placeId);
        else next.add(placeId);
        return next;
      });
      startTransition(async () => {
        if (exists) {
          await removeWaypointAction(t.id, dayId, placeId);
        } else if (place) {
          await addWaypointAction(t.id, dayId, {
            id: place.id,
            title: place.title,
            description: place.description,
            photoUrl: place.photoUrl,
            coords: place.coords,
          });
        }
      });
    };
    window.addEventListener("trip:toggleAdded", onToggle);
    return () => window.removeEventListener("trip:toggleAdded", onToggle);
  }, []);

  const openBrowse = () => {
    if (!day) return;
    const i = trip.days.findIndex((d) => d.id === day.id);
    const prev = i > 0 ? trip.days[i - 1] : undefined;
    setBrowseTarget({
      category: "scenic",
      dayNumber: day.dayNumber,
      tripId: trip.id,
      dayId: day.id,
      dayCoords: day.coords,
      dayStartCoords:
        day.startCoord ?? prev?.coords ?? (i === 0 ? trip.startCoords : undefined),
      dayLabel: day.label,
      dayDate: day.date,
    });
  };

  const removePlace = (placeId: string) => {
    if (!day) return;
    const dayId = day.id;
    // Optimistic flip so a corridor-tile ✕ also reverts the panel card.
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(placeId);
      return next;
    });
    startTransition(async () => {
      await removeWaypointAction(trip.id, dayId, placeId);
    });
  };

  // Resolve a placeId within a given day to its source (waypoint or
  // segmentSuggestion) and open the shared MapDetailOverlay via
  // trip:openDetail, exactly as the browse cards do. Waypoints pass the
  // full enriched record so all detail sections render; suggestions pass
  // the id/title/photo/coords/description subset. Returns true if found.
  const dispatchPlaceDetail = (d: Day, placeId: string): boolean => {
    const wp = d.waypoints.find((w) => w.id === placeId);
    if (wp) {
      window.dispatchEvent(
        new CustomEvent("trip:openDetail", {
          detail: {
            place: {
              id: wp.id,
              title: wp.title,
              photoUrl: wp.photoUrl,
              dayNumber: d.dayNumber,
              dayId: d.id,
              coords: wp.coords,
              description: wp.description,
              waypoint: wp,
              dayRelative: true,
            },
          },
        }),
      );
      return true;
    }
    const sug = d.segmentSuggestions?.find((s) => s.id === placeId);
    if (!sug) return false;
    window.dispatchEvent(
      new CustomEvent("trip:openDetail", {
        detail: {
          place: {
            id: sug.id,
            title: sug.title,
            photoUrl: sug.photoUrl,
            dayNumber: d.dayNumber,
            dayId: d.id,
            coords: sug.coords,
            description: sug.description,
            dayRelative: true,
          },
        },
      }),
    );
    return true;
  };

  // Corridor tile Details — resolve within the selected day.
  const openPlaceDetail = (placeId: string) => {
    if (day) dispatchPlaceDetail(day, placeId);
  };

  // Overview place Details — no selected day, so resolve trip-wide.
  const openTripPlaceDetail = (placeId: string) => {
    for (const d of trip.days) {
      if (dispatchPlaceDetail(d, placeId)) return;
    }
  };

  return (
    <div className="relative h-full">
      <div
        className={
          "h-full overflow-y-auto no-scrollbar" +
          (isPending ? " opacity-60 pointer-events-none" : "")
        }
      >
        {day ? (
          <DayDetailCorridor
            dayLabel={`Day ${day.dayNumber} — ${formatDayDate(day.date)}`}
            dayNumber={day.dayNumber}
            routeLabel={day.label}
            heroImageUrl={day.heroImage}
            heroAlt={day.label}
            cities={day.corridorCities ?? fallbackCorridor(day)}
            places={placePool(day)}
            onRemovePlace={removePlace}
            onOpenPlace={openPlaceDetail}
            onExploreDay={openBrowse}
          />
        ) : (
          <DayDetailOverview
            routeLabel={`${trip.startLocation} → ${trip.endLocation}`}
            heroImageUrl={trip.heroImage}
            heroAlt={trip.title}
            guidesSubtitle={`Created by the yoTrippin Staff: ${trip.startLocation} → ${trip.endLocation}`}
            guides={OVERVIEW_GUIDES}
            placesSubtitle={`Across your route · ${trip.startLocation} → ${trip.endLocation}`}
            places={topPlacesForTrip(trip)}
            onOpenPlace={openTripPlaceDetail}
            addPlaceholder
          />
        )}
      </div>

      {/* Pending strip during the add/remove → reroute → re-derive round
       *  trip (~1s). No client geometry — the corridor updates when the
       *  recomputed day revalidates in. */}
      {isPending && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center"
          style={{
            top: 10,
            gap: 8,
            padding: "6px 14px",
            borderRadius: 8,
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-muted)",
            fontFamily: "var(--ff-display)",
            fontSize: 13,
          }}
        >
          <span
            aria-hidden
            className="animate-pulse rounded-full"
            style={{ width: 8, height: 8, backgroundColor: "var(--amber)" }}
          />
          Updating route…
        </div>
      )}

      <CategoryBrowsePanel
        target={browseTarget}
        onClose={() => {
          setBrowseTarget(null);
          // Panel and detail overlay are one flow — closing the panel
          // tucks the detail away too (old DayDetail contract).
          window.dispatchEvent(
            new CustomEvent("trip:openDetail", { detail: { place: null } }),
          );
        }}
      />
    </div>
  );
}

/** "2026-05-30" → "Sat, May 30th" (matches the v4 board's day label). */
function formatDayDate(iso: string): string {
  const at = new Date(`${iso}T00:00:00`);
  const weekday = at.toLocaleDateString("en-US", { weekday: "short" });
  const month = at.toLocaleDateString("en-US", { month: "long" });
  const d = at.getDate();
  const suffix =
    d % 10 === 1 && d !== 11
      ? "st"
      : d % 10 === 2 && d !== 12
        ? "nd"
        : d % 10 === 3 && d !== 13
          ? "rd"
          : "th";
  return `${weekday}, ${month} ${d}${suffix}`;
}

/** Spec §4 degraded corridor for days without corridorCities (trips
 *  finalized before the engine, or a cleared post-edit corridor):
 *  Start (label first half, 0 mi) → End (label last half, Day.miles).
 *  No tiles — bucketing needs geometry the client doesn't have. */
function fallbackCorridor(day: Day): CorridorCity[] {
  const parts = day.label.split(" — ");
  const startName = parts[0] || day.label;
  const endName = parts.length > 1 ? parts[parts.length - 1] : day.label;
  const start: CorridorCity = {
    id: `${day.id}-start`,
    name: startName,
    kind: "start",
    coords: day.startCoord ?? day.coords ?? [0, 0],
    milesFromStart: 0,
    placeIds: [],
  };
  if (parts.length < 2 && day.miles === undefined) return [start];
  return [
    start,
    {
      id: `${day.id}-end`,
      name: endName,
      kind: "end",
      coords: day.coords ?? start.coords,
      milesFromStart: day.miles ?? 0,
      placeIds: [],
    },
  ];
}

/** Resolve the day's place pool (spec §1.4: segmentSuggestions ∪
 *  waypoints) into the tile shape v4 renders. BrowsePlace maps by
 *  field-pick; Waypoint shims photoAlt from its title and lifts
 *  rating/reviewCount out of `community`. Waypoint entries are marked
 *  `removable` and come LAST so the byId map favors them on id overlap
 *  (an added suggestion's tile becomes removable). The one category-union
 *  mismatch: BrowsePlace's "overnight" slide key has no card palette —
 *  render those tiles with the camping treatment. */
function placePool(day: Day): CorridorPlace[] {
  const fromSuggestions: CorridorPlace[] = (day.segmentSuggestions ?? []).map(
    (p) => ({
      id: p.id,
      title: p.title,
      category:
        p.category === "overnight" ? "camping" : (p.category ?? "interest"),
      photoUrl: p.photoUrl,
      photoAlt: p.photoAlt,
      rating: p.rating,
      reviewCount: p.reviewCount,
      // Corpus rows carry a google place_id → the day-select hydrate key.
      placeId: p.placeId,
    }),
  );
  // Phase 0 (2026-07-09): the reference build populates `day.suggestions`
  // (legacy per-category discoveries) but never `segmentSuggestions`, so
  // resolve-corridor-cities now folds those into the bucketed pool too.
  // Mirror that here so their tiles resolve by id.
  const fromDaySuggestions: CorridorPlace[] = Object.values(
    day.suggestions ?? {},
  ).map((p) => ({
    id: p.id,
    title: p.title,
    category:
      p.category === "overnight" ? "camping" : (p.category ?? "interest"),
    photoUrl: p.photoUrl,
    photoAlt: p.photoAlt,
    rating: p.rating,
    reviewCount: p.reviewCount,
  }));
  const fromWaypoints: CorridorPlace[] = day.waypoints.map((wp) => ({
    id: wp.id,
    title: wp.title,
    category: wp.category,
    photoUrl: wp.photoUrl,
    photoAlt: wp.title,
    rating: wp.community?.rating,
    reviewCount: wp.community?.reviewCount,
    removable: true,
  }));
  return [...fromSuggestions, ...fromDaySuggestions, ...fromWaypoints];
}
