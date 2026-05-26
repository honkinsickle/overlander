"use client";

import { Locate, Maximize2, Compass } from "lucide-react";

/**
 * Right-Edge Toolbar — 3 buttons stacked vertically at the canvas right edge.
 * Per v2 spec (docs/design/slideup-overlay-states-v2.md §2.2 + §3).
 *
 * Order (top → bottom): Nav · Locate · Fullscreen.
 *
 * This round only ships the Default-state version; Nav and Fullscreen
 * triggers are stubs (placeholder onClick handlers). The Locate button
 * is wired separately in user-location-layer.tsx today and will be
 * folded into here in a follow-up — currently this button is a visual
 * placeholder.
 */
export function RightEdgeToolbar() {
  return (
    <div
      className="absolute right-2 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1"
      role="toolbar"
      aria-label="Map controls"
    >
      <ToolbarButton label="Start navigation" disabled>
        <Compass className="w-[22px] h-[22px]" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton label="Follow my location" disabled>
        <Locate className="w-[22px] h-[22px]" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton label="Toggle fullscreen" disabled>
        <Maximize2 className="w-[22px] h-[22px]" strokeWidth={1.75} />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center w-[60px] h-[60px] rounded-lg backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: active ? "rgba(253,186,116,0.15)" : "rgba(29,30,31,0.56)",
        border: active
          ? "1px solid rgba(253,186,116,0.4)"
          : "1px solid rgba(255,255,255,0.18)",
        color: active ? "#FDBA74" : "#E9E9E7",
      }}
    >
      {children}
    </button>
  );
}
