"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Trip } from "@/lib/trips/types";
import { OfflinePanel } from "@/components/trip/offline-panel";
import { isUserTrip } from "@/lib/trips/is-user-trip";

/**
 * Slideup shell — full-viewport map-as-background overlay.
 *
 * Per docs/design/slideup-overlay-states-v2.md (Default state). The sheet
 * fills the viewport; the body composes the map background + translucent
 * overlays + floating chrome. The only chrome owned by the shell is the
 * Close ✕ (top-right) because dismiss behavior lives here.
 *
 * Dismiss (X / Escape / backdrop) calls `router.back()` so the underlying
 * page is restored; `closeHref` overrides to a hard push (wizard-finalize
 * lands on /trips regardless of history).
 */
export function SlideupShell({
  trip,
  children,
  closeHref,
}: {
  /** Optional. Absent for loading/not-found/error states. */
  trip?: Trip;
  children: React.ReactNode;
  /** If set, dismiss navigates here via `router.push` instead of
   *  `router.back()`. Used by the wizard-finalize entry. */
  closeHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [offlineScrollTo, setOfflineScrollTo] = useState<string | undefined>();
  const initialPath = useRef<string | null>(null);
  const isUserTripView = !!trip && isUserTrip(trip);

  // Banner CTA → open OfflinePanel (with optional scroll-to-phase).
  // Also triggered by the Top Bar's kebab via the same event.
  useEffect(() => {
    if (!isUserTripView) return;
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ phaseId?: string } | undefined>)
        .detail;
      setOfflineScrollTo(detail?.phaseId);
      setOfflineOpen(true);
    };
    window.addEventListener("trip:openOfflinePanel", onOpen);
    return () => window.removeEventListener("trip:openOfflinePanel", onOpen);
  }, [isUserTripView]);

  useEffect(() => {
    const id = setTimeout(() => setOpen(true), 20);
    return () => clearTimeout(id);
  }, []);

  // Auto slide-down when navigation takes us away from the trip's path.
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
    setTimeout(() => {
      if (closeHref) router.push(closeHref);
      else router.back();
    }, 260);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={trip?.title ?? "Trip"}
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

      {/* Full-viewport sheet — slides up from bottom on mount. */}
      <div
        style={{
          transform: open ? "translateY(0)" : "translateY(100%)",
        }}
        className="absolute inset-0 bg-bg-panel overflow-hidden transition-transform duration-300 ease-out"
      >
        {children}
        {isUserTripView && trip && (
          <OfflinePanel
            trip={trip}
            open={offlineOpen}
            onClose={() => {
              setOfflineOpen(false);
              setOfflineScrollTo(undefined);
            }}
            scrollToPhaseId={offlineScrollTo}
          />
        )}

        {/* Close ✕ — floating top-right of the viewport. Lives in the
         *  sheet wrapper so it animates with the slide-up. */}
        <button
          type="button"
          aria-label="Close trip"
          onClick={dismiss}
          style={{ marginRight: -12 }}
          className="absolute top-3 right-0 z-40 flex items-center justify-center w-[60px] h-[60px] bg-[#1D1E1F]/[0.56] border border-white/[0.18] rounded-tl-[8px] rounded-tr-[12px] rounded-bl-[8px] rounded-br-[8px] backdrop-blur-sm"
        >
          <X
            className="w-[22px] h-[22px] text-text-muted"
            strokeWidth={1.5}
          />
        </button>
      </div>
    </div>
  );
}
