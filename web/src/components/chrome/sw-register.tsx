"use client";

import { useEffect } from "react";

/**
 * Registers the Mapbox tile-cache service worker and passes the public
 * Mapbox config to it.
 *
 * Behavior:
 *  - Registers on all environments. The SW handles dev itself via
 *    localhost-bypass; nothing to gate by NODE_ENV here.
 *  - Skips registration if the browser lacks Service Worker support
 *    (older browsers, non-secure contexts that aren't localhost).
 *  - Passes NEXT_PUBLIC_MAPBOX_TOKEN + the trip map style URL via
 *    postMessage so the SW can prime the global z=0-5 baseline.
 *
 * The style URL is duplicated from `src/components/trip/map-column.tsx`
 * intentionally — keep both in sync until a shared constant lands. A
 * shared mapbox/style.ts is a future refactor; surgical for session 1.
 */
const TRIP_STYLE_URL = "mapbox://styles/honkingsickle/cmolte3b7003e01so7msf20d3";

export function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    const sendConfig = (sw: ServiceWorker | null) => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!sw || !token) return;
      sw.postMessage({
        type: "MAPBOX_CONFIG",
        token,
        styleUrl: TRIP_STYLE_URL,
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        // SW is already active (subsequent loads).
        if (reg.active) {
          sendConfig(reg.active);
        }
        // First-install path: wait for the installing worker to activate.
        const installing = reg.installing;
        if (installing) {
          installing.addEventListener("statechange", () => {
            if (installing.state === "activated") sendConfig(installing);
          });
        }
      })
      .catch((err) => {
        console.warn("[sw] registration failed:", err?.message || err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
