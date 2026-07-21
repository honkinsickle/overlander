"use client";

/**
 * Edit-mode "City Block" render of a day (spec § node-stack model, Paper
 * artboard "Trip Edit— aligned v1-1"). A day is an ordered list of city NODES;
 * the DRIVE between two nodes is a CONTAINER holding the POIs whose position
 * falls within that stretch, in mile order, on a left mile-timeline gutter.
 * Replaces the mile-interleaved read spine for the edit surface only.
 *
 * Cluster membership (which node owns a POI) comes from the SERVER bucketing —
 * each `CorridorCity.placeIds`, which carries user pin overrides. Geometry only
 * positions the residual (a place in no cluster) into the drive stretches. See
 * assignPlacesToStretches' HYBRID MODE.
 *
 * POI positions (the gutter mile ticks) come from projecting each place's COORDS
 * onto the route (positionPlacesOnDay) — NOT the stored `milesFromStart`, which
 * is unreliable on current generated trips (~+589-mi foreign offset). This is a
 * render-time stopgap pending the day-coords persistence fix; see
 * lib/corridor/stretches.ts and docs/findings/2026-07-20-*.md.
 *
 * Scope: rendering only, edit-mode gated. Drag handles inert. Node = white dot
 * + city name (a place ON the road); POI = amber tick + mile, indented within
 * its stretch (a stop within the drive). Content-driven height. Off-corridor
 * places (offset > bufferMi) are the only thing in "Along the way".
 */
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { X } from "lucide-react";
import type { CorridorCity } from "@/lib/trips/types";
import type { LngLat } from "@/lib/routing/route-between";
import {
  positionPlacesOnDay,
  assignPlacesToStretches,
  type PositionedPlace,
} from "@/lib/corridor/stretches";
import { haversineMi } from "@/lib/routing/point-to-polyline";
import { insertRank } from "@/lib/corridor/place-rank";
import { computeInsertIndex } from "@/lib/corridor/insert-index";
import { CategoryListCard } from "@/components/trip/category-list-card";
import type { CorridorPlace } from "@/components/trip/day-detail-corridor";

const GUTTER_W = 48;
const noop = () => {};

/** Two coords within ~11 m — used to spot a round-trip day (start node == end
 *  node), where the fallback spine's endpoints coincide. */
function sameCoords(a?: [number, number], b?: [number, number]): boolean {
  return !!a && !!b && Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4;
}

/** A drag drop resolved to an intent. `toNodeId: null` = dropped on the drive
 *  → unpin (return to geometry). Otherwise pin the place under that node; the
 *  distance context lets the caller price an out-of-radius drop. */
export type PlaceMove = {
  placeId: string;
  toNodeId: string | null;
  /** Along-route miles between the place and the target node (pin only). */
  distanceMi?: number;
  nodeName?: string;
  placeName?: string;
};

/** Droppable id prefixes — parsed in onDragEnd to tell a node drop (pin) from a
 *  drive drop (unpin). */
const NODE = "node:";
const DRIVE = "drive:";

type Props = {
  cities: CorridorCity[];
  byId: Map<string, CorridorPlace>;
  /** Decoded trip route polyline — POIs project onto it for their position. */
  line: LngLat[];
  /** This day's cumulative start mile along the route (dayStartMiles[idx]). */
  dayStartMile: number;
  /** Day totals — label the whole-day drive on a 2-node day. */
  dayMiles?: number;
  dayDriveHours?: number;
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
  /** Wire the drag: a place dragged onto a node cluster pins it there; dragged
   *  onto the drive, unpins it. When absent, the grips stay inert. */
  onMovePlace?: (move: PlaceMove) => void;
  /** Authored per-place ranks (Trip.placeRanks) — order within a cluster. Feeds
   *  the sort; a place absent keeps its derived (mile / near→far) order. */
  ranks?: ReadonlyMap<string, number>;
  /** Reorder within a node's own cluster (same-node drop): the dragged place +
   *  the minimal rank writes from insertRank. Absent → reorder disabled. */
  onReorderPlace?: (placeId: string, rankWrites: Record<string, number>) => void;
  /** Placeid whose pin/unpin write is in flight — its card shows a saving cue. */
  pendingPlaceId?: string | null;
  /** Placeid whose last write FAILED — its card shows a persistent inline
   *  error (loud, not a toast) until dismissed. */
  errorPlaceId?: string | null;
  errorMessage?: string | null;
  onDismissError?: () => void;
};

