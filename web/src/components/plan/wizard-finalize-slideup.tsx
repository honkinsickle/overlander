"use client";

import { useEffect } from "react";
import { SlideupShell } from "@/components/trip/slideup-shell";
import { TripSlideupBody } from "@/components/trip/trip-slideup-body";
import type { Trip } from "@/lib/trips/types";

/**
 * Wizard-finalize entry point. Mounts the standard `SlideupShell` over
 * the wizard's loader page once finalization completes. PHASE chip
 * hidden (un-phased user trip — brief §7). Close converges on `/trips`
 * via `closeHref` plus a history dance for browser-back parity.
 *
 * History dance: the user arrived here from `/plan/<id>/loader`.
 * Without intervention, browser-back would pop into the wizard's prior
 * step. We swap the loader entry for `/trips` then push the loader URL
 * back on top, so the stack reads `[..., /trips, /plan/<id>/loader]`.
 * Result: URL bar stays on the wizard route (brief §5), and any of
 * ✕/ESC/backdrop/browser-back land on `/trips` (brief §6).
 */
export function WizardFinalizeSlideup({ trip }: { trip: Trip }) {
  useEffect(() => {
    const currentUrl = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", "/trips");
    window.history.pushState(null, "", currentUrl);
  }, []);

  return (
    <SlideupShell trip={trip} hidePhase closeHref="/trips">
      {/* Wizard-finalize is the user finalizing their own scratch trip;
       *  the "Make it mine" fork CTA never applies here. */}
      <TripSlideupBody trip={trip} isReference={false} isAuthed={false} />
    </SlideupShell>
  );
}
