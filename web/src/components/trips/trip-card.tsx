"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, Copy, Loader2, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import {
  renameTrip,
  deleteTrip,
  duplicateTrip,
  setTripState,
  type TripState,
} from "@/app/trips/actions";
import type { UserTripSummary } from "@/lib/trips/list-user-trips";

const STATE_LABELS: Record<UserTripSummary["state"], string> = {
  draft: "Draft",
  active: "Active",
  logged: "Logged",
};

const STATE_COLORS: Record<UserTripSummary["state"], string> = {
  draft: "bg-bg-nav-btn text-text-secondary",
  active: "bg-amber/20 text-amber",
  logged: "bg-bg-nav-btn text-text-primary",
};

type Mode = "idle" | "renaming" | "confirm-delete";

export function TripCard({ trip }: { trip: UserTripSummary }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(trip.title);

  // Keep local title in sync if the server-list updates underneath us
  // (e.g. revalidatePath after rename on another tab).
  useEffect(() => setTitle(trip.title), [trip.title]);

  function reset() {
    setMode("idle");
    setError(null);
  }

  function submitRename(next: string) {
    const draft = next.trim();
    if (!draft || draft === trip.title) {
      reset();
      return;
    }
    startTransition(async () => {
      const result = await renameTrip(trip.id, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTitle(draft);
      reset();
    });
  }

  function submitDelete() {
    startTransition(async () => {
      const result = await deleteTrip(trip.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The revalidate inside the action will refresh the parent list;
      // this card disappears with it.
    });
  }

  function submitDuplicate() {
    setError(null);
    startTransition(async () => {
      const result = await duplicateTrip(trip.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Revalidate inside the action drops the new card at the top of
      // the list (ordered by updated_at desc).
    });
  }

  return (
    <article className="relative flex gap-4 p-4 rounded-lg bg-bg-panel border border-border-subtle hover:border-amber/60 transition-colors group">
      <div
        className="w-32 h-24 rounded shrink-0 bg-cover bg-center bg-bg-nav-btn"
        style={
          trip.heroImage ? { backgroundImage: `url(${trip.heroImage})` } : undefined
        }
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        {mode === "renaming" ? (
          <RenameRow
            initialTitle={title}
            pending={pending}
            onSubmit={submitRename}
            onCancel={reset}
          />
        ) : (
          <div className="flex items-start justify-between gap-3 pr-10">
            <Link
              href={`/trip/${trip.id}`}
              className="font-display text-lg leading-tight truncate text-text-primary hover:text-amber transition-colors"
            >
              {title}
            </Link>
            <StatePill tripId={trip.id} state={trip.state} />
          </div>
        )}
        <p className="font-sans text-sm text-text-secondary truncate">
          {trip.startLocation} → {trip.endLocation}
        </p>
        <p className="font-mono text-[11px] tracking-[0.12em] text-text-secondary/80">
          {formatDateRange(trip.startDate, trip.endDate)} · {trip.dayCount}{" "}
          {trip.dayCount === 1 ? "day" : "days"}
        </p>
        {mode === "confirm-delete" && (
          <ConfirmDeleteRow
            pending={pending}
            onConfirm={submitDelete}
            onCancel={reset}
          />
        )}
        {error && (
          <p className="font-mono text-[11px] text-red-400">{error}</p>
        )}
      </div>
      {mode === "idle" && (
        <Kebab
          onRename={() => setMode("renaming")}
          onDuplicate={submitDuplicate}
          onDelete={() => setMode("confirm-delete")}
        />
      )}
    </article>
  );
}

function RenameRow({
  initialTitle,
  pending,
  onSubmit,
  onCancel,
}: {
  initialTitle: string;
  pending: boolean;
  onSubmit: (next: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(inputRef.current?.value ?? "");
      }}
      className="flex items-center gap-2"
    >
      <input
        ref={inputRef}
        defaultValue={initialTitle}
        disabled={pending}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="flex-1 min-w-0 h-9 px-2 rounded bg-bg-base border border-border-subtle font-display text-lg text-text-primary focus:outline-none focus:border-amber"
      />
      <button
        type="submit"
        disabled={pending}
        aria-label="Save name"
        className="w-8 h-8 rounded bg-amber text-bg-base flex items-center justify-center hover:opacity-90 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        aria-label="Cancel"
        className="w-8 h-8 rounded border border-border-subtle text-text-secondary flex items-center justify-center hover:text-text-primary"
      >
        <X className="w-4 h-4" />
      </button>
    </form>
  );
}

function ConfirmDeleteRow({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-3 p-2 rounded bg-red-500/10 border border-red-500/30">
      <span className="font-sans text-sm text-text-primary">
        Delete this trip? Can't be undone.
      </span>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-8 px-3 rounded font-sans text-sm text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-8 px-3 rounded bg-red-500 text-white font-sans text-sm flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60"
        >
          {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Delete
        </button>
      </div>
    </div>
  );
}

function Kebab({
  onRename,
  onDuplicate,
  onDelete,
}: {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="absolute top-3 right-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Trip actions"
        aria-expanded={open}
        className="w-8 h-8 rounded flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-nav-btn opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-40 bg-bg-panel border border-border-subtle rounded shadow-lg flex flex-col py-1 z-10">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
            className="flex items-center gap-2 px-3 py-2 text-text-primary hover:bg-bg-nav-btn font-sans text-sm text-left"
          >
            <Pencil className="w-4 h-4" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDuplicate();
            }}
            className="flex items-center gap-2 px-3 py-2 text-text-primary hover:bg-bg-nav-btn font-sans text-sm text-left"
          >
            <Copy className="w-4 h-4" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-bg-nav-btn font-sans text-sm text-left"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function StatePill({ tripId, state }: { tripId: string; state: TripState }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function choose(next: TripState) {
    setError(null);
    if (next === state) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const result = await setTripState(tripId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-label={`State: ${STATE_LABELS[state]}. Click to change.`}
        aria-expanded={open}
        className={`flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-0.5 rounded hover:opacity-80 disabled:opacity-60 ${STATE_COLORS[state]}`}
      >
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
        {STATE_LABELS[state]}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-32 bg-bg-panel border border-border-subtle rounded shadow-lg flex flex-col py-1 z-10">
          {(Object.keys(STATE_LABELS) as TripState[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => choose(s)}
              className="flex items-center justify-between px-3 py-1.5 text-text-primary hover:bg-bg-nav-btn font-sans text-sm text-left"
            >
              {STATE_LABELS[s]}
              {s === state && <Check className="w-3.5 h-3.5 text-amber" />}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="absolute top-full right-0 mt-1 font-mono text-[10px] text-red-400 whitespace-nowrap">
          {error}
        </p>
      )}
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}