export function DayDetailNodeBlocks({
  cities,
  byId,
  line,
  dayStartMile,
  dayMiles,
  dayDriveHours,
  onOpenPlace,
  onRemovePlace,
  editMode = true,
  onMovePlace,
  ranks,
  onReorderPlace,
  pendingPlaceId,
  errorPlaceId,
  errorMessage,
  onDismissError,
}: Props) {
  const { positioned, nodeClusters, stretches, alongTheWay } = useMemo(() => {
    // Node/card dedup happens upstream now (corridor/node-identity, applied in
    // resolveCorridorCities + bakeGeneratedDays), so this pool already excludes
    // any place that IS a node — no per-surface filtering here.
    const places = Array.from(byId.values());
    // Positions feed the gutter mile ticks for EVERY POI (clustered ones too),
    // and drive the geometric assignment of the residual below.
    const positioned = positionPlacesOnDay({ line, places, dayStartMile });
    // Round-trip day (out-and-back): start node == end node, so along-route mile
    // is degenerate and its sort is reversed (the spur projects onto the main
    // route backwards — summit first). Order the leg near→far by distance from
    // the anchor — the outbound drive sequence — until authored sequence exists.
    const anchor = cities[0]?.coords;
    const roundTrip =
      cities.length >= 2 && sameCoords(anchor, cities[cities.length - 1]?.coords);
    // Sort key per place: an AUTHORED rank wins; else near→far on a round-trip
    // day; else absent → the along-route mile (assignPlacesToStretches fallback).
    let orderKey: Map<string, number> | undefined;
    if ((ranks && ranks.size) || (roundTrip && anchor)) {
      orderKey = new Map();
      for (const p of places) {
        const r = ranks?.get(p.id);
        if (r !== undefined) orderKey.set(p.id, r);
        else if (roundTrip && anchor && p.coords)
          orderKey.set(p.id, haversineMi(p.coords, anchor));
      }
    }
    // HYBRID: cluster membership is the server's bucketing (cities[].placeIds),
    // which carries user pin overrides (applyPlaceOverrides) — pure geometry
    // can't see those. Geometry only positions the residual (a place in no
    // server cluster) into the drive stretches / Along the way. On a fallback
    // day with empty placeIds, every place is residual → prior behavior.
    const { nodeClusters, stretches, alongTheWay } = assignPlacesToStretches({
      nodeMiles: cities.map((c) => c.milesFromStart),
      positioned,
      serverClusters: cities.map((c) => c.placeIds),
      orderKey,
    });
    return { positioned, nodeClusters, stretches, alongTheWay };
  }, [byId, line, dayStartMile, cities, ranks]);

  // ── Drag-to-repin (edit mode) ──────────────────────────────────────────
  const dndEnabled = !!onMovePlace;
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities]);
  // Per-cluster card element registry (placeId → DOM node), read at drop time to
  // measure sibling rects for the insertion index. Never cached across drags.
  const cardRefs = useRef(new Map<string, HTMLElement>());
  // Stable identity so PoiRow's merged ref callback doesn't churn each render
  // (a churning ref nulls the dnd node mid-activation and aborts the drag).
  const registerCard = useCallback((placeId: string, el: HTMLElement | null) => {
    if (el) cardRefs.current.set(placeId, el);
    else cardRefs.current.delete(placeId);
  }, []);
  // The node a place currently clusters under (server/optimistic placeIds), or
  // -1 if it's mid-drive — used to no-op a drop back onto the same node.
  const currentNodeId = (placeId: string): string | null => {
    const i = nodeClusters.findIndex((ids) => ids.includes(placeId));
    return i >= 0 ? cities[i].id : null;
  };
  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    if (!onMovePlace) return;
    const placeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    if (overId.startsWith(DRIVE)) {
      // Dropped on the drive: unpin. If the place had no override this is a
      // no-op (it was already at its geometry position) — the caller elides it.
      onMovePlace({ placeId, toNodeId: null });
      return;
    }
    if (overId.startsWith(NODE)) {
      const nodeId = overId.slice(NODE.length);
      if (currentNodeId(placeId) === nodeId) {
        // Same node → REORDER within its cluster (sequence, not attachment).
        // Display order is the rendered cluster (DOM order); the insert index
        // comes from the drop pointer vs sibling midpoints; insertRank turns
        // (finalOrder, index) into the minimal rank writes.
        const nodeIdx = cities.findIndex((c) => c.id === nodeId);
        const displayOrder = nodeClusters[nodeIdx] ?? [];
        const tr = e.active.rect.current.translated;
        if (!onReorderPlace || displayOrder.length < 2 || !tr) return;
        const els = displayOrder.map((id) => cardRefs.current.get(id));
        if (els.some((el) => !el)) return; // can't measure reliably — bail
        const rects = els.map((el) => (el as HTMLElement).getBoundingClientRect());
        const selfIndex = displayOrder.indexOf(placeId);
        const insertIndex = computeInsertIndex(
          rects,
          tr.top + tr.height / 2,
          selfIndex >= 0 ? selfIndex : null,
        );
        const withoutSelf = displayOrder.filter((id) => id !== placeId);
        const finalOrder = [
          ...withoutSelf.slice(0, insertIndex),
          placeId,
          ...withoutSelf.slice(insertIndex),
        ];
        const writes = insertRank(finalOrder, insertIndex, ranks ?? new Map());
        if (writes.size) onReorderPlace(placeId, Object.fromEntries(writes));
        return;
      }
      const pos = positioned.get(placeId);
      const node = cityById.get(nodeId);
      const distanceMi =
        pos && node ? Math.abs(pos.dayMile - node.milesFromStart) : 0;
      onMovePlace({
        placeId,
        toNodeId: nodeId,
        distanceMi,
        nodeName: node?.name,
        placeName: byId.get(placeId)?.title,
      });
    }
  };
  const draggedPlace = dragId ? byId.get(dragId) : undefined;

  // Shared per-POI props threaded to every draggable card.
  const poiCtx = {
    onOpenPlace,
    onRemovePlace,
    editMode,
    dndEnabled,
    registerCard,
    pendingPlaceId,
    errorPlaceId,
    errorMessage,
    onDismissError,
  };

  // Whole-day dwell (2 coincident nodes, 0-mi "drive"): collapse to one node
  // with its places beneath — no duplicate header, no "0 mi drive" connector.
  const isDwell =
    cities.length === 2 &&
    cities[0].milesFromStart === cities[cities.length - 1].milesFromStart;

  const orphanCards = alongTheWay
    .map((id) => byId.get(id))
    .filter(Boolean) as CorridorPlace[];

  // The spine, wrapped so drop targets + drag overlay live under one context.
  const shell = (children: React.ReactNode) =>
    dndEnabled ? (
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragId(null)}
      >
        {children}
        <DragOverlay>
          {draggedPlace ? (
            <CategoryListCard
              place={draggedPlace}
              category={draggedPlace.category}
              status={draggedPlace.keyStopNote}
              editMode
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    ) : (
      <>{children}</>
    );

  if (isDwell) {
    // One place, one location — everything hangs under the single node. The
    // whole block is one node drop target; no drive on a 0-mi day.
    const clusterIds = [
      ...nodeClusters.flat(),
      ...stretches.flatMap((s) => s.placeIds),
    ];
    return shell(
      <div className="flex flex-col" style={{ paddingTop: 16 }}>
        <DroppableRegion id={`${NODE}${cities[0].id}`} disabled={!dndEnabled}>
          <NodeHeaderRow city={cities[0]} last={clusterIds.length === 0} />
          {clusterIds.map((id, j) => (
            <PoiRow key={id} placeId={id} place={byId.get(id)} pos={positioned.get(id)} last={j === clusterIds.length - 1} {...poiCtx} />
          ))}
        </DroppableRegion>
        {orphanCards.length > 0 && (
          <AlongTheWay places={orphanCards} onOpenPlace={onOpenPlace} editMode={editMode} />
        )}
      </div>,
    );
  }

  return shell(
    <div className="flex flex-col" style={{ paddingTop: 16 }}>
      {cities.map((city, i) => {
        const next = cities[i + 1];
        const clusterIds = nodeClusters[i] ?? [];
        const stretchIds = next ? stretches[i]?.placeIds ?? [] : [];
        // The rail terminates on the final node's last cluster card (nothing
        // renders on the rail after the last node).
        const clusterLast = (j: number) =>
          !next && j === clusterIds.length - 1;
        return (
          <Fragment key={`${city.id}-${city.kind}-${i}`}>
            {/* The node + its arrival cluster is one drop target (pin here). */}
            <DroppableRegion id={`${NODE}${city.id}`} disabled={!dndEnabled}>
              <NodeHeaderRow city={city} last={!next && clusterIds.length === 0} />
              {clusterIds.map((id, j) => (
                <PoiRow key={id} placeId={id} place={byId.get(id)} pos={positioned.get(id)} last={clusterLast(j)} {...poiCtx} />
              ))}
            </DroppableRegion>
            {next && (
              // The drive is one drop target (drop here to unpin → geometry).
              <DroppableRegion id={`${DRIVE}${i}`} disabled={!dndEnabled}>
                <StretchContainer
                  miles={Math.round(next.milesFromStart - city.milesFromStart)}
                  hours={cities.length === 2 ? dayDriveHours : undefined}
                  wholeDayMiles={cities.length === 2 ? dayMiles : undefined}
                  placeIds={stretchIds}
                  byId={byId}
                  positioned={positioned}
                  isLast={i === cities.length - 2}
                  poiCtx={poiCtx}
                />
              </DroppableRegion>
            )}
          </Fragment>
        );
      })}
      {orphanCards.length > 0 && (
        <AlongTheWay places={orphanCards} onOpenPlace={onOpenPlace} editMode={editMode} />
      )}
    </div>,
  );
}

