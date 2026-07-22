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
  type DragMoveEvent,
} from "@dnd-kit/core";
import { X } from "lucide-react";
import type { CorridorCity } from "@/lib/trips/types";
import type { LngLat } from "@/lib/routing/route-between";
import {
  positionPlacesOnDay,
  assignPlacesToStretches,
  scopeRankKey,
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
  /** Authored order for the TARGET cluster (cross-node pin dropped at a
   *  position): node-scoped rank writes, committed with the pin in one action so
   *  the target is never left partially ranked. Absent when the drop had no
   *  orderable target (empty/unmeasurable cluster). */
  rankWrites?: Record<string, { nodeId: string; rank: number }>;
};

/** Droppable id prefixes — parsed in onDragEnd to tell a node drop (pin) from a
 *  drive drop (unpin). */
const NODE = "node:";
const DRIVE = "drive:";

/** The dragged card's current vertical midpoint, in VIEWPORT coordinates — read
 *  from `active.rect.current.translated` (the initial rect with the live drag
 *  transform applied). This is the right space to compare against the siblings'
 *  getBoundingClientRect, which are also viewport coords. NOT `initial + delta`:
 *  dnd-kit's `delta` folds in container auto-scroll, so `initial + delta` diverges
 *  from the on-screen position the moment the list scrolls mid-drag (verified —
 *  under scroll the two produced DIFFERENT insert slots). `translated` is the
 *  on-screen truth, and the same value onDragMove (the live line) and onDragEnd
 *  (the drop) both feed to computeInsertIndex, so they can't disagree. Null before
 *  measured. onDragMove fires per move, so it stays live (the freeze was onDragOver
 *  firing only on droppable change, not `translated` lagging). */
