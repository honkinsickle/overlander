"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Trip } from "@/lib/trips/types";

/**
 * Slideup shell — Paper `GHR-0`, 1113×734.
 *
 * Renders a backdrop + bottom-sheet that slides in on mount and slides
 * out on dismiss. Used by the intercepting `(.)trip/[id]` route to
 * overlay the trip view over the calling page without a hard nav.
 *
 * Dismiss (X click / Escape / backdrop click) calls `router.back()` so
 * the underlying page is restored exactly as it was.
 */
export function SlideupShell({
  trip,
  children,
}: {
  trip: Trip;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const initialPath = useRef<string | null>(null);
  const totalMiles = trip.days.reduce((sum, d) => sum + (d.miles ?? 0), 0);

  useEffect(() => {
    // Flip to open on the tick after initial render so the CSS transition
    // on `transform` animates from translate-y-full to translate-y-0.
    const id = setTimeout(() => setOpen(true), 20);
    return () => clearTimeout(id);
  }, []);

  // Auto slide-down when navigation takes us away from the trip's own
  // path (e.g. "Open Ask" → /trip/:id/ask). Next.js keeps the intercepted
  // @modal slot mounted on forward nav, so we toggle visibility here.
  // Back-nav to the trip path re-opens the sheet.
  useEffect(() => {
    if (initialPath.current === null) {
      initialPath.current = pathname;
      return;
    }
    setOpen(pathname === initialPath.current);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    setOpen(false);
    // Wait out the transition, then pop the intercept.
    setTimeout(() => router.back(), 260);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={trip.title}
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close trip"
        onClick={dismiss}
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          open ? "opacity-60" : "opacity-0"
        }`}
      />

      {/* Sheet — absolutely pinned to the bottom, centered horizontally. */}
      <div
        style={{
          transform: open
            ? "translateX(-50%) translateY(0)"
            : "translateX(-50%) translateY(100%)",
        }}
        className="absolute bottom-0 left-1/2 w-[1113px] max-w-full h-[734px] max-h-[calc(100dvh-10px)] bg-bg-panel rounded-t-xl overflow-hidden shadow-2xl transition-transform duration-300 ease-out"
      >
        {/* Drag handle affordance (static — drag-to-dismiss not wired yet). */}
        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-border-mid pointer-events-none z-10" />

        {/* Slideup Header — Paper ANC-0 / ANI-0 (1133×68).
         *  padding-inline 16 · gap 12 · bg --bg-base · border-b --border-mid.
         *  Close sits flush to the right edge via margin-right: -12 so it
         *  overlaps the container's 16 padding. */}
        <header className="flex items-center gap-3 w-full h-[68px] px-4 bg-bg-base border-b border-border-mid">
          {/* Phase column (36w × 46h) + 1×32 divider. Gap 10 between them. */}
          <div className="flex items-center shrink-0 gap-2.5">
            <div className="flex flex-col items-center">
              <span className="font-sans text-[10px] leading-[10px] font-bold tracking-[0.1em] text-text-muted">
                PHASE
              </span>
              <span className="font-sans text-[36px] leading-[36px] font-bold text-text-primary">
                01
              </span>
            </div>
            <div className="w-px h-8 bg-border-mid mx-0.5" />
          </div>

          {/* Title + meta (flex-1). Title 18/22 Barlow 700, sub 14/18 ls .06em. */}
          <div className="flex flex-col flex-1 min-w-0">
            <span className="font-sans text-[18px] leading-[22px] font-bold text-text-primary truncate">
              {trip.title}
            </span>
            <span className="font-sans text-[14px] leading-[18px] tracking-[0.06em] text-text-muted">
              Day 01-{String(trip.days.length).padStart(2, "0")}/{totalMiles} mi
            </span>
          </div>

          {/* More (kebab) — 32×32 · radius 8 · bg --border-subtle · border --border-mid. */}
          <button
            type="button"
            aria-label="More options"
            className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-border-subtle border border-border-mid"
          >
            <span className="flex flex-col gap-[3px]">
              <span className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="w-[3px] h-[3px] rounded-full bg-text-muted" />
              <span className="w-[3px] h-[3px] rounded-full bg-text-muted" />
            </span>
          </button>

          {/* Close — 60×60 · bg --bg-card · 1px left border --border-subtle ·
           *  margin-right -12 so it sits flush with the bar edge. Icon 22×22. */}
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            style={{ marginRight: -12 }}
            className="flex items-center justify-center shrink-0 w-[60px] h-[60px] bg-bg-card border-l border-border-subtle"
          >
            <X className="w-[22px] h-[22px] text-text-muted" strokeWidth={1.5} />
          </button>
        </header>

        {/* Body: 3-column (no 80px vnav in slideup per Paper). */}
        <div className="flex w-full h-[calc(100%-68px)]">{children}</div>
      </div>
    </div>
  );
}
