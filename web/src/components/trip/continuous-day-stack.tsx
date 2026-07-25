"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Day } from "@/lib/trips/types";
import { pickCenteredDay, type DaySlotSpan } from "@/lib/trips/continuous-scroll";

/**
 * Continuous day-detail scroll (Design A) — the PRESENTATION LAYER that turns
 * the one-day-at-a-time swap into a river of days. It mounts nothing of the
 * model: each day's content is produced by the parent's `renderDay` render-prop
 * (server-truth values, view mode only — the parent gates edit mode out before
 * choosing this path). The stack only decides WHICH days are in the DOM, keeps
 * the scroll from jumping, and writes `?day=` on settle.
 *
 * What it owns (all view-only):
 *  - IntersectionObserver mount/unmount with an off-screen buffer, so a day is
 *    already mounted + measured by the time it scrolls into view (no pop-in).
 *  - A never-mounted height ESTIMATE and a measured-height CACHE (ResizeObserver,
 *    a ref not state) so unmounted placeholders hold their space — nothing jumps.
 *  - A continuously-updated centered-day ref (no fan-out) feeding hysteresis.
 *  - A settle-debounced `?day=` write with a max-wait ceiling, so the map/rail
 *    follow the reader without strobing, and a slow continuous scroll can't park
 *    the map on a stale day.
 *  - Rail-click / external `?day=` changes → scroll that day to the top, guarded
 *    so the scroll observer doesn't fight the programmatic scroll.
 *  - A flush on unmount so toggling into edit mode mid-scroll lands the single-day
 *    swap on the day the reader was actually looking at.
 */

/** Debounce after the last scroll event before we commit `?day=` (one fan-out). */
const SETTLE_MS = 140;
/** Ceiling: under slow *continuous* scroll the debounce never fires, so flush
 *  after this long regardless — otherwise the map parks on a stale day while the
 *  reader is several days further down. (Stated in the PR per the handoff.) */
const MAX_WAIT_MS = 400;
/** Hysteresis dead zone as a fraction of viewport height: a day boundary must
 *  cross center by this margin before the centered-day signal flips. */
const DEAD_ZONE_FRAC = 0.15;
/** Off-screen mount buffer (≈1.5 viewports each side): days mount/measure and
 *  unmount well outside the viewport, so corrections happen where they can't be
 *  seen and in-view content never pops or resizes. */
const IO_ROOT_MARGIN = "150% 0px 150% 0px";
/** How long a programmatic (rail-click) scroll is allowed to run before the
 *  observer resumes writing `?day=`. Smooth scrolls have no reliable end event. */
const PROGRAMMATIC_MS = 700;

