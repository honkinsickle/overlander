"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";

import {
  computePhaseGeometry,
  enumerateTiles,
  hashPhasePolyline,
} from "@/lib/offline/offline-phase-geometry";
import { suggestDefaultPhases } from "@/lib/offline/offline-phase-suggest";
import { primePhase, type PrimeProgress } from "@/lib/offline/prime-phase";
import {
  deletePhaseStatus,
  listPhaseStatusesForTrip,
  phaseCacheName,
  type PhaseStatus,
} from "@/lib/offline/prime-status-db";
import { estimateStorage, type StorageEstimate } from "@/lib/offline/storage";
import {
  CURRENT_TILESET_VERSION,
  getPhaseDisplayStatus,
  type PhaseDisplayStatus,
} from "@/lib/offline/drift";
import {
  setOfflinePhaseHashAction,
  setOfflinePhasesAction,
} from "@/lib/trips/actions";
import type { OfflinePhase, Trip } from "@/lib/trips/types";

const TILESET_IDS = "mapbox.mapbox-streets-v8";
/** Rough average vector-tile size at z=6..13 for Mapbox Streets v8 — used
 *  for pre-prime MB estimates. Real-world tiles range ~5–80 KB; 30 KB
 *  is a reasonable trip-level average. */
const AVG_TILE_KB = 30;

/**
 * Right-edge drawer for offline phase priming. Mounts as an absolutely-
 * positioned panel within the slideup body, slides in over the 3-column
 * layout (decision 2, overlay variant — chosen over push-columns to keep
 * the existing layout untouched).
 *
 * Owns:
 *  - per-device IDB prime status for each phase (read on open)
 *  - per-phase prime AbortControllers + live progress callbacks
 *  - storage estimate
 *  - the "Set up offline cache" empty-state action
 *
 * Does NOT support phase editing (merge/split/configure) in session 3 —
 * defer to a later session. Session 3 ships read-only defaults + prime/
 * re-prime / delete-cache.
 */
