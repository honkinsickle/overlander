/**
 * Helpers shared between the trip route handlers.
 * When we swap to a real backend, these either go away or move into
 * a dedicated middleware/transport layer.
 */

/** Artificial dev latency so loading states are observable.
 *  Set to 0 to disable. */
export const API_LATENCY_MS = process.env.NODE_ENV === "development" ? 250 : 0;

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
