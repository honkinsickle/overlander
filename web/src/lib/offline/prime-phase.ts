/**
 * Phase prime loop — page-side.
 *
 * Drives a fetch-and-cache loop over the tile URLs for one phase. Writes
 * responses directly into `caches.open(phaseCacheName(...))` from the
 * page; the SW is read-only for phase buckets (extended in C5 to
 * recognize them). Persists progress to IDB in batches so the user can
 * close the tab mid-prime and resume later.
 *
 * Architecture choice (ADR §47, decision C5): page-driven over SW-driven.
 * Tradeoff accepted: tab-close stops the prime (no background SW prime
 * loop). Resume is supported by skipping URLs already in the cache.
 *
 * Rate limiting: catches 429, parses Retry-After, exponential backoff
 * with jitter; concurrency throttle is a secondary safeguard.
 */
import {
  getPhaseStatus,
  phaseCacheName,
  putPhaseStatus,
  type PhaseStatus,
  type PhaseStatusKind,
} from "./prime-status-db";

const CONCURRENCY = 8;
const MAX_RETRIES_429 = 5;
const MAX_RETRIES_OTHER = 2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
/** Persist progress to IDB every N successful tiles. Trades fewer IDB
 *  writes for coarser resume granularity. 25 = ~0.1% of a 26K phase. */
const PROGRESS_BATCH = 25;

export type Tile = { z: number; x: number; y: number };

export type PrimePhaseInput = {
  tripId: string;
  phaseId: string;
  /** Mapbox tileset id path segment, e.g. "mapbox.mapbox-streets-v8". */
  tilesetIds: string;
  /** Short version tag baked into the cache name, e.g. "streetsv8". */
  tilesetVersion: string;
  tiles: Tile[];
  mapboxToken: string;
  /** Captured by the caller at prime start so a successful prime stamps
   *  the geometry hash that was active when the tiles were pulled. */
  primedPolylineHash: string;
  signal?: AbortSignal;
  onProgress?: (p: PrimeProgress) => void;
};

export type PrimeProgress = {
  tilesPrimed: number;
  tilesTotal: number;
  failedCount: number;
};

export type PrimePhaseResult = {
  status: PhaseStatusKind;
  tilesPrimed: number;
  tilesTotal: number;
  failedCount: number;
  error?: string;
};