export function ContinuousDayStack({
  days,
  selectedDayId,
  renderDay,
  estimateHeight,
  onSettleDay,
  onMountedChange,
}: {
  days: Day[];
  /** The externally-selected day (`?day=`). Seeds the initial scroll position
   *  and, when it changes from outside (rail click, back/forward), scrolls that
   *  day to the top. */
  selectedDayId: string;
  /** Render one day's leaf. Called only for mounted days. */
  renderDay: (day: Day) => React.ReactNode;
  /** Model-driven height for a never-mounted day (placeholder sizing). */
  estimateHeight: (day: Day) => number;
  /** Commit the centered day to `?day=` (one fan-out per settle). */
  onSettleDay: (dayId: string) => void;
  /** Report the mounted day-id set so the parent can union hydration placeIds. */
  onMountedChange: (ids: string[]) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slotEls = useRef<Map<string, HTMLElement>>(new Map());
  /** Stable per-day ref callbacks — an inline arrow would change identity every
   *  render, making React detach/re-attach each slot (churning slotEls and
   *  racing the observers). Memoized by id so React only fires them on real
   *  mount/unmount of the wrapper node. */
  const refCbs = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  /** Measured content height per day, captured while mounted (ResizeObserver).
   *  A ref, not state — placeholder sizing must not trigger re-renders. */
  const heights = useRef<Map<string, number>>(new Map());
  /** The day currently at viewport center. Updated on every scroll frame; drives
   *  hysteresis + settle WITHOUT re-rendering. */
  const centeredRef = useRef<string>(selectedDayId);
  /** Last id we WROTE to `?day=` — distinguishes our own settle echo (ignore)
   *  from an external rail-click (scroll to it). */
  const lastWrittenRef = useRef<string>(selectedDayId);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** While set (a timestamp), a programmatic scroll is in flight — keep the
   *  centered ref fresh but don't schedule a settle write. */
  const programmaticUntil = useRef<number>(0);
  /** The day a programmatic scroll is heading TO (the rail-click target). Read
   *  by `flush` while that scroll is in flight so a mid-animation flush (e.g.
   *  toggling into edit mode) commits the clicked day, not a fly-by one. */
  const programmaticTargetRef = useRef<string | null>(null);

  // Keep parent callbacks current without re-running observer effects when the
  // parent hands us new function identities each render.
  const onSettleDayRef = useRef(onSettleDay);
  const onMountedChangeRef = useRef(onMountedChange);
  onSettleDayRef.current = onSettleDay;
  onMountedChangeRef.current = onMountedChange;

  // Mounted day-id set. Seed with the selected day so the first paint shows real
  // content at the scroll target instead of a flash of placeholders; the IO adds
  // the rest of the near-viewport window on its first callback.
  const [mounted, setMounted] = useState<Set<string>>(
    () => new Set([selectedDayId]),
  );

  const slotRef = (id: string) => {
    let cb = refCbs.current.get(id);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) slotEls.current.set(id, el);
        else slotEls.current.delete(id);
      };
      refCbs.current.set(id, cb);
    }
    return cb;
  };

  // ── Flush helpers ──────────────────────────────────────────────────────────
  const flush = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
    settleTimer.current = undefined;
    maxWaitTimer.current = undefined;
    // Don't resurrect a day the user just navigated away from. The unmount flush
    // (the edit-mode bridge) fires for ANY unmount, including switching to the
    // Overview, which clears ?day=; writing the centered day back would undo it.
    // While the stack is mounted mid-scroll ?day= is always a day, so this only
    // gates the unmount-to-Overview case.
    if (typeof window !== "undefined" && !new URL(window.location.href).searchParams.get("day")) {
      return;
    }
    // While a programmatic (rail-click) scroll is still animating, the centered
    // ref is tracking the days flying past — committing it would land on a
    // fly-by day instead of the day the user actually clicked. The click target
    // is the intended selection for the whole window, so prefer it.
    const id =
      Date.now() < programmaticUntil.current && programmaticTargetRef.current
        ? programmaticTargetRef.current
        : centeredRef.current;
    if (id && id !== lastWrittenRef.current) {
      lastWrittenRef.current = id;
      onSettleDayRef.current(id);
    }
  }, []);

  // ── Scroll handler: update centered ref (continuous) + schedule settle ──────
  const handleScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const spans: DaySlotSpan[] = [];
    for (const d of days) {
      const el = slotEls.current.get(d.id);
      if (!el) continue;
      spans.push({ id: d.id, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight });
    }
    const viewportCenter = root.scrollTop + root.clientHeight / 2;
    const deadZone = root.clientHeight * DEAD_ZONE_FRAC;
    const next = pickCenteredDay(spans, viewportCenter, centeredRef.current, deadZone);
    if (next) centeredRef.current = next;

    // A programmatic (rail-click) scroll owns the write; don't fight it.
    if (Date.now() < programmaticUntil.current) return;

    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(flush, SETTLE_MS);
    // Max-wait: open one ceiling window per continuous-scroll burst.
    if (maxWaitTimer.current === undefined) {
      maxWaitTimer.current = setTimeout(flush, MAX_WAIT_MS);
    }
  }, [days, flush]);

  // ── IntersectionObserver: mount/unmount the near-viewport window ─────────────
  const dayKey = days.map((d) => d.id).join("|");
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const nextAdd = new Set<string>();
        const nextRemove = new Set<string>();
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.dayId;
          if (!id) continue;
          if (e.isIntersecting) nextAdd.add(id);
          else nextRemove.add(id);
        }
        setMounted((prev) => {
          const nx = new Set(prev);
          for (const id of nextAdd) if (!nx.has(id)) { nx.add(id); changed = true; }
          for (const id of nextRemove) if (nx.has(id)) { nx.delete(id); changed = true; }
          return changed ? nx : prev;
        });
      },
      { root, rootMargin: IO_ROOT_MARGIN, threshold: 0 },
    );
    for (const el of slotEls.current.values()) io.observe(el);
    return () => io.disconnect();
    // Re-observe when the set of day slots changes (revalidation / edit).
  }, [dayKey]);

  // Report the mounted set (ordered by day) up for hydration unioning.
  useEffect(() => {
    const ids = days.filter((d) => mounted.has(d.id)).map((d) => d.id);
    onMountedChangeRef.current(ids);
  }, [mounted, days]);

  // ── ResizeObserver: cache measured heights + compensate above-fold shifts ────
  // Unmount is already height-neutral (placeholder = cached height). The residual
  // jump is a slot ABOVE the viewport changing height — critically including the
  // FIRST mount of a day scrolled toward from below (upward scroll): its
  // placeholder held the model ESTIMATE, and the estimate→measured delta would
  // shift everything below it (the viewport) by the difference. `heights` is
  // seeded with the rendered placeholder height (estimate) at render time, so
  // that first-mount delta is compensable like any re-measure. Only the portion
  // of the delta ABOVE the fold shifts visible content, so the correction clamps
  // the old/new slot bottoms to the fold — fully-above slots compensate the full
  // delta, fully-below slots none, straddling slots just the invisible part.
  // Native scroll-anchoring is disabled on the container (overflow-anchor:none)
  // so the browser doesn't double-correct.
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      const root = scrollRef.current;
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const id = el.dataset.dayId;
        if (!id) continue;
        const newH = el.offsetHeight;
        const oldH = heights.current.get(id) ?? newH;
        heights.current.set(id, newH);
        if (!root || oldH === newH) continue;
        const fold = root.scrollTop;
        const top = el.offsetTop;
        const clamp = (v: number) => Math.min(Math.max(v, top), fold);
        const delta = clamp(top + newH) - clamp(top + oldH);
        if (delta !== 0) root.scrollTop += delta;
      }
    });
    for (const id of mounted) {
      const el = slotEls.current.get(id);
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [mounted]);

  // ── Initial scroll to the selected day (once). ───────────────────────────────
  useLayoutEffect(() => {
    const el = slotEls.current.get(selectedDayId);
    if (el) el.scrollIntoView({ block: "start" });
    centeredRef.current = selectedDayId;
    lastWrittenRef.current = selectedDayId;
    // Mount-only: subsequent selectedDayId changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── External ?day= change (rail click, back/forward) → scroll it to top. ─────
  // Our own settle echo (selectedDayId === lastWritten) is ignored so the write
  // doesn't bounce the reader's scroll.
  useEffect(() => {
    if (selectedDayId === lastWrittenRef.current) return;
    lastWrittenRef.current = selectedDayId;
    centeredRef.current = selectedDayId;
    const el = slotEls.current.get(selectedDayId);
    if (!el) return;
    // Guard the observer for the duration of the smooth scroll so it doesn't
    // re-write ?day= as it passes intervening days, and record the target so a
    // flush landing mid-animation commits the clicked day rather than a fly-by.
    programmaticUntil.current = Date.now() + PROGRAMMATIC_MS;
    programmaticTargetRef.current = selectedDayId;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selectedDayId]);

  // ── Attach the scroll listener. ──────────────────────────────────────────────
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    root.addEventListener("scroll", handleScroll, { passive: true });
    return () => root.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // ── Flush on unmount (the edit-mode bridge). ─────────────────────────────────
  // When the parent switches to the single-day edit swap this component unmounts;
  // commit the pending centered day so the swap lands where the reader was.
  useEffect(() => {
    return () => flush();
  }, [flush]);

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-y-auto no-scrollbar"
      style={{ overflowAnchor: "none" }}
    >
      {days.map((d) => {
        const isMounted = mounted.has(d.id);
        const placeholderH = heights.current.get(d.id) ?? estimateHeight(d);
        // Seed the height cache with the estimate a never-measured placeholder is
        // ABOUT to render at, so the ResizeObserver can compensate the
        // estimate→measured delta on first mount (the upward-scroll jump).
        // Idempotent set-if-absent; measured values are never overwritten.
        if (!isMounted && !heights.current.has(d.id)) {
          heights.current.set(d.id, placeholderH);
        }
        return (
          <div
            key={d.id}
            data-day-id={d.id}
            ref={slotRef(d.id)}
            style={isMounted ? undefined : { height: placeholderH }}
          >
            {isMounted ? renderDay(d) : null}
          </div>
        );
      })}
    </div>
  );
}