/** A drop zone: a node cluster (pin here) or a drive stretch (unpin here). The
 *  amber wash on hover reads as "this is where it'll land." */
function DroppableRegion({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className="flex flex-col"
      style={
        isOver
          ? {
              borderRadius: 8,
              outline: "1.5px solid var(--amber)",
              outlineOffset: -1,
              backgroundColor: "color-mix(in srgb, var(--amber) 9%, transparent)",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/** Fixed 48px gutter (optional mile tick + dot + connector) beside content. */
function RailRow({
  mile,
  mileColor = "var(--timeline-active)",
  dot = true,
  dotColor = "var(--timeline-active)",
  dotSize = 6,
  last = false,
  gap = 14,
  lineFromTop = false,
  children,
}: {
  mile?: string | null;
  mileColor?: string;
  dot?: boolean;
  dotColor?: string;
  dotSize?: number;
  last?: boolean;
  gap?: number;
  lineFromTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex" style={{ paddingBottom: last ? 0 : gap }}>
      <div className="relative shrink-0" style={{ width: GUTTER_W }}>
        {mile != null && (
          <span
            className="absolute"
            style={{
              top: 1,
              left: 4,
              fontFamily: "var(--ff-mono)",
              fontSize: 12,
              lineHeight: "16px",
              letterSpacing: "-0.02em",
              color: mileColor,
            }}
          >
            {mile}
          </span>
        )}
        <div
          className="absolute"
          style={{ left: 10, top: lineFromTop ? 0 : 22, bottom: last ? undefined : -gap, width: 6 }}
        >
          {dot && (
            <div
              style={{
                width: dotSize,
                height: dotSize,
                marginLeft: dotSize > 6 ? -1 : 0,
                borderRadius: 100,
                backgroundColor: dotColor,
              }}
            />
          )}
          {!last && (
            <div
              className="absolute"
              style={{
                top: dot ? dotSize : 0,
                left: 2.5,
                bottom: 0,
                width: 1,
                backgroundColor: "var(--timeline-inactive)",
              }}
            />
          )}
        </div>
      </div>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

/** A city node: white dot + mile + bold city name + explore link. A place ON
 *  the road (distinct from a POI, which is a stop within the drive). */
function NodeHeaderRow({ city, last }: { city: CorridorCity; last: boolean }) {
  const mileLabel = city.kind === "start" ? "Start" : `${Math.round(city.milesFromStart)}mi`;
  return (
    <RailRow mile={mileLabel} last={last}>
      <div className="flex flex-col" style={{ gap: 3, paddingBottom: 2 }}>
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontWeight: 700,
            fontSize: 22,
            lineHeight: "26px",
            color: "var(--text-primary)",
          }}
        >
          {city.name}
        </span>
        <button
          type="button"
          onClick={noop}
          className="self-start"
          style={{ fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "18px", color: "var(--text-muted)" }}
        >
          Explore more {city.name} →
        </button>
      </div>
    </RailRow>
  );
}

/** Per-POI wiring threaded to every draggable card (spread from poiCtx). */
type PoiCtx = {
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
  dndEnabled?: boolean;
  /** Register the card's DOM node for drop-time rect measurement. */
  registerCard?: (placeId: string, el: HTMLElement | null) => void;
  pendingPlaceId?: string | null;
  errorPlaceId?: string | null;
  errorMessage?: string | null;
  onDismissError?: () => void;
};

/** One POI within a stretch: amber tick + its day-relative mile + card. In edit
 *  mode the card is draggable by its grip (pin/unpin); a saving cue while its
 *  write is in flight, a persistent inline error if it failed. */
function PoiRow({
  placeId,
  place,
  pos,
  last,
  onOpenPlace,
  onRemovePlace,
  editMode,
  dndEnabled,
  registerCard,
  pendingPlaceId,
  errorPlaceId,
  errorMessage,
  onDismissError,
}: {
  placeId: string;
  place?: CorridorPlace;
  pos?: PositionedPlace;
  last: boolean;
} & PoiCtx) {
  // Hook order stays stable across a missing byId lookup — id is always known.
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: placeId,
    disabled: !dndEnabled,
  });
  // Merge the dnd node ref with the card registry (drop-time rect measurement).
  // Stable identity (deps are all stable) so it doesn't churn the node ref each
  // render — a churning ref nulls the draggable mid-activation and aborts drags.
  const setRefs = useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el);
      registerCard?.(placeId, el);
    },
    [setNodeRef, registerCard, placeId],
  );
  if (!place) return null;
  const pending = pendingPlaceId === placeId;
  const errored = errorPlaceId === placeId;
  return (
    <RailRow
      mile={pos ? `${Math.max(0, Math.round(pos.dayMile))}mi` : null}
      mileColor="var(--amber)"
      dot={!!pos}
      dotColor="var(--amber)"
      dotSize={8}
      last={last}
    >
      <div ref={setRefs} style={{ opacity: isDragging ? 0.4 : 1 }}>
        <div style={pending ? { opacity: 0.55, transition: "opacity 120ms" } : undefined}>
          <CategoryListCard
            place={place}
            category={place.category}
            status={place.keyStopNote}
            onOpen={onOpenPlace ? () => onOpenPlace(place.id) : noop}
            onRemove={place.removable && onRemovePlace ? () => onRemovePlace(place.id) : undefined}
            editMode={editMode}
            gripHandleProps={dndEnabled ? { ...attributes, ...listeners } : undefined}
          />
        </div>
        {errored && errorMessage && (
          <InlineError message={errorMessage} onDismiss={onDismissError} />
        )}
      </div>
    </RailRow>
  );
}

