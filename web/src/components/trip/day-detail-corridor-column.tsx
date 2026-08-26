"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { decodePolyline } from "@/lib/routing/point-to-polyline";
import { dayStartMiles } from "@/lib/corridor/stretches";
import { applyPlaceOverrides } from "@/lib/corridor/bucket";
import {
  pinPlaceAction,
  unpinPlaceAction,
  setPlaceRankAction,
} from "@/lib/itinerary/node-actions";
import type { PlaceMove } from "@/components/trip/day-detail-node-blocks";
import {
  DayDetailOverview,
  type OverviewGuide,
} from "@/components/trip/day-detail-overview";
import {
  DayDetailCorridor,
  type CorridorPlace,
} from "@/components/trip/day-detail-corridor";
import { ContinuousDayStack } from "@/components/trip/continuous-day-stack";
import { estimateDayHeight } from "@/lib/trips/continuous-scroll";
import { DayBriefingCard } from "@/components/trip/day-briefing-card";
import type { PlaceRich } from "@/lib/discovery/google-places";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import {
  browsePlaceToWaypoint,
  computeCardStats,
  type CardCtx,
} from "@/lib/trip-browse/card-stats";
import { topPlacesForTrip } from "@/lib/trips/top-places";
import {
  CategoryBrowsePanel,
  type BrowseTarget,
} from "@/components/trip/category-browse-panel";
import {
  addWaypointAction,
  removeWaypointAction,
  moveCuratedPlaceAction,
  removeCuratedPlaceAction,
  splitDayAction,
  insertRestDayAction,
} from "@/lib/trips/actions";
import { KebabMenu, type KebabMenuItem } from "@/components/primitives/kebab-menu";
import { SplitPointPicker } from "@/components/trip/split-point-picker";
import { splitEligibility } from "@/lib/trips/split-day";
import { isRestDay } from "@/lib/trips/rest-day";
import { Scissors, Tent } from "lucide-react";
import { useRouter } from "next/navigation";
import type { CuratedMenu } from "@/components/trip/curated-kebab";
import type { AddedPlace } from "@/lib/trips/added-place";
import type { CorridorCity, Day, PlaceNodeOverride, Trip, Waypoint } from "@/lib/trips/types";
import { isSameAnchorPlace } from "@/lib/corridor/anchor-match";

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
  onSelectDay,
  editMode = false,
  canEdit = false,
}: {
  trip: Trip;
  selectedDayId: string | null;
  /** Writes `?day=` (the canonical selection channel). In the continuous
   *  view-mode scroll, the settle handler calls this so the rail highlight and
   *  map follow the reader — one fan-out per settle. Same writer the rail uses. */
  onSelectDay?: (dayId: string | null) => void;
  /** True for a user-owned, editable UUID trip (`!isReference &&
   *  isUserTripId`). Gates the curated-POI ⋮ kebab — reference/frozen slugs
   *  never show it. */
  canEdit?: boolean;
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
  /** Manual-edit mode — forwarded to the corridor's place cards. */
  editMode?: boolean;
}) {
  const day = selectedDayId
    ? trip.days.find((d) => d.id === selectedDayId)
    : undefined;

  // Edit render positions POIs by projecting their coords onto the route:
  // decode the trip polyline once, and the selected day's cumulative start mile.
  const routeLine = useMemo(
    () => (trip.routePolyline ? decodePolyline(trip.routePolyline) : []),
    [trip.routePolyline],
  );
  const dayStartMile = useMemo(() => {
    const idx = trip.days.findIndex((d) => d.id === selectedDayId);
    return idx >= 0 ? dayStartMiles(trip.days)[idx] : 0;
  }, [trip.days, selectedDayId]);

  // ── Optimistic pin/unpin overlay (edit-mode drag) ──────────────────────
  // The drag flips this local override list IMMEDIATELY (the spine re-renders
  // from it), then persists in the background; a failed write reverts it and
  // raises a loud, persistent inline error on the card. Re-seeded from server
  // truth whenever the trip payload lands (revalidatePath is unreliable on the
  // modal-intercept slideup, so the optimism carries the UX — same as addedIds).
  const MAX_ATTACH_MI = 25;
  const serverOverrides = trip.placeOverrides ?? [];
  const [localOverrides, setLocalOverrides] = useState<PlaceNodeOverride[]>(serverOverrides);
  useEffect(() => {
    setLocalOverrides(trip.placeOverrides ?? []);
  }, [trip.placeOverrides]);
  const [pendingPlaceId, setPendingPlaceId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<{ placeId: string; message: string } | null>(null);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const [, startMoveTransition] = useTransition();
  // Authored order overlay (declared before onMovePlace so a cross-node pin can
  // flip + revert ranks alongside the override). Same optimistic pattern.
  const [localRanks, setLocalRanks] = useState<Record<string, { nodeId: string; rank: number }>>(
    trip.placeRanks ?? {},
  );
  useEffect(() => {
    setLocalRanks(trip.placeRanks ?? {});
  }, [trip.placeRanks]);
  const ranksMap = useMemo(() => new Map(Object.entries(localRanks)), [localRanks]);

  const onMovePlace = useCallback(
    (move: PlaceMove) => {
      if (!day) return;
      const tripId = trip.id;
      const dayId = day.id;
      const prev = localOverrides;
      const prevRanks = localRanks;
      setMoveError(null);

      if (move.toNodeId === null) {
        // Unpin. Elide a no-op (place wasn't pinned) so the drive stays inert.
        if (!prev.some((o) => o.placeId === move.placeId)) return;
        setMoveNote(null);
        setLocalOverrides(prev.filter((o) => o.placeId !== move.placeId));
        setPendingPlaceId(move.placeId);
        startMoveTransition(async () => {
          const res = await unpinPlaceAction(tripId, move.placeId);
          if (!res.ok) {
            setLocalOverrides(prev);
            setMoveError({ placeId: move.placeId, message: `Couldn't unpin: ${res.error}` });
          }
          setPendingPlaceId((p) => (p === move.placeId ? null : p));
        });
        return;
      }

      // Pin (one home per place — replace any prior override).
      const nodeId = move.toNodeId;
      setLocalOverrides([
        ...prev.filter((o) => o.placeId !== move.placeId),
        { placeId: move.placeId, nodeId },
      ]);
      // Out-of-radius: state the cost, don't block (keep the true mile).
      setMoveNote(
        (move.distanceMi ?? 0) > MAX_ATTACH_MI && move.placeName && move.nodeName
          ? `${move.placeName} is ${Math.round(move.distanceMi as number)} mi from ${move.nodeName} — pinned anyway.`
          : null,
      );
      // Cross-node drop authors the position in the target too: flip ranks with
      // the override so the target is never partially ranked, and commit both in
      // ONE action (pinPlaceAction merges rankWrites). Revert both on failure.
      if (move.rankWrites) setLocalRanks({ ...prevRanks, ...move.rankWrites });
      setPendingPlaceId(move.placeId);
      startMoveTransition(async () => {
        const res = await pinPlaceAction(tripId, {
          dayId,
          placeId: move.placeId,
          nodeId,
          rankWrites: move.rankWrites,
        });
        if (!res.ok) {
          setLocalOverrides(prev);
          if (move.rankWrites) setLocalRanks(prevRanks);
          setMoveError({ placeId: move.placeId, message: `Couldn't move: ${res.error}` });
        }
        setPendingPlaceId((p) => (p === move.placeId ? null : p));
      });
    },
    [day, localOverrides, localRanks, trip.id],
  );

  // ── Optimistic authored order (edit-mode same-node reorder) ─────────────
  // localRanks + ranksMap are declared above (before onMovePlace). A same-node
  // drop flips ranks immediately (the edit spine re-sorts from them), then
  // persists in the background; a failed write reverts and raises the error.
  const onReorderPlace = useCallback(
    (placeId: string, rankWrites: Record<string, { nodeId: string; rank: number }>) => {
      const prev = localRanks;
      setMoveError(null);
      setMoveNote(null);
      setLocalRanks({ ...prev, ...rankWrites });
      setPendingPlaceId(placeId);
      startMoveTransition(async () => {
        const res = await setPlaceRankAction(trip.id, rankWrites);
        if (!res.ok) {
          setLocalRanks(prev);
          setMoveError({ placeId, message: `Couldn't reorder: ${res.error}` });
        }
        setPendingPlaceId((p) => (p === placeId ? null : p));
      });
    },
    [localRanks, trip.id],
  );

  // The selected day's cities with the OPTIMISTIC overlay applied: strip a
  // locally-unpinned place from every placeIds (→ it falls to geometry in the
  // hybrid render) and re-home locally-pinned places. base already carries the
  // SERVER overrides, so unpins must be un-baked here, not just dropped.
  const effectiveCities = useMemo(() => {
    if (!day) return undefined;
    const base = day.corridorCities;
    if (!base) return undefined;
    const removed = new Set(
      serverOverrides
        .filter((so) => !localOverrides.some((lo) => lo.placeId === so.placeId))
        .map((so) => so.placeId),
    );
    const stripped = removed.size
      ? base.map((c) => ({ ...c, placeIds: c.placeIds.filter((pid) => !removed.has(pid)) }))
      : base;
    return applyPlaceOverrides({ cities: stripped, overrides: localOverrides });
    // serverOverrides is derived from trip.placeOverrides (in the deps already).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, localOverrides, trip.placeOverrides]);

  // P3 (2026-07-09): hydrate the visible day's corpus tiles with live Google
  // ratings/photos by place_id. Keyed by place_id, accumulated across days.
  const [hydrated, setHydrated] = useState<Record<string, PlaceRich>>({});

  // Days currently mounted in the continuous stack (reported by the stack).
  // Drives the hydration union below so scroll-back is free and approaching
  // days are already hydrated when they reach the viewport.
  const [mountedIds, setMountedIds] = useState<string[]>([]);

  // The set of day ids to hydrate. Continuous view mode → the mounted window;
  // single-day edit swap → just the selected day; Overview → none.
  const hydrateDayIds = useMemo(() => {
    if (selectedDayId === null) return [] as string[];
    if (editMode) return [selectedDayId];
    return mountedIds;
  }, [selectedDayId, editMode, mountedIds]);
  const hydrateKey = hydrateDayIds.join("|");

  // Fetch Place Details for the corpus tiles across the mounted day set that
  // carry a placeId and aren't already rich (waypoints + already-rich tiles
  // skipped). One batched POST per mount change; the in-filter !hydrated[] guard
  // means only NEW ids are fetched. Progressive + non-blocking: tiles render
  // essentials immediately; rich fields graft in when this lands. Graceful: any
  // failure/abort leaves the tiles on essentials. The API key never reaches the
  // client — the /api/places/details route holds it server-side.
  useEffect(() => {
    const daysToHydrate = hydrateDayIds
      .map((id) => trip.days.find((d) => d.id === id))
      .filter((d): d is Day => !!d);
    const placeIds = Array.from(
      new Set(
        daysToHydrate
          .flatMap((d) => placePool(d))
          .filter(
            // Any tile carrying a Google place_id and lacking a photo — NOT just
            // `mp:` corpus rows. Curated key stops resolved via Google arrive as
            // `google:` ids with a placeId; the old mp:-only gate skipped them,
            // so their photos never loaded on any surface.
            (t) => t.placeId && !t.photoUrl && !hydrated[t.placeId],
          )
          .map((t) => t.placeId as string),
      ),
    );
    if (placeIds.length === 0) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/places/details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeIds }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const { details } = (await res.json()) as {
          details: Record<string, PlaceRich>;
        };
        if (details && Object.keys(details).length > 0) {
          setHydrated((prev) => ({ ...prev, ...details }));
        }
      } catch {
        // network/abort → tiles stay essentials
      }
    })();
    return () => ctrl.abort();
    // hydrated is intentionally omitted: re-run only when the mounted set
    // changes, using the in-filter guard to skip already-hydrated ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrateKey]);

  // Rail Guides/Places → scroll the mounted Overview to the section.
  // Batched with the Overview switch upstream, so by the time this
  // effect fires (post-commit) the section is in the DOM.
  useEffect(() => {
    if (!scrollRequest) return;
    if (scrollRequest.anchor === "overview") {
      // "overview" = the very top of the column (sent by the rail's
      // Guides item) — scroll the container itself so the pad above the
      // hero comes along, not just the #overview section top.
      document
        .getElementById("overview")
        ?.closest(".overflow-y-auto")
        ?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
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

  // Track which detail (if any) is currently open, so the fetch-on-open
  // fallback below only re-emits rich fields into a sheet that's still
  // showing THIS place — never re-opens one the user has since closed or
  // switched away from. Mirrors the overlay's own open state via the event.
  const openDetailIdRef = useRef<string | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ place: { id?: string } | null }>).detail
        ?.place?.id;
      openDetailIdRef.current = id ?? null;
    };
    window.addEventListener("trip:openDetail", onOpen);
    return () => window.removeEventListener("trip:openDetail", onOpen);
  }, []);

  // ── PR2 marker→card ─────────────────────────────────────────────────────────
  // The map dispatches trip:placeFocus with a place id when a dot is clicked;
  // scroll that card into view and highlight it (find-nearby's marker→card link,
  // adapted). Markers plot the ACTIVE day only, and the active day is always
  // mounted in the continuous stack, so the card is findable. The query is scoped
  // to the active day's [data-day-id] slot so a same-id card on another mounted
  // day can't answer for it. Scrolling to a card WITHIN the active day keeps the
  // stack's centered-day = active day, so its settle writer is a no-op (?day=
  // unchanged) — no programmaticUntil guard needed; verified in the browser.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const selectedDayIdRef = useRef(selectedDayId);
  selectedDayIdRef.current = selectedDayId;
  useEffect(() => {
    const onPlaceFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      setFocusedId(id);
      const sel = selectedDayIdRef.current;
      const el =
        (sel &&
          document.querySelector(
            `[data-day-id="${CSS.escape(sel)}"] [data-place-id="${CSS.escape(id)}"]`,
          )) ||
        document.querySelector(`[data-place-id="${CSS.escape(id)}"]`);
      if (el) {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.addEventListener("trip:placeFocus", onPlaceFocus);
    return () => window.removeEventListener("trip:placeFocus", onPlaceFocus);
  }, []);

  // Optimistic set of the selected day's added place ids. Seeded from
  // server waypoints and flipped IMMEDIATELY on add/remove so the browse
  // panel's "Added ✓" state updates without waiting on revalidation — the
  // decoupled recompute (and, for the modal-intercept slideup, an
  // unreliable revalidatePath) can't be depended on to re-emit this.
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  // Re-seed from server truth. When the browse panel is open it may be scoped to
  // any mounted day (openBrowseFor(d)), so seed from THAT day's waypoints;
  // otherwise the selected day. Keeps the panel's "Added ✓" correct in the
  // continuous stack where there is no single mounted day.
  useEffect(() => {
    const seedDay = browseTarget
      ? trip.days.find((x) => x.id === browseTarget.dayId)
      : day;
    setAddedIds(new Set(seedDay?.waypoints.map((wp) => wp.id) ?? []));
    // browseTarget carries the scoped dayId; `day` covers the edit/overview path.
  }, [browseTarget, day, trip.days]);
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

  // Open the day-scoped browse panel for an EXPLICIT day (any mounted day in the
  // continuous stack, not just the selected one).
  const openBrowseFor = (d: Day) => {
    const i = trip.days.findIndex((x) => x.id === d.id);
    const prev = i > 0 ? trip.days[i - 1] : undefined;
    setBrowseTarget({
      category: "scenic",
      dayNumber: d.dayNumber,
      tripId: trip.id,
      dayId: d.id,
      dayCoords: d.coords,
      dayStartCoords:
        d.startCoord ?? prev?.coords ?? (i === 0 ? trip.startCoords : undefined),
      dayLabel: d.label,
      dayDate: d.date,
    });
  };
  const openBrowse = () => {
    if (day) openBrowseFor(day);
  };

  const removePlaceFor = (d: Day, placeId: string) => {
    // Optimistic flip so a corridor-tile ✕ also reverts the panel card.
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(placeId);
      return next;
    });
    startTransition(async () => {
      await removeWaypointAction(trip.id, d.id, placeId);
    });
  };
  const removePlace = (placeId: string) => {
    if (day) removePlaceFor(day, placeId);
  };

  // ── Curated-POI kebab (⋮ Move to day / Delete) ─────────────────────────────
  // Geometry-free overlay edits on segmentSuggestion tiles: the guarded actions
  // move/delete the entry and rescopeOverlays drops its now-orphaned pin/rank
  // (moved POI lands unranked+unpinned on the new day). Gated on canEdit — the
  // kebab never shows on reference/frozen slugs.
  const router = useRouter();
  const [curatedBusyId, setCuratedBusyId] = useState<string | null>(null);
  const [curatedError, setCuratedError] = useState<string | null>(null);
  const runCurated = useCallback(
    (placeId: string, action: () => Promise<{ ok: boolean; error?: string }>) => {
      setCuratedError(null);
      setCuratedBusyId(placeId);
      startTransition(async () => {
        const res = await action();
        setCuratedBusyId((p) => (p === placeId ? null : p));
        if (!res.ok) {
          setCuratedError(res.error ?? "Something went wrong.");
          return;
        }
        // revalidatePath is unreliable on the modal-intercept slideup; force the
        // RSC re-fetch so the moved/removed tile reflects server truth.
        router.refresh();
      });
    },
    [router, startTransition],
  );
  const dayList = useMemo(
    () => trip.days.map((d) => ({ id: d.id, label: `Day ${d.dayNumber}` })),
    [trip.days],
  );
  const buildCuratedMenuFor = useCallback(
    (d: Day, place: CorridorPlace): CuratedMenu | undefined => {
      if (!canEdit) return undefined;
      const fromDayId = d.id;
      if (place.curatedMovable) {
        // Curated POI (segmentSuggestion, overlay): Move + Delete, geometry-free.
        return {
          busy: curatedBusyId === place.id,
          onDelete: () =>
            runCurated(place.id, () =>
              removeCuratedPlaceAction(trip.id, fromDayId, place.id),
            ),
          move: {
            days: dayList,
            currentDayId: fromDayId,
            onMoveToDay: (toDayId) =>
              runCurated(place.id, () =>
                moveCuratedPlaceAction(trip.id, fromDayId, toDayId, place.id),
              ),
          },
        };
      }
      if (place.removable) {
        // Route-waypoint (day.waypoints, routed): Delete only — moving a routed
        // waypoint changes geometry (deferred to moveWaypointToDay). Reuse the
        // existing optimistic delete path (removeWaypointAction via removePlaceFor).
        return { onDelete: () => removePlaceFor(d, place.id) };
      }
      return undefined;
    },
    // removePlaceFor is a stable-enough closure over trip.id; excluded to keep
    // the menu builder from re-identifying every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, dayList, curatedBusyId, runCurated, trip.id],
  );
  const buildCuratedMenu = (place: CorridorPlace): CuratedMenu | undefined =>
    day ? buildCuratedMenuFor(day, place) : undefined;

  // ── Day-level structural edits (Split this day / Add a rest day) ──────────
  // A new day-level kebab: no day-level menu existed in the live corridor view
  // (DayHeader — the old rename/delete kebab — is orphaned; see PR notes), so
  // this is the minimal host. Same run pattern as runCurated: guarded action →
  // router.refresh() (revalidatePath is unreliable through the slideup intercept).
  const [splitPickerDay, setSplitPickerDay] = useState<Day | null>(null);
  const splitElig = useMemo(
    () => (splitPickerDay ? splitEligibility(trip, splitPickerDay.id) : null),
    [splitPickerDay, trip],
  );
  const runDayAction = useCallback(
    (action: () => Promise<{ ok: boolean; error?: string }>) => {
      setCuratedError(null);
      startTransition(async () => {
        const res = await action();
        if (!res.ok) {
          setCuratedError(res.error ?? "Something went wrong.");
          return;
        }
        router.refresh();
      });
    },
    [router, startTransition],
  );
  const buildDayMenuItems = useCallback(
    (d: Day): KebabMenuItem[] => {
      const elig = splitEligibility(trip, d.id);
      return [
        {
          id: "split",
          label: "Split this day",
          icon: Scissors,
          disabled: elig.disabledReason !== null,
          disabledReason: elig.disabledReason ?? undefined,
          onSelect: () => setSplitPickerDay(d),
        },
        {
          id: "rest",
          label: "Add a rest day",
          icon: Tent,
          onSelect: () => runDayAction(() => insertRestDayAction(trip.id, d.id)),
        },
      ];
    },
    [trip, runDayAction],
  );

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

    // Build the rich detail waypoint the overlay reads from `place.waypoint`
    // (same browsePlaceToWaypoint browse uses — a segmentSuggestion IS a
    // BrowsePlace). Static fields (address/phone/website/description/tags)
    // come straight off the tile; live fields (rating/reviewCount/hours/
    // photo) graft from the card hydrate's PlaceRich when present.
    const i = trip.days.findIndex((x) => x.id === d.id);
    const prev = i > 0 ? trip.days[i - 1] : undefined;
    const ctx: CardCtx = {
      category: sug.category ?? "interest",
      dayCoords: d.coords,
      dayStartCoords:
        d.startCoord ?? prev?.coords ?? (i === 0 ? trip.startCoords : undefined),
      dayLabel: d.label,
      dayNumber: d.dayNumber,
      dayDate: d.date,
      dayRelative: true,
    };
    const synth = (rich?: PlaceRich): Waypoint => {
      const enriched: BrowsePlace = {
        ...sug,
        rating: rich?.rating ?? sug.rating,
        reviewCount: rich?.reviewCount ?? sug.reviewCount,
        photoUrl: rich?.photoUrl ?? sug.photoUrl,
        // Fetched by /api/places/details (PlaceRich.priceTier) but previously
        // never grafted here — browsePlaceToWaypoint already reads
        // place.priceTier (→ logistics.entry / simulator.entryCost via
        // priceTierToEntry) and always has; this was the missing graft, not
        // a missing consumer. docs/architecture/place-pipeline-trace.md §3.
        priceTier: rich?.priceTier ?? sug.priceTier,
      };
      const wp = browsePlaceToWaypoint(
        enriched,
        ctx,
        computeCardStats(enriched, ctx),
      );
      // browsePlaceToWaypoint sources hours from card stats (absent on the
      // essentials tile); graft the live hours from PlaceRich when present.
      return rich?.hours
        ? { ...wp, logistics: { ...wp.logistics, hours: rich.hours } }
        : wp;
    };
    const emit = (waypoint: Waypoint) => {
      window.dispatchEvent(
        new CustomEvent("trip:openDetail", {
          detail: {
            place: {
              id: sug.id,
              title: sug.title,
              photoUrl: waypoint.photoUrl ?? sug.photoUrl,
              dayNumber: d.dayNumber,
              dayId: d.id,
              coords: sug.coords,
              description: sug.description,
              waypoint,
              dayRelative: true,
            },
          },
        }),
      );
    };

    const cached = sug.placeId ? hydrated[sug.placeId] : undefined;
    emit(synth(cached));

    // Fetch-on-open fallback: a google-backed tile whose card hydrate hasn't
    // landed yet. Fetch its rich fields, cache them (updates the card too),
    // and re-emit into the sheet — but only if it's still open on THIS place.
    if (sug.placeId && !cached) {
      const pid = sug.placeId;
      void (async () => {
        try {
          const res = await fetch("/api/places/details", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ placeIds: [pid] }),
          });
          if (!res.ok) return;
          const { details } = (await res.json()) as {
            details: Record<string, PlaceRich>;
          };
          const got = details?.[pid];
          if (!got) return;
          setHydrated((h) => ({ ...h, [pid]: got }));
          if (openDetailIdRef.current === sug.id) emit(synth(got));
        } catch {
          // network/abort → sheet stays on static + any cached fields
        }
      })();
    }
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

  // ── Per-day view render helpers ─────────────────────────────────────────────
  // Shared by the continuous stack (every mounted day) and the single-day edit
  // swap, so both paths derive tiles/hero identically. PURE reads of the trip +
  // the accumulated `hydrated` cache — no model mutation.

  // Graft live hydrate (rating/photo/category) onto a day's pool tiles.
  const hydratePlaces = (d: Day): CorridorPlace[] =>
    placePool(d).map((t) => {
      const rich = t.placeId ? hydrated[t.placeId] : undefined;
      return rich
        ? {
            ...t,
            rating: rich.rating ?? t.rating,
            reviewCount: rich.reviewCount ?? t.reviewCount,
            photoUrl: rich.photoUrl ?? t.photoUrl,
            // Live-resolved tiles bake no category → "interest" default (grey
            // title, generic pin). Google types give the real one. "overnight"
            // (lodging) has no card palette → "hotel".
            category:
              (rich.category === "overnight" ? "hotel" : rich.category) ??
              t.category,
            // Fetched, previously never grafted (docs/architecture/
            // place-pipeline-trace.md §3). CategoryListCard doesn't render
            // it today — carried through for parity with the slideup path
            // and any future card-side consumer, same status as the other
            // passthrough fields on CorridorPlace.
            priceTier: rich.priceTier ?? t.priceTier,
          }
        : t;
    });

  // Day hero: prefer the persisted (Wikipedia) image; if absent (remote parks
  // have no wiki image), REUSE the tile hydration already fetched for this day —
  // the destination place's Google photo sits in `hydrated`, so one fetch feeds
  // both tiles and the hero. Degrades to blank when the destination has no
  // placeId or hasn't hydrated yet (no flash/crash — fills on the next render).
  const heroFor = (d: Day): string | undefined => {
    const heroCities = d.corridorCities ?? fallbackCorridor(d);
    const heroEndCity = heroCities[heroCities.length - 1];
    const destTile = heroEndCity
      ? placePool(d).find((t) =>
          isSameAnchorPlace(
            { id: t.id, name: t.title, coords: t.coords },
            { id: heroEndCity.id, name: heroEndCity.name, coords: heroEndCity.coords },
          ),
        )
      : undefined;
    return (
      d.heroImage ??
      (destTile?.placeId ? hydrated[destTile.placeId]?.photoUrl : undefined)
    );
  };

  // View-mode cities for ONE mounted day. Mirrors `effectiveCities` (the
  // single-day path) exactly, on that day's spine: un-bake places whose SERVER
  // override was locally removed (an unpin — base still carries it baked, so
  // dropping the override alone wouldn't move it), then apply the optimistic
  // override list.
  //
  // DEVIATION FROM THE BUILD SPEC, deliberate (Adam's call, review round 2):
  // the spec said pass server truth (`trip.placeOverrides`/`placeRanks`) with no
  // optimistic layer. Doing so made a just-made pin visibly snap back on leaving
  // edit mode, because `main` renders the optimistic list here — a user-visible
  // behaviour change this presentation-only PR should not introduce. So the
  // stack passes the OPTIMISTIC trip-level values for parity with `main`. The
  // Claim-2 principle is intact: these are still trip-level VALUES; no machinery
  // crosses (handlers stay undefined, `editMode={false}`). REVERT THIS TO SERVER
  // TRUTH once the seed-id pin fix lands — see docs/BACKLOG.md.
  const viewCities = (d: Day): CorridorCity[] => {
    const base = d.corridorCities;
    if (!base) return fallbackCorridor(d);
    const removed = new Set(
      serverOverrides
        .filter((so) => !localOverrides.some((lo) => lo.placeId === so.placeId))
        .map((so) => so.placeId),
    );
    const stripped = removed.size
      ? base.map((c) => ({ ...c, placeIds: c.placeIds.filter((pid) => !removed.has(pid)) }))
      : base;
    return applyPlaceOverrides({ cities: stripped, overrides: localOverrides });
  };

  const dayStartMileForId = (id: string): number => {
    const idx = trip.days.findIndex((d) => d.id === id);
    return idx >= 0 ? dayStartMiles(trip.days)[idx] : 0;
  };

  // One mounted day in the continuous VIEW stack. VALUES cross the bridge
  // (trip-level overrides/ranks, optimistic — see `viewCities` for why); the
  // MACHINERY does NOT — editMode is false and the move/reorder handlers are
  // absent (optimistic edit machinery is deferred to PR2).
  const renderViewDay = (d: Day) => (
    <div className="relative">
      {canEdit && (
        <div className="absolute top-3 right-3 z-20">
          <KebabMenu
            triggerLabel={`Day ${d.dayNumber} options`}
            items={buildDayMenuItems(d)}
          />
        </div>
      )}
      <DayDetailCorridor
        dayLabel={`Day ${d.dayNumber} — ${formatDayDate(d.date)}`}
        dayNumber={d.dayNumber}
        routeLabel={d.label}
        heroImageUrl={heroFor(d)}
        heroAlt={d.label}
        cities={viewCities(d)}
        places={hydratePlaces(d)}
        onRemovePlace={(id) => removePlaceFor(d, id)}
        onOpenPlace={(id) => dispatchPlaceDetail(d, id)}
        onExploreDay={() => openBrowseFor(d)}
        briefing={trip.generated ? <DayBriefingCard day={d} /> : undefined}
        editMode={false}
        restDay={isRestDay(d)}
        placeOverrides={localOverrides}
        dayMiles={d.miles}
        dayDriveHours={d.driveHours}
        routeLine={routeLine}
        dayStartMile={dayStartMileForId(d.id)}
        ranks={ranksMap}
        buildCuratedMenu={(p) => buildCuratedMenuFor(d, p)}
        focusedId={focusedId}
      />
    </div>
  );

  const overviewEl = (
    <DayDetailOverview
      routeLabel={`${trip.startLocation} → ${trip.endLocation}`}
      heroImageUrl={trip.heroImage}
      heroAlt={trip.title}
      guidesSubtitle={`Created by the yoTrippin Staff: ${trip.startLocation} → ${trip.endLocation}`}
      guides={OVERVIEW_GUIDES}
      foodThread={trip.foodThread}
      placesSubtitle={`Across your route · ${trip.startLocation} → ${trip.endLocation}`}
      places={topPlacesForTrip(trip)}
      onOpenPlace={openTripPlaceDetail}
      addPlaceholder
    />
  );

  return (
    <div className="relative h-full">
      {splitPickerDay && splitElig && (
        <SplitPointPicker
          open
          onOpenChange={(o) => {
            if (!o) setSplitPickerDay(null);
          }}
          dayLabel={`Day ${splitPickerDay.dayNumber} — ${splitPickerDay.label}`}
          dayMiles={splitElig.dayMiles}
          candidates={splitElig.candidates}
          onPick={(point) => {
            const d = splitPickerDay;
            setSplitPickerDay(null);
            runDayAction(() => splitDayAction(trip.id, d.id, point));
          }}
        />
      )}
      {curatedError && (
        <div
          role="alert"
          className="absolute left-3 right-3 z-40 flex items-start"
          style={{
            bottom: 12,
            gap: 8,
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--danger, #b3452f)",
            backgroundColor: "color-mix(in srgb, var(--danger, #b3452f) 16%, var(--bg-card))",
          }}
        >
          <span
            style={{
              flex: 1,
              fontFamily: "var(--ff-sans)",
              fontSize: 13,
              lineHeight: "17px",
              color: "var(--text-primary)",
            }}
          >
            {curatedError}
          </span>
          <button
            type="button"
            onClick={() => setCuratedError(null)}
            aria-label="Dismiss error"
            className="shrink-0"
            style={{ color: "var(--text-muted)", padding: 1, fontSize: 13 }}
          >
            ✕
          </button>
        </div>
      )}
      <div
        className={
          "relative h-full" +
          (isPending ? " opacity-60 pointer-events-none" : "")
        }
      >
        {selectedDayId === null || !day ? (
          // Overview state (or a stale ?day= that matches no day).
          <div className="h-full overflow-y-auto no-scrollbar">{overviewEl}</div>
        ) : editMode ? (
          // Single-day edit swap — the VERBATIM pre-continuous render, kept as the
          // bridge until edit mode moves inside the windowed container (PR2). Its
          // optimistic overlays (localOverrides/ranksMap/moveError) are correct
          // only for the one selected day, which is all edit mode ever shows.
          <div className="h-full overflow-y-auto no-scrollbar">
            <DayDetailCorridor
              dayLabel={`Day ${day.dayNumber} — ${formatDayDate(day.date)}`}
              dayNumber={day.dayNumber}
              routeLabel={day.label}
              heroImageUrl={heroFor(day)}
              heroAlt={day.label}
              cities={effectiveCities ?? fallbackCorridor(day)}
              places={hydratePlaces(day)}
              onRemovePlace={removePlace}
              onOpenPlace={openPlaceDetail}
              onExploreDay={openBrowse}
              briefing={trip.generated ? <DayBriefingCard day={day} /> : undefined}
              editMode={editMode}
              placeOverrides={localOverrides}
              dayMiles={day.miles}
              dayDriveHours={day.driveHours}
              routeLine={routeLine}
              dayStartMile={dayStartMile}
              onMovePlace={editMode ? onMovePlace : undefined}
              ranks={ranksMap}
              onReorderPlace={editMode ? onReorderPlace : undefined}
              pendingPlaceId={pendingPlaceId}
              errorPlaceId={moveError?.placeId ?? null}
              errorMessage={moveError?.message ?? null}
              onDismissError={() => setMoveError(null)}
              buildCuratedMenu={buildCuratedMenu}
              focusedId={focusedId}
            />
          </div>
        ) : (
          // Continuous VIEW scroll — the river of days (Design A). One shared map
          // and rail underneath; this is the only surface that becomes seamless.
          <ContinuousDayStack
            days={trip.days}
            selectedDayId={selectedDayId}
            renderDay={renderViewDay}
            estimateHeight={(d) => estimateDayHeight(placePool(d).length)}
            onSettleDay={(id) => onSelectDay?.(id)}
            onMountedChange={setMountedIds}
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

      {/* Out-of-radius note — non-blocking: the pin LANDED; this just states the
       *  cost (a backtrack isn't wrong, it's expensive — price it, don't prevent
       *  it). Persists until dismissed or the next move. */}
      {moveNote && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center"
          style={{
            top: 10,
            gap: 10,
            padding: "6px 10px 6px 14px",
            borderRadius: 8,
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--amber-dark)",
            color: "var(--text-primary)",
            fontFamily: "var(--ff-sans)",
            fontSize: 13,
            maxWidth: "90%",
          }}
        >
          <span>{moveNote}</span>
          <button
            type="button"
            onClick={() => setMoveNote(null)}
            aria-label="Dismiss"
            className="shrink-0"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
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
export function fallbackCorridor(day: Day): CorridorCity[] {
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
export function placePool(day: Day): CorridorPlace[] {
  const fromSuggestions: CorridorPlace[] = (day.segmentSuggestions ?? []).map(
    (p) => ({
      id: p.id,
      title: p.title,
      category:
        p.category === "overnight" ? "camping" : (p.category ?? "interest"),
      photoUrl: p.photoUrl,
      photoCredit: p.photoCredit,
      photoAlt: p.photoAlt,
      rating: p.rating,
      reviewCount: p.reviewCount,
      // Corpus rows carry a google place_id → the day-select hydrate key.
      placeId: p.placeId,
      curated: p.curated,
      // segmentSuggestions are the overlay tiles the ⋮ kebab can move/delete
      // (geometry-free); waypoints and legacy day.suggestions are not.
      curatedMovable: true,
      milesFromStart: p.milesFromStart,
      coords: p.coords,
      keyStopNote: p.keyStopNote,
      isOvernight: p.isOvernight,
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
    coords: p.coords,
  }));
  const fromWaypoints: CorridorPlace[] = day.waypoints.map((wp) => ({
    id: wp.id,
    title: wp.title,
    category: wp.category,
    photoUrl: wp.photoUrl,
    photoAlt: wp.title,
    rating: wp.community?.rating,
    reviewCount: wp.community?.reviewCount,
    coords: wp.coords,
    removable: true,
  }));
  return [...fromSuggestions, ...fromDaySuggestions, ...fromWaypoints];
}
