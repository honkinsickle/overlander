"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  Locate,
  LocateFixed,
  LocateOff,
  Map,
  Compass,
} from "lucide-react";
import type { LocationStatus } from "@/lib/location/use-user-location";

/**
 * Right-Edge Toolbar — 3 buttons stacked vertically at the canvas right edge.
 *
 * Order (top → bottom): Nav · Locate · Offline maps.
 *
 * Collapse is owned by the Top Bar chevron, not the toolbar. Nav is still a
 * stub. Locate is wired: it drives the headless UserLocationLayer engine via
 * `trip:setFollow` (center the map on the device GPS + follow) and reflects the
 * engine's broadcast status honestly (denied / unavailable).
 */
export function RightEdgeToolbar() {
  const [loc, setLoc] = useState<{
    status: LocationStatus;
    following: boolean;
  }>({ status: "idle", following: false });

  useEffect(() => {
    const onStatus = (e: Event) => {
      const d = (
        e as CustomEvent<{ status: LocationStatus; following: boolean }>
      ).detail;
      if (d) setLoc({ status: d.status, following: d.following });
    };
    window.addEventListener("trip:locationStatus", onStatus);
    // Sync now, in case the location engine broadcast before we mounted.
    window.dispatchEvent(new CustomEvent("trip:requestLocationStatus"));
    return () => window.removeEventListener("trip:locationStatus", onStatus);
  }, []);

  const { status, following } = loc;
  const unsupported = status === "unsupported";
  const denied = status === "denied";
  const LocateIcon = following ? LocateFixed : denied ? LocateOff : Locate;
  // Honest labels — never a silent no-op. Unsupported disables the control;
  // denied stays tappable (retry) but says so; otherwise it centers/follows.
  const locateLabel = unsupported
    ? "Location unavailable on this device"
    : denied
      ? "Location access denied — enable it in your browser settings"
      : following
        ? "Stop following my location"
        : "Center on my location";

  return (
    <div
      className="absolute right-2 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-1"
      role="toolbar"
      aria-label="Map controls"
    >
      <ToolbarButton label="Start navigation" disabled>
        <Compass className="w-[22px] h-[22px]" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        label={locateLabel}
        active={following}
        disabled={unsupported}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("trip:setFollow", {
              detail: { follow: !following },
            }),
          )
        }
      >
        <LocateIcon className="w-[22px] h-[22px]" strokeWidth={1.75} />
      </ToolbarButton>
      <ToolbarButton
        label="Offline maps"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("trip:openOfflinePanel"));
        }}
      >
        <span className="relative inline-block w-[22px] h-[22px]">
          <Map className="w-[22px] h-[22px]" strokeWidth={1.75} />
          <ArrowDown
            className="absolute -bottom-0.5 -right-0.5 w-3 h-3"
            strokeWidth={2.5}
          />
        </span>
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
