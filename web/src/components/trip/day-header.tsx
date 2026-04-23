"use client";

import { useState, useTransition } from "react";
import { Pencil, Move, Plus, Trash2, Check, X } from "lucide-react";
import { KebabMenu } from "@/components/primitives/kebab-menu";
import { renameDayAction, deleteDayAction } from "@/lib/trips/actions";
import type { Day } from "@/lib/trips/types";

/**
 * Day Section Header — Paper B3Q-0 / GDI-0.
 *
 * From `get_computed_styles` on GDI-0:
 *   flex-col justify-center · 440×80 · padding-left 18 (only!) · gap 2
 *   bg --bg-panel · border-b 1 solid --border-mid
 *
 * Children:
 *   Route (GDJ-0): Barlow 400 · 14/18 · --text-muted · pre-wrap
 *   Title (GDK-0): Barlow 400 · 24/28 · --amber-light · pre-wrap
 *
 * Kebab is NOT in Paper GDI-0. Kept as supplemental (absolutely
 * positioned, right-aligned) so the base layout stays pixel-exact and
 * the rename/delete flow still works.
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
      <header className="flex flex-col gap-[2px] h-[80px] pl-[18px] pr-4 justify-center bg-bg-panel border-b border-border-mid">
        <span className="font-sans text-[14px] leading-[18px] text-text-muted">
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
      </header>
    );
  }

  return (
    <header className="relative flex flex-col justify-center gap-[2px] h-[80px] pl-[18px] bg-bg-panel border-b border-border-mid">
      <span className="font-sans text-[14px] leading-[18px] text-text-muted">
        {day.label}
      </span>
      <h2 className="font-sans text-[24px] leading-[28px] text-amber-light">
        Day {day.dayNumber} &mdash; {dayDate}
      </h2>
      {error && (
        <span className="font-mono text-xs text-input-error" role="alert">
          {error}
        </span>
      )}

      {/* Supplemental: kebab not in GDI-0; overlay top-right so it
       *  doesn't disturb the flex layout. */}
      <div className="absolute top-1/2 -translate-y-1/2 right-3">
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
    </header>
  );
}
