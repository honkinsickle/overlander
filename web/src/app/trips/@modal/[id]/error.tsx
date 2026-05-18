"use client";

import { SlideupShell } from "@/components/trip/slideup-shell";

/** Error boundary for /trips/@modal/[id]. Brief §7 copy: "Couldn't
 *  load this trip. Refresh, or pick another from the list." Slideup
 *  chrome stays mounted so ✕ + browser-back still work. */
export default function TripsModalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SlideupShell hidePhase>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
        <p className="font-sans text-base text-text-primary text-center max-w-md">
          Couldn&apos;t load this trip. Refresh, or pick another from the list.
        </p>
        <button
          type="button"
          onClick={reset}
          className="h-10 px-5 rounded-full bg-amber text-bg-base font-sans text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Refresh
        </button>
      </div>
    </SlideupShell>
  );
}