export function OfflinePanel({
  trip,
  open,
  onClose,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [records, setRecords] = useState<Map<string, PhaseStatus>>(new Map());
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [livePrime, setLivePrime] = useState<Map<string, PrimeProgress>>(
    new Map(),
  );
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const phases = trip.offlinePhases ?? [];

  // Pre-prime tile counts per phase. Cheap-ish (~10ms each for 10 phases)
  // but only computed when the panel opens.
  const tileCounts = useMemo(() => {
    if (!open) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const phase of phases) {
      const { coords } = computePhaseGeometry(phase, trip);
      m.set(phase.id, enumerateTiles(coords, phase.bufferMi, 6, phase.maxZoom).length);
    }
    return m;
    // phases reference is stable per render of the parent (RSC).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trip.id, phases.length]);

  const reload = async () => {
    if (typeof indexedDB === "undefined") return;
    const list = await listPhaseStatusesForTrip(trip.id);
    setRecords(new Map(list.map((r) => [r.phaseId, r])));
    setStorage(await estimateStorage());
  };

  useEffect(() => {
    if (!open) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trip.id]);

  // Abort any in-flight primes when the panel unmounts (e.g. slideup
  // dismissal). The prime loop persists progress in batches of 25 so a
  // mid-flight tab close leaves the phase in `partial`.
  useEffect(() => {
    return () => {
      for (const ac of controllersRef.current.values()) ac.abort();
      controllersRef.current.clear();
    };
  }, []);

  async function handleSetup() {
    setSetupBusy(true);
    try {
      const defaults = suggestDefaultPhases(trip);
      const r = await setOfflinePhasesAction(trip.id, defaults);
      if (r.ok) router.refresh();
    } finally {
      setSetupBusy(false);
    }
  }

  async function handlePrime(phase: OfflinePhase) {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;

    // First prime ever on this device: request persistent storage so iOS
    // doesn't evict the cache under pressure (Safari treats persist as a
    // hint, not a contract — but it's the closest we can get).
    await ensurePersisted();

    const { coords } = computePhaseGeometry(phase, trip);
    const tiles = enumerateTiles(coords, phase.bufferMi, 6, phase.maxZoom);
    const hash = hashPhasePolyline(coords);

    const ac = new AbortController();
    controllersRef.current.set(phase.id, ac);
    setLivePrime((m) => new Map(m).set(phase.id, {
      tilesPrimed: 0, tilesTotal: tiles.length, failedCount: 0,
    }));

    try {
      const result = await primePhase({
        tripId: trip.id,
        phaseId: phase.id,
        tilesetIds: TILESET_IDS,
        tilesetVersion: CURRENT_TILESET_VERSION,
        tiles,
        mapboxToken: token,
        primedPolylineHash: hash,
        signal: ac.signal,
        onProgress: (p) =>
          setLivePrime((m) => new Map(m).set(phase.id, p)),
      });
      if (result.status === "ready") {
        await setOfflinePhaseHashAction(
          trip.id, phase.id, hash, CURRENT_TILESET_VERSION,
        );
        router.refresh();
      }
    } finally {
      controllersRef.current.delete(phase.id);
      setLivePrime((m) => {
        const n = new Map(m);
        n.delete(phase.id);
        return n;
      });
      await reload();
    }
  }

  function handlePause(phaseId: string) {
    controllersRef.current.get(phaseId)?.abort();
  }

  async function handleDelete(phase: OfflinePhase) {
    controllersRef.current.get(phase.id)?.abort();
    await caches.delete(phaseCacheName(phase.id, CURRENT_TILESET_VERSION));
    await deletePhaseStatus(trip.id, phase.id);
    await reload();
  }

  async function handleReprime(phase: OfflinePhase) {
    // Wipe the cache + IDB record so primePhase starts fresh (and the
    // pre-fetch dedupe set is empty).
    await caches.delete(phaseCacheName(phase.id, CURRENT_TILESET_VERSION));
    await deletePhaseStatus(trip.id, phase.id);
    await handlePrime(phase);
  }

  const primedCount = phases.filter((p) => {
    const r = records.get(p.id);
    return r?.status === "ready";
  }).length;

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={open ? onClose : undefined}
        className={`absolute inset-0 z-30 bg-black/40 transition-opacity duration-200 ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-label="Offline maps"
        aria-modal="true"
        className={`absolute top-0 right-0 bottom-0 z-40 w-[440px] max-w-full bg-bg-panel border-l border-border-subtle shadow-2xl transition-transform duration-300 ease-out flex flex-col ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between h-14 px-4 border-b border-border-subtle shrink-0">
          <h2 className="font-display uppercase text-[12px] tracking-[0.16em] text-text-primary">
            Offline cache
          </h2>
          <button
            type="button"
            aria-label="Close offline maps"
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-white/[0.04]"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </header>

        <StorageBand
          storage={storage}
          primedCount={primedCount}
          totalPhases={phases.length}
        />

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {phases.length === 0 ? (
            <EmptyState onSetup={handleSetup} busy={setupBusy} dayCount={trip.days.length} />
          ) : (
            <ul className="flex flex-col gap-2">
              {phases.map((phase) => {
                const record = records.get(phase.id) ?? null;
                const display = getPhaseDisplayStatus(phase, trip, record);
                const live = livePrime.get(phase.id);
                const totalMiles = sumPhaseMiles(phase, trip);
                const tileCount = tileCounts.get(phase.id) ?? 0;
                const estMb = Math.round((tileCount * AVG_TILE_KB) / 1024);
                return (
                  <PhaseRow
                    key={phase.id}
                    phase={phase}
                    display={display}
                    live={live}
                    totalMiles={totalMiles}
                    estMb={estMb}
                    onPrime={() => handlePrime(phase)}
                    onPause={() => handlePause(phase.id)}
                    onReprime={() => handleReprime(phase)}
                    onDelete={() => handleDelete(phase)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- subviews

function StorageBand({
  storage,
  primedCount,
  totalPhases,
}: {
  storage: StorageEstimate | null;
  primedCount: number;
  totalPhases: number;
}) {
  const percent = storage?.percentUsed ?? 0;
  const usedMb = storage ? (storage.usage / 1024 / 1024).toFixed(0) : "—";
  const quotaMb = storage ? (storage.quota / 1024 / 1024).toFixed(0) : "—";
  return (
    <div className="px-4 py-3 border-b border-border-subtle shrink-0">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="font-mono text-[11px] tracking-wide text-text-muted uppercase">
          Storage
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {totalPhases > 0 ? `${primedCount} of ${totalPhases} primed` : ""}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-bg-base overflow-hidden">
        <div
          className="h-full bg-amber transition-all"
          style={{ width: storage ? `${Math.min(percent, 100)}%` : "0%" }}
        />
      </div>
      <div className="mt-1 font-mono text-[11px] text-text-muted">
        {usedMb} MB / {quotaMb} MB
      </div>
    </div>
  );
}

function EmptyState({
  onSetup,
  busy,
  dayCount,
}: {
  onSetup: () => void;
  busy: boolean;
  dayCount: number;
}) {
  const phaseCount = Math.max(1, Math.ceil(dayCount / 7));
  return (
    <div className="flex flex-col items-start gap-4 py-8">
      <p className="font-sans text-sm text-text-primary leading-relaxed">
        Download map tiles for offline use during low-connectivity stretches.
        Defaults to {phaseCount} {phaseCount === 1 ? "phase" : "phases"} of ~7 days each.
      </p>
      <p className="font-sans text-xs text-text-muted leading-relaxed">
        You can prime phases individually below; each download is ~300–800 MB.
      </p>
      <button
        type="button"
        onClick={onSetup}
        disabled={busy}
        className="inline-flex items-center h-10 px-5 rounded-full bg-button-primary hover:bg-button-primary-hover border border-button-primary-border text-text-primary font-sans font-semibold text-sm tracking-wide disabled:opacity-50"
      >
        {busy ? "Setting up…" : "Set up offline cache"}
      </button>
    </div>
  );
}

function PhaseRow({
  phase,
  display,
  live,
  totalMiles,
  estMb,
  onPrime,
  onPause,
  onReprime,
  onDelete,
}: {
  phase: OfflinePhase;
  display: PhaseDisplayStatus;
  live: PrimeProgress | undefined;
  totalMiles: number;
  estMb: number;
  onPrime: () => void;
  onPause: () => void;
  onReprime: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="font-sans text-[13px] font-semibold text-text-primary">
          {phase.label}
        </span>
        <span className="font-mono text-[11px] text-text-muted shrink-0">
          {totalMiles > 0 ? `${totalMiles.toLocaleString()} mi` : ""}
        </span>
      </div>
      <PhaseStatusLine display={display} live={live} estMb={estMb} />
      <PhaseActions
        display={display}
        onPrime={onPrime}
        onPause={onPause}
        onReprime={onReprime}
        onDelete={onDelete}
      />
    </li>
  );
}

function PhaseStatusLine({
  display,
  live,
  estMb,
}: {
  display: PhaseDisplayStatus;
  live: PrimeProgress | undefined;
  estMb: number;
}) {
  // Live progress overrides the IDB-derived display while a prime is
  // actively running — the IDB record only updates every 25 tiles, so
  // the on-screen counter would feel chunky otherwise.
  if (live) {
    const pct = live.tilesTotal > 0 ? (live.tilesPrimed / live.tilesTotal) * 100 : 0;
    return (
      <div className="my-2">
        <div className="font-mono text-[11px] text-text-muted mb-1">
          {live.tilesPrimed.toLocaleString()} / {live.tilesTotal.toLocaleString()} tiles
        </div>
        <div className="h-1 w-full rounded-full bg-bg-base overflow-hidden">
          <div className="h-full bg-amber transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (display.kind === "not-primed") {
    return (
      <p className="font-mono text-[11px] text-text-muted my-2">
        Not primed · ~{estMb.toLocaleString()} MB
      </p>
    );
  }
  if (display.kind === "ready") {
    return (
      <p className="my-2 font-mono text-[11px] text-amber flex items-center gap-1.5">
        <CheckCircle2 className="w-3 h-3" />
        Primed {display.primedAt ? formatPrimedAt(display.primedAt) : ""}
      </p>
    );
  }
  if (display.kind === "partial") {
    const pct = display.tilesTotal > 0 ? (display.tilesPrimed / display.tilesTotal) * 100 : 0;
    return (
      <div className="my-2">
        <div className="font-mono text-[11px] text-text-muted mb-1">
          Paused · {display.tilesPrimed.toLocaleString()} / {display.tilesTotal.toLocaleString()} tiles
        </div>
        <div className="h-1 w-full rounded-full bg-bg-base overflow-hidden">
          <div className="h-full bg-amber/60" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (display.kind === "stale") {
    return (
      <p className="my-2 font-mono text-[11px] text-amber-light flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" />
        {display.reason === "polyline"
          ? "Trip changed since prime"
          : "Map data updated since prime"}
      </p>
    );
  }
  if (display.kind === "error") {
    return (
      <p className="my-2 font-mono text-[11px] text-input-error flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" />
        {display.message}
      </p>
    );
  }
  return null;
}

function PhaseActions({
  display,
  onPrime,
  onPause,
  onReprime,
  onDelete,
}: {
  display: PhaseDisplayStatus;
  onPrime: () => void;
  onPause: () => void;
  onReprime: () => void;
  onDelete: () => void;
}) {
  // Wired to phase-status state; mirrors the spec from session-3 step 8.
  switch (display.kind) {
    case "not-primed":
      return (
        <div className="flex gap-2">
          <PrimaryButton onClick={onPrime}>Prime</PrimaryButton>
        </div>
      );
    case "priming":
      return (
        <div className="flex gap-2">
          <SecondaryButton onClick={onPause}>Pause</SecondaryButton>
        </div>
      );
    case "partial":
      return (
        <div className="flex gap-2">
          <PrimaryButton onClick={onPrime}>Resume</PrimaryButton>
          <DangerButton onClick={onDelete} aria-label="Delete cache">
            <Trash2 className="w-3.5 h-3.5" />
          </DangerButton>
        </div>
      );
    case "ready":
      return (
        <div className="flex gap-2">
          <SecondaryButton onClick={onReprime}>Re-prime</SecondaryButton>
          <DangerButton onClick={onDelete} aria-label="Delete cache">
            <Trash2 className="w-3.5 h-3.5" />
          </DangerButton>
        </div>
      );
    case "stale":
      return (
        <div className="flex gap-2">
          <PrimaryButton onClick={onReprime}>Re-prime to update</PrimaryButton>
          <DangerButton onClick={onDelete} aria-label="Delete cache">
            <Trash2 className="w-3.5 h-3.5" />
          </DangerButton>
        </div>
      );
    case "error":
      return (
        <div className="flex gap-2">
          <PrimaryButton onClick={onReprime}>Retry</PrimaryButton>
          <DangerButton onClick={onDelete} aria-label="Delete and start over">
            <Trash2 className="w-3.5 h-3.5" />
          </DangerButton>
        </div>
      );
    default:
      return null;
  }
}

function PrimaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center h-8 px-3 rounded-full bg-amber text-bg-base font-sans text-xs font-semibold hover:opacity-90"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center h-8 px-3 rounded-full bg-transparent border border-border-mid text-text-primary font-sans text-xs font-semibold hover:bg-white/[0.04]"
    >
      {children}
    </button>
  );
}

function DangerButton({
  children,
  onClick,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-transparent border border-border-mid text-text-muted hover:text-input-error hover:border-input-error"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- helpers

function sumPhaseMiles(phase: OfflinePhase, trip: Trip): number {
  const ids = new Set(phase.dayIds);
  return trip.days
    .filter((d) => ids.has(d.id))
    .reduce((sum, d) => sum + (d.miles ?? 0), 0);
}

function formatPrimedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

async function ensurePersisted(): Promise<void> {
  if (typeof navigator === "undefined") return;
  if (!navigator.storage?.persist || !navigator.storage?.persisted) return;
  try {
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch {
    /* iOS may reject silently — fine, cache still works without persistence */
  }
}