export async function primePhase(input: PrimePhaseInput): Promise<PrimePhaseResult> {
  const {
    tripId, phaseId, tilesetIds, tilesetVersion, tiles, mapboxToken,
    primedPolylineHash, signal, onProgress,
  } = input;

  const total = tiles.length;
  if (total === 0) {
    const empty: PhaseStatus = baseRecord({
      tripId, phaseId, tilesetVersion, primedPolylineHash,
      status: "ready", tilesPrimed: 0, tilesTotal: 0,
      primedAt: new Date().toISOString(),
    });
    await putPhaseStatus(empty);
    return { status: "ready", tilesPrimed: 0, tilesTotal: 0, failedCount: 0 };
  }

  const cache = await caches.open(phaseCacheName(phaseId, tilesetVersion));

  // Resume support: load the prior session's tilesPrimed so the counter
  // continues from where we left off. We DO NOT pre-scan the cache to
  // build a dedupe set — `cache.keys()` throws "Operation too large" on
  // near-26K-entry caches (Chrome cap), which silently broke resume on
  // any nearly-completed phase. Instead each worker calls `cache.match`
  // per URL before fetching; that's O(1) and cap-free.
  const priorRecord = await getPhaseStatus(tripId, phaseId);
  const priorDone = priorRecord?.tilesPrimed ?? 0;

  const urls = tiles.map((t) => tileUrl(tilesetIds, t, mapboxToken));

  // Snapshot the prime as `priming` immediately so a tab-close mid-prime
  // leaves a status the next session can see ("partial — N of M").
  await putPhaseStatus(
    baseRecord({
      tripId, phaseId, tilesetVersion, primedPolylineHash,
      status: "priming",
      tilesPrimed: priorDone,
      tilesTotal: total,
    }),
  );

  let done = priorDone;
  let failed = 0;
  let cursor = 0;
  let lastPersisted = priorDone;
  let aborted = false;

  // Single-writer cursor: workers pull the next index off `cursor`.
  // Promise.all over a fixed worker pool is enough — no need for a
  // dependency like p-limit for this surface size.
  async function worker() {
    while (true) {
      if (signal?.aborted) {
        aborted = true;
        return;
      }
      const myIdx = cursor++;
      if (myIdx >= urls.length) return;
      const url = urls[myIdx];

      // Per-URL cache check (replaces the up-front cache.keys() pre-scan).
      // A hit means the prior session already counted this tile in
      // `priorDone`, so don't increment again — that would inflate the
      // counter past the real cache size.
      const cached = await cache.match(stripCacheKey(url));
      if (cached) continue;

      const ok = await fetchAndCache(url, cache, signal);
      if (ok === "aborted") {
        aborted = true;
        return;
      }
      if (ok) done++;
      else failed++;

      if (done - lastPersisted >= PROGRESS_BATCH) {
        lastPersisted = done;
        await putPhaseStatus(
          baseRecord({
            tripId, phaseId, tilesetVersion, primedPolylineHash,
            status: "priming",
            tilesPrimed: done,
            tilesTotal: total,
          }),
        );
        onProgress?.({ tilesPrimed: done, tilesTotal: total, failedCount: failed });
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker);
  await Promise.all(workers);

  // Final status:
  //  - aborted              → partial (user paused or navigated away)
  //  - done < total         → partial (some 429s exhausted or 5xxs gave up)
  //  - done === total       → ready (even if some retries happened on the way)
  const status: PhaseStatusKind = aborted
    ? "partial"
    : done >= total
      ? "ready"
      : "partial";

  await putPhaseStatus(
    baseRecord({
      tripId, phaseId, tilesetVersion, primedPolylineHash,
      status,
      tilesPrimed: done,
      tilesTotal: total,
      primedAt: status === "ready" ? new Date().toISOString() : null,
      lastError: failed > 0 ? `${failed} tiles failed after retries` : null,
    }),
  );
  onProgress?.({ tilesPrimed: done, tilesTotal: total, failedCount: failed });

  return { status, tilesPrimed: done, tilesTotal: total, failedCount: failed };
}

// ---------------------------------------------------------------- helpers

async function fetchAndCache(
  url: string,
  cache: Cache,
  signal?: AbortSignal,
): Promise<true | false | "aborted"> {
  let tries429 = 0;
  let triesOther = 0;
  while (true) {
    if (signal?.aborted) return "aborted";
    try {
      const resp = await fetch(url, { signal });
      if (resp.status === 429) {
        if (tries429 >= MAX_RETRIES_429) return false;
        const retryAfterMs = parseRetryAfter(resp.headers.get("retry-after"));
        const wait = retryAfterMs ?? exponentialBackoff(tries429);
        tries429++;
        await sleep(jitter(wait), signal);
        continue;
      }
      if (!resp.ok) {
        // 4xx (non-429) is permanent for that URL — don't retry. 5xx
        // gets a short backoff retry. After that, skip and count failed.
        if (resp.status >= 500 && triesOther < MAX_RETRIES_OTHER) {
          triesOther++;
          await sleep(jitter(exponentialBackoff(triesOther)), signal);
          continue;
        }
        return false;
      }
      // Strip the token from the cache key so a rotated token still
      // matches cached entries. Mirrors the SW's stripCacheKey().
      await cache.put(stripCacheKey(url), resp);
      return true;
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return "aborted";
      }
      if (triesOther >= MAX_RETRIES_OTHER) return false;
      triesOther++;
      await sleep(jitter(exponentialBackoff(triesOther)), signal);
    }
  }
}

function tileUrl(tilesetIds: string, t: Tile, token: string): string {
  return `https://api.mapbox.com/v4/${tilesetIds}/${t.z}/${t.x}/${t.y}.vector.pbf?access_token=${token}`;
}

/** Token-stripped, deterministic cache key. Matches public/sw.js. */
function stripCacheKey(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("access_token");
  return u.toString();
}

/** RFC 7231: Retry-After is either delta-seconds or HTTP-date. Returns
 *  milliseconds. Returns null if absent or unparseable. */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum * 1000;
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

function exponentialBackoff(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
}

/** ±25% jitter. Avoids thundering-herd retries lining up. */
function jitter(ms: number): number {
  return ms * (0.75 + Math.random() * 0.5);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

type BaseRecordInput = Pick<
  PhaseStatus,
  "tripId" | "phaseId" | "tilesetVersion" | "status" | "tilesPrimed" | "tilesTotal"
> & {
  primedPolylineHash: string;
  primedAt?: string | null;
  lastError?: string | null;
};

/** Build a PhaseStatus record for IDB with the right defaults. The
 *  ready/partial/error decision lives in the caller; this just packs. */
function baseRecord(input: BaseRecordInput): PhaseStatus {
  return {
    tripId: input.tripId,
    phaseId: input.phaseId,
    status: input.status,
    tilesPrimed: input.tilesPrimed,
    tilesTotal: input.tilesTotal,
    primedAt: input.primedAt ?? null,
    primedPolylineHash: input.primedPolylineHash,
    tilesetVersion: input.tilesetVersion,
    lastError: input.lastError ?? null,
  };
}