/** Loud, persistent write-failure banner pinned to the affected card (NOT a
 *  toast that scrolls away). Stays until dismissed. */
function InlineError({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start"
      style={{
        marginTop: 6,
        gap: 8,
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--danger, #b3452f)",
        backgroundColor: "color-mix(in srgb, var(--danger, #b3452f) 14%, transparent)",
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
        {message}
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0"
          style={{ color: "var(--text-muted)", padding: 1 }}
        >
          <X size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** The drive between two nodes, as a container: a labeled header ("↓ 264 mi ·
 *  5.2 hr drive"), then its POIs in mile order. Content-driven height (NOT
 *  scaled to miles). */
function StretchContainer({
  miles,
  hours,
  wholeDayMiles,
  placeIds,
  byId,
  positioned,
  isLast,
  poiCtx,
}: {
  miles: number;
  hours?: number;
  wholeDayMiles?: number;
  placeIds: string[];
  byId: Map<string, CorridorPlace>;
  positioned: Map<string, PositionedPlace>;
  isLast: boolean;
  poiCtx: PoiCtx;
}) {
  const mi = wholeDayMiles ?? miles;
  const label = hours != null ? `↓  ${mi} mi · ${hours} hr drive` : `↓  ${mi} mi drive`;
  return (
    <>
      <RailRow dot={false} lineFromTop gap={12}>
        <div style={{ paddingTop: 8, paddingBottom: placeIds.length ? 4 : 8 }}>
          <span
            style={{
              fontFamily: "var(--ff-mono)",
              fontSize: 12,
              lineHeight: "16px",
              letterSpacing: "0.02em",
              color: "var(--text-muted)",
            }}
          >
            {label}
          </span>
        </div>
      </RailRow>
      {placeIds.map((id) => (
        <PoiRow
          key={id}
          placeId={id}
          place={byId.get(id)}
          pos={positioned.get(id)}
          // The last POI of the last stretch terminates the rail (next node
          // header follows otherwise).
          last={false}
          {...poiCtx}
        />
      ))}
    </>
  );
}

/** Off-rail tail for OFF-CORRIDOR places (offset > bufferMi) — a place you
 *  genuinely detour to, not a stop on the drive. Empty on every day of the
 *  current trip; kept for correctness. */
function AlongTheWay({
  places,
  onOpenPlace,
  editMode,
}: {
  places: CorridorPlace[];
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  return (
    <div className="flex flex-col" style={{ paddingTop: 20, paddingLeft: GUTTER_W, gap: 10 }}>
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--ff-display)",
          fontSize: 11,
          lineHeight: "14px",
          letterSpacing: "0.16em",
          color: "var(--text-muted)",
        }}
      >
        Along the way
      </span>
      <div className="flex flex-col" style={{ gap: 8 }}>
        {places.map((p) => (
          <CategoryListCard
            key={p.id}
            place={p}
            category={p.category}
            status={p.keyStopNote}
            onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
            editMode={editMode}
          />
        ))}
      </div>
    </div>
  );
}
