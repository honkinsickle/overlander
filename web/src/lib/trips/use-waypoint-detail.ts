"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Waypoint } from "./types";

export type WaypointFetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: Waypoint }
  | { status: "not-found" }
  | { status: "error"; message: string };

export type WaypointFetchOptions = {
  /** Dev-only: appended to the fetch URL as `?simulate=<value>` to trigger
   *  synthetic 500 / timeout responses from the route handler. */
  simulate?: "error" | "timeout" | null;
};

export type UseWaypointDetail = WaypointFetchState & {
  /** Re-runs the fetch against the same (tripId, slug). Safe to call
   *  repeatedly; in-flight requests are aborted. */
  refetch: () => void;
};

/**
 * Fetches a single waypoint by slug when slug is truthy.
 * Handles loading / success / not-found (404) / error (5xx, network).
 * Cancels in-flight requests when slug changes or refetch() fires.
 *
 * No caching. Add SWR or React Query when we need revalidation or
 * cross-component cache sharing.
 */
export function useWaypointDetail(
  tripId: string,
  slug: string | null,
  options: WaypointFetchOptions = {},
): UseWaypointDetail {
  const { simulate } = options;

  // Initialize to `loading` when a slug is present so SSR and the first
  // client render both emit the skeleton (no flash of empty panel on
  // deep-linked detail URLs).
  const [state, setState] = useState<WaypointFetchState>(
    slug ? { status: "loading" } : { status: "idle" },
  );
  // Nonce bumped by refetch() to force the useEffect to re-run.
  const [nonce, setNonce] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!slug) {
      setState({ status: "idle" });
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });

    const url = new URL(
      `/api/trips/${tripId}/waypoints/${slug}`,
      window.location.origin,
    );
    if (simulate) url.searchParams.set("simulate", simulate);

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        if (!res.ok) {
          setState({
            status: "error",
            message: `Server error (${res.status})`,
          });
          return;
        }
        const data = (await res.json()) as Waypoint;
        setState({ status: "success", data });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });

    return () => controller.abort();
  }, [tripId, slug, simulate, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, refetch };
}
