"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";

/** Wake Lock API surface — narrow shape because the TS lib for this is
 *  still patchy across browsers. iOS Safari 16.4+ supports it. */
type WakeLockSentinel = {
  released: boolean;
  release(): Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
};
type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> };
};

/** Large FAB in the bottom-right of the map column. Tap green to enter
 *  nav mode (camera-follow + directions panel + screen wake lock); tap
 *  red to exit. One state lives here; everything else listens for the
 *  events this button dispatches.
 *
 *  Auto-recovers the wake lock when the page becomes visible again —
 *  the OS releases it on tab switch / sleep per spec, so without this
 *  the screen would start dimming the second time the user picks up
 *  the iPad during a drive. */
export function NavGoButton() {
  const [navMode, setNavMode] = useState(false);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      wakeRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        if (wakeRef.current === sentinel) wakeRef.current = null;
      });
    } catch {
      // Wake Lock can fail when the page isn't visible — silent on
      // failure; we'll retry on visibility change.
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeRef.current;
    if (!sentinel || sentinel.released) return;
    wakeRef.current = null;
    try {
      await sentinel.release();
    } catch {
      // Ignore.
    }
  }, []);

  // Re-acquire after returning to the tab, since the OS auto-releases
  // on hidden visibility.
  useEffect(() => {
    if (!navMode) return;
    const onVis = () => {
      if (document.visibilityState === "visible" && !wakeRef.current) {
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [navMode, acquireWakeLock]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      void releaseWakeLock();
    };
  }, [releaseWakeLock]);

  const onClick = () => {
    if (navMode) {
      setNavMode(false);
      window.dispatchEvent(
        new CustomEvent("trip:setFollow", { detail: { follow: false } }),
      );
      window.dispatchEvent(new CustomEvent("trip:closeDirections"));
      void releaseWakeLock();
      return;
    }
    setNavMode(true);
    window.dispatchEvent(
      new CustomEvent("trip:setFollow", { detail: { follow: true } }),
    );
    window.dispatchEvent(new CustomEvent("trip:openDirections"));
    void acquireWakeLock();
  };

  const Icon = navMode ? Square : Play;
  const label = navMode ? "Stop navigation" : "Start navigation";

  return (
    <div className="absolute bottom-24 right-4 z-30 pointer-events-auto flex items-center gap-3">
      <span
        className="font-sans text-[13px] font-semibold text-white px-3 py-1.5 rounded-full bg-bg-card/85 border border-border-mid backdrop-blur-sm"
        aria-hidden
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-2 transition-colors ${
          navMode
            ? "bg-[#D8443A] border-[#7A1F18] text-white"
            : "bg-[#2E9C5F] border-[#1A5C38] text-white hover:bg-[#34B26C]"
        }`}
      >
        <Icon
          className={`w-6 h-6 ${navMode ? "" : "ml-0.5"}`}
          fill="currentColor"
        />
      </button>
    </div>
  );
}
