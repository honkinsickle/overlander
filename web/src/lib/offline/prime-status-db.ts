/**
 * Per-device prime status for offline phases.
 *
 * One IndexedDB store, composite key `[tripId, phaseId]`. The phase
 * definition itself (label, dayIds, bufferMi, maxZoom) lives in
 * `trips.payload.offlinePhases` on Supabase — it travels with the trip.
 * What's stored here is the *device's* download state: whether this
 * iPad / browser has primed the tiles for that phase, how far along the
 * prime got, and the polyline hash captured at prime time so a later
 * trip edit can be detected as drift.
 *
 * Native API rather than a wrapper lib: surface is small (4 calls), and
 * pulling in idb/dexie/etc. for a one-store schema would dwarf the code.
 */
import { fnv1a32 } from "./hash";

const DB_NAME = "overlander-offline";
const DB_VERSION = 1;
const STORE = "phase-status";

export type PhaseStatusKind =
  | "not-primed"
  | "priming"
  | "partial"
  | "ready"
  | "error";

export type PhaseStatus = {
  tripId: string;
  phaseId: string;
  status: PhaseStatusKind;
  tilesPrimed: number;
  tilesTotal: number;
  /** ISO timestamp at first successful prime completion, or null. */
  primedAt: string | null;
  /** Polyline hash captured at prime time. Compared against current
   *  geometry to detect drift after a trip edit. Null until first prime. */
  primedPolylineHash: string | null;
  /** Mapbox tileset version captured at prime time, e.g. "streetsv8".
   *  Drift detection covers tileset bumps in addition to polyline edits. */
  tilesetVersion: string;
  /** Last error message from a failed prime/resume attempt, or null. */
  lastError: string | null;
  /** Number of tiles that exhausted retries during the most recent
   *  prime/resume attempt. Used by the UI to distinguish "user paused
   *  cleanly" (0 failed) from "stopped after some failures" (>0 failed).
   *  Optional for backward compat with IDB rows written before this
   *  field existed — readers default to 0. */
  failedCount?: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: ["tripId", "phaseId"] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    // `blocked` fires when another tab holds an older-version DB open.
    // We're at v1 and have no migrations yet — just surface the condition.
    req.onblocked = () =>
      reject(new Error("indexedDB open blocked by another tab"));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const result = run(store);
        if (result instanceof Promise) {
          result.then(resolve, reject);
          return;
        }
        result.onsuccess = () => resolve(result.result);
        result.onerror = () =>
          reject(result.error ?? new Error("indexedDB request failed"));
      }),
  );
}

export async function getPhaseStatus(
  tripId: string,
  phaseId: string,
): Promise<PhaseStatus | null> {
  const value = await tx<PhaseStatus | undefined>("readonly", (s) =>
    s.get([tripId, phaseId]) as IDBRequest<PhaseStatus | undefined>,
  );
  return value ?? null;
}

export async function putPhaseStatus(record: PhaseStatus): Promise<void> {
  await tx<IDBValidKey>("readwrite", (s) => s.put(record));
}

export async function deletePhaseStatus(
  tripId: string,
  phaseId: string,
): Promise<void> {
  await tx<undefined>("readwrite", (s) => s.delete([tripId, phaseId]));
}

export async function listPhaseStatusesForTrip(
  tripId: string,
): Promise<PhaseStatus[]> {
  // No secondary index on tripId — store is small (one row per phase per
  // trip; ~10 rows per active trip) so getAll + filter is the right shape.
  // If active-trip count grows, add an index on `tripId`.
  const all = await tx<PhaseStatus[]>("readonly", (s) => s.getAll());
  return all.filter((r) => r.tripId === tripId);
}

/** Bucket name for a phase's Cache Storage entry. Mirrors the convention
 *  the SW reads from in `bucketFor()` and the prime loop writes to. */
export function phaseCacheName(phaseId: string, tilesetVersion: string): string {
  // Phase ids are app-controlled ("phase-w1") so they're already
  // cache-name safe. Hash anyway as a defensive measure in case a future
  // editor permits user-supplied phase ids.
  const safe = /^[a-z0-9-]+$/i.test(phaseId) ? phaseId : `h${fnv1a32(phaseId)}`;
  return `mb-phase-${safe}-${tilesetVersion}`;
}

/** Test-only hook: drop the cached DB promise so the next openDb()
 *  re-opens. Used by scripts/check-prime-status-db.ts to start clean. */
export function __resetDbHandleForTests(): void {
  dbPromise = null;
}
