"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, MapPin, Route, X } from "lucide-react";
import {
  parseReplanAction,
  replanAction,
  applyReplanAction,
  discardReplanAction,
  type ParseReplanResult,
} from "@/lib/itinerary/edit-actions";
import type { ReplanDiff } from "@/lib/itinerary/plan-diff";

/**
 * Living-plan re-plan flow (dev-gated), mounted inside FindNearbyPanel when
 * the user clicks the suggestion row:
 *
 *   parsing → confirm (parsed table · [Re-plan trip]/[Cancel])
 *           → replanning (the paid step, several minutes)
 *           → diff ([Apply]/[Keep original])
 *           → applying → done (router.refresh → slideup re-renders)
 *
 * Nothing is persisted until Apply; Keep original drops the staged row.
 */

type Phase =
  | { name: "parsing" }
  | { name: "confirm"; parse: Extract<ParseReplanResult, { kind: "confirm" }> }
  | { name: "unsupported"; reason: string }
  | { name: "replanning"; parse: Extract<ParseReplanResult, { kind: "confirm" }> }
  | { name: "diff"; diff: ReplanDiff }
  | { name: "applying" }
  | { name: "error"; message: string };

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const LABEL: React.CSSProperties = {
  fontFamily: "var(--ff-display)",
  fontSize: 11,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};
const VALUE: React.CSSProperties = {
  fontFamily: "var(--ff-sans)",
  fontSize: 14,
  color: "var(--text-primary)",
};

