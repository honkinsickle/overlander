/**
 * Thin wrapper around `navigator.storage.estimate()`.
 *
 * Sessions 3 and 4 consume this for the quota UI ("1.2 GB / 1.5 GB used.
 * Remove an old phase to free space.") and for guarding phase primes when
 * the cache is near the quota ceiling. Exported in session 1 so it's
 * ready to import.
 *
 * Caveats:
 *  - Not supported in older browsers / non-secure contexts. Returns null
 *    rather than throwing so callers can render a graceful "unknown" UI.
 *  - `quota` is the browser's reported quota — on iOS Safari this is the
 *    pool shared with other origins, and reported values trend high
 *    relative to what's actually usable. Treat as a ceiling, not a contract.
 *  - `percentUsed` is rounded to one decimal so display callers don't have
 *    to. Returns null when quota is 0 or absent.
 */
export type StorageEstimate = {
  usage: number;
  quota: number;
  percentUsed: number | null;
};

export async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined") return null;
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      usage,
      quota,
      percentUsed: quota > 0 ? Math.round((usage / quota) * 1000) / 10 : null,
    };
  } catch {
    return null;
  }
}