function draggedMidY(e: DragMoveEvent | DragEndEvent): number | null {
  const tr = e.active.rect.current.translated;
  return tr ? tr.top + tr.height / 2 : null;
}

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
  /** Authored per-place ranks (Trip.placeRanks) — node-scoped order. Feeds the
   *  cluster sort; a place whose rank is for a DIFFERENT node is treated as
   *  unranked here (scoping is applied when building rankKey below). */
  ranks?: ReadonlyMap<string, { nodeId: string; rank: number }>;
  /** Reorder within a node's own cluster (same-node drop): the dragged place +
   *  the node-scoped rank writes from insertRank. Absent → reorder disabled. */
  onReorderPlace?: (
    placeId: string,
    rankWrites: Record<string, { nodeId: string; rank: number }>,
  ) => void;
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
    // CLUSTER order (rankKey): a place's authored rank is honored ONLY in the
    // cluster its rank was scoped to (scopeRankKey walks server placeIds and keeps
    // a rank only when entry.nodeId === c.id) — the shared scoping the read spine
    // uses too, so a place carrying another node's rank is omitted on every surface.
    const rankKey = scopeRankKey(cities, ranks);
    // STRETCH/residual order (orderKey): near→far on a round-trip day only — a
    // SEPARATE map from rankKey (different unit; the two never sort one cluster).
    let orderKey: Map<string, number> | undefined;
    if (roundTrip && anchor) {
      orderKey = new Map();
      for (const p of places) if (p.coords) orderKey.set(p.id, haversineMi(p.coords, anchor));
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
      rankKey,
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
  // Insertion-indicator state: which cluster + slot a drop will land in, so a 2px
  // line can show the target. On a touch surface the finger covers the card, so
  // snap-on-drop alone gives no pre-drop feedback. { clusterId (=nodeId),
  // insertIndex } | null; cleared on drag end and cancel.
  const [dropIndicator, setDropIndicator] =
    useState<{ clusterId: string; insertIndex: number } | null>(null);
  // The ONE insert-index derivation — shared by the live indicator (onDragOver)
  // and the authored drop (onDragEnd/computeRankWrites). Same computeInsertIndex
  // call, same selfIndex rule: same-node → exclude the dragged card (still in the
  // DOM), cross-node → null. Returns null when unmeasurable. Stable identity:
  // onDragOver fires constantly and an unstable handler would churn dnd-kit's node
  // ref mid-drag (the Step-2 failure).
  const computeInsertAt = useCallback(
    (targetNodeId: string, activeId: string, pointerY: number | null): number | null => {
      const nodeIdx = cities.findIndex((c) => c.id === targetNodeId);
      if (nodeIdx < 0 || pointerY === null) return null;
      const cluster = nodeClusters[nodeIdx] ?? [];
      const els = cluster.map((id) => cardRefs.current.get(id));
      if (els.some((el) => !el)) return null; // unmeasurable
      const rects = els.map((el) => (el as HTMLElement).getBoundingClientRect());
      const selfIndex = cluster.indexOf(activeId); // ≥0 same-node, -1 cross-node
      return computeInsertIndex(rects, pointerY, selfIndex >= 0 ? selfIndex : null);
    },
    [cities, nodeClusters],
  );
  // Track the target slot on EVERY pointer move. onDragMove — NOT onDragOver,
  // which fires only when the droppable under the pointer changes, so it can't
  // follow the pointer between cards inside one cluster. Only a NODE cluster gets
  // an indicator; the drive/unpin droppable is attachment, not sequence. Return
  // the same state ref when unchanged so React bails out (no re-render per move).
  // Stable (useCallback): it fires constantly, and an unstable handler would
  // churn dnd-kit's node ref mid-drag (the Step-2 failure).
  const onDragMove = useCallback(
    (e: DragMoveEvent) => {
      const overId = e.over ? String(e.over.id) : null;
      if (!overId || !overId.startsWith(NODE)) {
        setDropIndicator((prev) => (prev === null ? prev : null));
        return;
      }
      const nodeId = overId.slice(NODE.length);
      const idx = computeInsertAt(nodeId, String(e.active.id), draggedMidY(e));
      setDropIndicator((prev) => {
        if (idx === null) return prev === null ? prev : null;
        if (prev && prev.clusterId === nodeId && prev.insertIndex === idx) return prev;
        return { clusterId: nodeId, insertIndex: idx };
      });
    },
    [computeInsertAt],
  );
  // The node a place currently clusters under (server/optimistic placeIds), or
  // -1 if it's mid-drive — used to no-op a drop back onto the same node.
  const currentNodeId = (placeId: string): string | null => {
    const i = nodeClusters.findIndex((ids) => ids.includes(placeId));
    return i >= 0 ? cities[i].id : null;
  };
  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    setDropIndicator(null);
    if (!onMovePlace) return;
    const placeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    // Rank writes to land `placeId` at its drop position within a target
    // cluster (used by same-node reorder AND cross-node pin). Display order is
    // the rendered cluster (DOM order); the insert index comes from the drop
    // pointer vs sibling midpoints. If the cluster already contains placeId
    // (same-node) it's excluded via selfIndex; if not (cross-node) it's the
    // incoming newcomer — insertRank materializes from the TARGET's order either
    // way. Returns undefined when there's nothing orderable (empty/1-card
    // target) or the rects can't be measured.
    const computeRankWrites = (
      targetNodeId: string,
    ): Record<string, { nodeId: string; rank: number }> | undefined => {
      const nodeIdx = cities.findIndex((c) => c.id === targetNodeId);
      if (nodeIdx < 0) return undefined;
      const cluster = nodeClusters[nodeIdx] ?? [];
      // Same derivation the live indicator uses — ONE source, so the line and the
      // landed position can't disagree.
      const insertIndex = computeInsertAt(targetNodeId, placeId, draggedMidY(e));
      if (insertIndex === null) return undefined; // unmeasurable — skip authoring
      const withoutSelf = cluster.filter((id) => id !== placeId);
      const finalOrder = [
        ...withoutSelf.slice(0, insertIndex),
        placeId,
        ...withoutSelf.slice(insertIndex),
      ];
      if (finalOrder.length < 2) return undefined; // nothing to order
      // Scope the ranks fed to insertRank to the TARGET node — a member carrying
      // another node's rank reads as unranked, so insertRank materializes it in.
      const scoped = new Map<string, number>();
      for (const id of finalOrder) {
        const entry = ranks?.get(id);
        if (entry && entry.nodeId === targetNodeId) scoped.set(id, entry.rank);
      }
      const writes = insertRank(finalOrder, insertIndex, scoped);
      if (!writes.size) return undefined;
      // Stamp the target nodeId on every write (materialization writes the whole
      // cluster; a fractional insert writes one — both get scoped here).
      const out: Record<string, { nodeId: string; rank: number }> = {};
      writes.forEach((rank, id) => {
        out[id] = { nodeId: targetNodeId, rank };
      });
      return out;
    };
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
        const writes = computeRankWrites(nodeId);
        if (onReorderPlace && writes) onReorderPlace(placeId, writes);
        return;
      }
      // Cross-node → PIN, AND author the drop position in the TARGET cluster so
      // it's never left partially ranked (attachment + rank commit together).
      const rankWrites = computeRankWrites(nodeId);
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
        rankWrites,
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

  // Where the insert line falls in a cluster's RENDERED rows. dropIndicator holds
  // insertIndex in the "without dragged card" space (exactly as the drop path
  // computes it); map it to the id the line should precede, or {atEnd} for the
  // tail / an empty cluster. No optimistic reorder — the cards never move.
  const indicatorFor = (nodeId: string, clusterIds: string[]) => {
    if (!dropIndicator || dropIndicator.clusterId !== nodeId) return null;
    const withoutSelf = dragId ? clusterIds.filter((id) => id !== dragId) : clusterIds;
    const i = Math.max(0, Math.min(dropIndicator.insertIndex, withoutSelf.length));
    return i >= withoutSelf.length
      ? { atEnd: true, beforeId: null as string | null }
      : { atEnd: false, beforeId: withoutSelf[i] };
  };
  // Render a cluster's PoiRows with the insert line spliced into the target gap.
  const clusterRows = (
    nodeId: string,
    clusterIds: string[],
    lastFn: (j: number) => boolean,
  ): React.ReactNode[] => {
    const ind = indicatorFor(nodeId, clusterIds);
    const rows: React.ReactNode[] = [];
    clusterIds.forEach((id, j) => {
      if (ind && !ind.atEnd && ind.beforeId === id) rows.push(<InsertLine key={`ins-${nodeId}`} />);
      rows.push(
        <PoiRow key={id} placeId={id} place={byId.get(id)} pos={positioned.get(id)} last={lastFn(j)} {...poiCtx} />,
      );
    });
    if (ind && ind.atEnd) rows.push(<InsertLine key={`ins-${nodeId}-end`} />);
    return rows;
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
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragId(null);
          setDropIndicator(null);
        }}
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
          {clusterRows(cities[0].id, clusterIds, (j) => j === clusterIds.length - 1)}
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
              {clusterRows(city.id, clusterIds, clusterLast)}
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

/** The insertion indicator: a 2px amber line in the gap where the dragged card
 *  will land. A zero-height wrapper so it never shifts the cards; the line is
 *  absolutely positioned into the gap, aligned with the card content (past the
 *  gutter). pointer-events off so it can't interfere with the drag. */
function InsertLine() {
  return (
    <div aria-hidden className="relative" style={{ height: 0 }}>
      <div
        style={{
          position: "absolute",
          left: GUTTER_W,
          right: 0,
          top: -1,
          height: 2,
          borderRadius: 1,
          backgroundColor: "var(--amber)",
          pointerEvents: "none",
        }}
      />
    </div>
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