export function ReplanSheet({
  tripId,
  request,
  onClose,
}: {
  tripId: string;
  request: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ name: "parsing" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await parseReplanAction(tripId, request);
      if (cancelled) return;
      if (!r.ok) setPhase({ name: "error", message: r.error });
      else if (r.kind === "unsupported")
        setPhase({ name: "unsupported", reason: r.reason });
      else setPhase({ name: "confirm", parse: r });
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, request]);

  const runReplan = async (
    parse: Extract<ParseReplanResult, { kind: "confirm" }>,
  ) => {
    setPhase({ name: "replanning", parse });
    const r = await replanAction(tripId, parse.place, parse.date, parse.targetAnchor);
    if (!r.ok) setPhase({ name: "error", message: r.error });
    else setPhase({ name: "diff", diff: r.diff });
  };

  const apply = async () => {
    setPhase({ name: "applying" });
    const r = await applyReplanAction(tripId);
    if (!r.ok) {
      setPhase({ name: "error", message: r.error });
      return;
    }
    // Fresh payload → the slideup re-renders with the applied plan.
    router.refresh();
    window.dispatchEvent(new CustomEvent("trip:clearSearch"));
    onClose();
  };

  const keepOriginal = async () => {
    await discardReplanAction(tripId);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-label="Re-plan trip"
      className="flex flex-col flex-1 min-h-0 overflow-y-auto no-scrollbar"
      style={{ padding: "8px 20px 24px" }}
    >
      {/* Header */}
      <div className="flex items-center" style={{ gap: 10, paddingBottom: 14 }}>
        <Route className="w-4 h-4" style={{ color: "var(--amber)" }} />
        <span
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 13,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--amber)",
            flex: 1,
          }}
        >
          Re-plan trip
        </span>
        <button type="button" aria-label="Close re-plan" onClick={onClose}>
          <X className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
        </button>
      </div>

      <div style={{ ...VALUE, fontStyle: "italic", paddingBottom: 16 }}>
        “{request}”
      </div>

      {phase.name === "parsing" && (
        <Busy text="Understanding the request…" />
      )}

      {phase.name === "unsupported" && (
        <>
          <p style={{ ...VALUE, color: "var(--text-muted)" }}>{phase.reason}</p>
          <SheetButton onClick={onClose} kind="ghost" label="Close" />
        </>
      )}

      {phase.name === "error" && (
        <>
          <p style={{ ...VALUE, color: "#E08A7A" }}>{phase.message}</p>
          <SheetButton onClick={onClose} kind="ghost" label="Close" />
        </>
      )}

      {phase.name === "confirm" && (
        <>
          <div
            className="flex flex-col"
            style={{
              gap: 12,
              padding: 16,
              borderRadius: 10,
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border-mid)",
            }}
          >
            <FieldRow
              icon={<MapPin className="w-3.5 h-3.5" />}
              label="Be at"
              value={phase.parse.resolvedName}
              hint={
                phase.parse.anchorDistanceMi !== null
                  ? `${phase.parse.anchorDistanceMi} mi from ${phase.parse.targetAnchor}`
                  : undefined
              }
            />
            <FieldRow
              icon={<CalendarCheck className="w-3.5 h-3.5" />}
              label="On"
              value={fmtDate(phase.parse.date)}
              hint={
                phase.parse.before.datePin === "flexible"
                  ? "was flexible"
                  : `was ${phase.parse.before.datePin}${phase.parse.before.date ? ` ${fmtDate(phase.parse.before.date)}` : ""}`
              }
            />
            <FieldRow
              icon={<Route className="w-3.5 h-3.5" />}
              label="Plan stop"
              value={phase.parse.targetAnchor}
              hint={`stays ${phase.parse.after.dwell > 0 ? `${phase.parse.after.dwell}-night` : "pass-through"}, now fixed ${fmtDate(phase.parse.after.date ?? phase.parse.date)}`}
            />
          </div>
          <div className="flex" style={{ gap: 10, paddingTop: 16 }}>
            <SheetButton
              onClick={() => runReplan(phase.parse)}
              kind="primary"
              label="Re-plan trip"
            />
            <SheetButton onClick={onClose} kind="ghost" label="Cancel" />
          </div>
          <p style={{ ...LABEL, paddingTop: 12 }}>
            Re-planning regenerates the itinerary around this date — a few
            minutes. Nothing changes until you apply the result.
          </p>
        </>
      )}

      {phase.name === "replanning" && (
        <Busy text="Re-planning — routing, generation, audit. This takes a few minutes…" />
      )}

      {phase.name === "diff" && (
        <>
          <div
            className="flex flex-col"
            style={{
              gap: 8,
              padding: 16,
              borderRadius: 10,
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border-mid)",
            }}
          >
            <div style={VALUE}>
              ✓ {phase.diff.pinned.place} → {fmtDate(phase.diff.pinned.date)}
            </div>
            <div style={VALUE}>
              {phase.diff.endpointsHeld.start && phase.diff.endpointsHeld.end
                ? "✓ Start and end dates held"
                : "⚠ Trip endpoints moved"}
            </div>
            {phase.diff.stopsAdded.length > 0 && (
              <div style={{ ...VALUE, color: "#9CD4B0" }}>
                + {phase.diff.stopsAdded.join(" · ")}
              </div>
            )}
            {phase.diff.stopsRemoved.length > 0 && (
              <div style={{ ...VALUE, color: "var(--text-muted)" }}>
                − {phase.diff.stopsRemoved.join(" · ")}
              </div>
            )}
            <div style={{ ...VALUE, color: "var(--text-muted)" }}>
              Rest days: {phase.diff.layovers.before} → {phase.diff.layovers.after}
            </div>
            <div
              style={{
                borderTop: "1px solid var(--border-subtle)",
                marginTop: 6,
                paddingTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {phase.diff.days.map((d) => (
                <div
                  key={d.date}
                  className="flex"
                  style={{
                    gap: 10,
                    fontFamily: "var(--ff-mono)",
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  <span style={{ width: 84, flexShrink: 0 }}>{fmtDate(d.date)}</span>
                  <span style={{ width: 52, flexShrink: 0, textAlign: "right" }}>
                    {d.miles} mi
                  </span>
                  <span
                    className="truncate"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex" style={{ gap: 10, paddingTop: 16 }}>
            <SheetButton onClick={apply} kind="primary" label="Apply re-plan" />
            <SheetButton onClick={keepOriginal} kind="ghost" label="Keep original" />
          </div>
        </>
      )}

      {phase.name === "applying" && <Busy text="Applying the new plan…" />}
    </div>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <div className="flex items-center" style={{ gap: 10, padding: "18px 0" }}>
      <Loader2
        className="w-4 h-4 animate-spin"
        style={{ color: "var(--amber)" }}
      />
      <span style={{ fontFamily: "var(--ff-sans)", fontSize: 14, color: "var(--text-muted)" }}>
        {text}
      </span>
    </div>
  );
}

function FieldRow({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start" style={{ gap: 10 }}>
      <span style={{ color: "var(--amber)", paddingTop: 2 }}>{icon}</span>
      <span style={{ ...LABEL, width: 72, flexShrink: 0, paddingTop: 3 }}>{label}</span>
      <span className="flex flex-col" style={{ gap: 2 }}>
        <span style={VALUE}>{value}</span>
        {hint && <span style={LABEL}>{hint}</span>}
      </span>
    </div>
  );
}

type ButtonKind = "primary" | "ghost";

function SheetButton({
  onClick,
  label,
  kind,
}: {
  onClick: () => void;
  label: string;
  kind: ButtonKind;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={
        kind === "primary"
          ? {
              padding: "10px 18px",
              borderRadius: 8,
              backgroundColor: "var(--button-primary)",
              color: "var(--text-primary)",
              fontFamily: "var(--ff-sans)",
              fontSize: 14,
              fontWeight: 600,
            }
          : {
              padding: "10px 18px",
              borderRadius: 8,
              border: "1px solid var(--border-mid)",
              color: "var(--text-muted)",
              fontFamily: "var(--ff-sans)",
              fontSize: 14,
            }
      }
    >
      {label}
    </button>
  );
}
