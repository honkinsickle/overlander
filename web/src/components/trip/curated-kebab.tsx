"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Trash2, ArrowRightLeft } from "lucide-react";

/**
 * Curated-POI kebab (⋮) — the non-drag edit affordance for a curated POI tile in
 * the read spine (Design B). Two actions: Move to day (opens a day picker) and
 * Delete. Both go through the guarded, geometry-free curated-place actions; a
 * moved POI lands unranked+unpinned on the new day (rescopeOverlays drops its
 * overlays). Curated POIs are overlay (segmentSuggestions), not routed waypoints —
 * this never touches drive geometry.
 *
 * Presentational: it renders the menu and calls back. Optimism / errors live in
 * the caller (DayDetailCorridorColumn), same as the drag repin path.
 */
export type CuratedMenu = {
  /** All days, for the Move-to picker (current day is shown disabled). */
  days: { id: string; label: string }[];
  currentDayId: string;
  onMoveToDay: (toDayId: string) => void;
  onDelete: () => void;
  /** True while this tile's move/delete write is in flight — disables the menu. */
  busy?: boolean;
};

export function CuratedKebab({ menu, placeTitle }: { menu: CuratedMenu; placeTitle: string }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPicking(false);
  };

  const otherDays = menu.days.filter((d) => d.id !== menu.currentDayId);

  return (
    <div ref={rootRef} className="absolute" style={{ top: 2, right: 2 }}>
      <button
        type="button"
        aria-label={`Edit ${placeTitle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={menu.busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
          setPicking(false);
        }}
        className="flex items-center justify-center"
        style={{
          width: 24,
          height: 24,
          color: "var(--text-muted)",
          opacity: menu.busy ? 0.5 : 1,
        }}
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute z-40 flex flex-col overflow-hidden"
          style={{
            top: 26,
            right: 0,
            minWidth: 176,
            maxHeight: 260,
            overflowY: "auto",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-card)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
            padding: 4,
          }}
        >
          {!picking ? (
            <>
              <MenuItem
                icon={<ArrowRightLeft size={15} strokeWidth={1.75} />}
                label="Move to day"
                trailing="›"
                disabled={otherDays.length === 0}
                onClick={() => setPicking(true)}
              />
              <MenuItem
                icon={<Trash2 size={15} strokeWidth={1.75} />}
                label="Delete"
                danger
                onClick={() => {
                  menu.onDelete();
                  close();
                }}
              />
            </>
          ) : (
            <>
              <div
                className="uppercase"
                style={{
                  padding: "6px 8px 4px",
                  fontFamily: "var(--ff-display)",
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  color: "var(--text-muted)",
                }}
              >
                Move to
              </div>
              {otherDays.map((d) => (
                <MenuItem
                  key={d.id}
                  label={d.label}
                  onClick={() => {
                    menu.onMoveToDay(d.id);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  trailing,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  trailing?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center text-left transition-colors hover:bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] disabled:opacity-40"
      style={{
        gap: 8,
        padding: "8px 10px",
        borderRadius: 5,
        fontFamily: "var(--ff-sans)",
        fontSize: 14,
        lineHeight: "18px",
        color: danger ? "var(--danger, #b3452f)" : "var(--text-primary)",
      }}
    >
      {icon && <span className="shrink-0 flex items-center">{icon}</span>}
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {trailing && <span className="shrink-0" style={{ color: "var(--text-muted)" }}>{trailing}</span>}
    </button>
  );
}
