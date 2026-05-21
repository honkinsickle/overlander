"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live device location wrapped as a React hook. Auto-starts watching
 * when the browser already has geolocation permission granted, never
 * auto-prompts. Callers trigger the prompt explicitly via `request()` —
 * typically wired to a "locate me" button.
 *
 * `accuracyMi`, `heading`, and `speedMs` come straight from the
 * GeolocationPosition.coords. `heading` is often null when the device
 * is stationary or doesn't have a recent fix to derive heading from.
 */

export type LocationStatus =
  | "unsupported" // navigator.geolocation absent (SSR or very old browser)
  | "denied" // permission denied by user / settings
  | "idle" // permission not granted; not watching
  | "watching"; // active watchPosition subscription

export type UserLocation = {
  status: LocationStatus;
  position: [number, number] | null;
  accuracyMi: number | null;
  heading: number | null;
  speedMs: number | null;
  request: () => void;
};

export function useUserLocation(): UserLocation {
  // Lazy initializer captures the env once. Component is only mounted
  // inside the trip map (a client surface), so SSR concerns don't apply.
  const [status, setStatus] = useState<LocationStatus>(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return "unsupported";
    }
    return "idle";
  });
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [accuracyMi, setAccuracyMi] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [speedMs, setSpeedMs] = useState<number | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    if (watchIdRef.current !== null) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus("watching");
        setPosition([pos.coords.longitude, pos.coords.latitude]);
        setAccuracyMi(pos.coords.accuracy / 1609.344);
        setHeading(pos.coords.heading);
        setSpeedMs(pos.coords.speed);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setStatus("denied");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    watchIdRef.current = id;
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const perm = (
      navigator as Navigator & {
        permissions?: {
          query: (q: PermissionDescriptor) => Promise<PermissionStatus>;
        };
      }
    ).permissions;
    if (!perm?.query) return; // Safari < 16 etc — leave idle
    let cancelled = false;
    perm
      .query({ name: "geolocation" as PermissionName })
      .then((res) => {
        if (cancelled) return;
        const sync = () => {
          if (res.state === "granted") start();
          else if (res.state === "denied") setStatus("denied");
        };
        sync();
        res.addEventListener?.("change", sync);
      })
      .catch(() => {
        // Some browsers reject `geolocation` permission queries — fall
        // back to idle so the user can opt in via request().
      });
    return () => {
      cancelled = true;
    };
  }, [start]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  return { status, position, accuracyMi, heading, speedMs, request: start };
}
