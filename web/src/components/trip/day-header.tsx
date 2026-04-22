"use client";

import { useState, useTransition } from "react";
import { Pencil, Move, Plus, Trash2, Check, X } from "lucide-react";
import { KebabMenu } from "@/components/primitives/kebab-menu";
import { renameDayAction, deleteDayAction } from "@/lib/trips/actions";
import type { Day } from "@/lib/trips/types";

/**
 * Day header row — span label + date + kebab menu with day actions.
 *
 * Rename: kebab → inline edit input, Enter to save, Escape to cancel.
 * Delete: kebab → native confirm → server action.
 * Move/Add: stubbed (not in this round).
 */
export function DayHeader({ tripId, day }: { tripId: string; day: Day }) {
  const dayDate = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(day.label);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const startRename = () => {
    setDraft(day.label);
    setError(null);
    setEditing(true);
  };

  const cancelRename = () => {
    setEditing(false);
    setError(null);
  };

  const saveRename = () => {
    const trimmed = draft.trim();
    if (trimmed === day.label) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await renameDayAction(tripId, day.id, trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      setError(null);
    });
  };

  const confirmDelete = () => {
    const ok = window.confirm(
      `Delete Day ${day.dayNumber}? All waypoints and the overnight selection will be removed.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteDayAction(tripId, day.id);
      if (!result.ok) setError(result.error);
    });
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2 p-4 bg-bg-card border border-input-border-focus rounded">
        <span className="text-sm text-text-muted font-mono">
          Day {day.dayNumber} — {dayDate}
        </span>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") cancelRename();
            }}
            disabled={isPending}
            aria-label="Day label"
            className="form-field flex-1"
          />
          <button
            type="button"
            aria-label="Save"
            onClick={saveRename}
            disabled={isPending}
            className="w-9 h-9 flex items-center justify-center rounded bg-button-primary border border-button-primary-border text-text-primary disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Cancel"
            onClick={cancelRename}
            disabled={isPending}
            className="w-9 h-9 flex items-center justify-center rounded bg-bg-nav-btn border border-border-subtle text-text-primary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && (
          <span className="text-xs text-input-error font-mono" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-4 bg-bg-card border border-border-subtle rounded">
      <div className="flex-1 flex flex-col gap-0.5">
        <span className="text-sm text-text-muted font-mono">{day.label}</span>
        <span className="font-sans font-bold text-text-primary">
          Day {day.dayNumber} — {dayDate}
        </span>
        {error && (
          <span className="text-xs text-input-error font-mono mt-1" role="alert">
            {error}
          </span>
        )}
      </div>
      <KebabMenu
        triggerLabel={`Day ${day.dayNumber} options`}
        items={[
          { id: "rename", label: "Rename day",              icon: Pencil, onSelect: startRename },
          { id: "move",   label: "Move day",                icon: Move,   onSelect: () => console.log("move", day.id) },
          { id: "add",    label: "Add waypoint or overnight", icon: Plus, onSelect: () => console.log("add", day.id) },
          { id: "delete", label: "Delete day",              icon: Trash2, danger: true, dividerBefore: true, onSelect: confirmDelete },
        ]}
      />
    </div>
  );
}
