"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, Loader2, MapPin, Navigation, PlusCircle, Route, X } from "lucide-react";
import {
  parseReplanAction,
  replanAction,
  addStopAction,
  applyReplanAction,
  discardReplanAction,
  resolveCleaveAction,
  type ParseReplanResult,
  type CleaveDisplay,
} from "@/lib/itinerary/edit-actions";
import type { AddStopMode } from "@/lib/itinerary/edit";
import type { NowSpec } from "@/lib/itinerary/partial-replan";
import type { ReplanDiff } from "@/lib/itinerary/plan-diff";

type ConfirmParse = Extract<ParseReplanResult, { kind: "confirm" }>;
type AddStopParse = Extract<ParseReplanResult, { kind: "add-stop" }>;

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
  | { name: "confirm"; parse: ConfirmParse }
  | { name: "confirm-addstop"; parse: AddStopParse }
  | { name: "unsupported"; reason: string }
  | { name: "replanning"; label: string }
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
  // The signature of the confirmed edit — carried to apply() so it can only
  // promote the pending row it actually confirmed (stale-pending guard).
  const [signature, setSignature] = useState<string | null>(null);

  // Partial re-plan: where "now" is. Empty override → date-derived default;
  // "day 9" → atDay; anything else → atPlace. Drives the tail cleave.
  const [nowText, setNowText] = useState("");
  const [editingNow, setEditingNow] = useState(false);
  const [cleave, setCleave] = useState<CleaveDisplay | null>(null);
  const nowSpec = useMemo<NowSpec>(() => {
    const t = nowText.trim();
    if (!t) return { today: new Date().toISOString().slice(0, 10) };
    const m = t.match(/day\s*(\d+)/i);
    if (m) return { atDay: parseInt(m[1], 10) };
    return { atPlace: t };
  }, [nowText]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await parseReplanAction(tripId, request);
      if (cancelled) return;
      if (!r.ok) setPhase({ name: "error", message: r.error });
      else if (r.kind === "unsupported")
        setPhase({ name: "unsupported", reason: r.reason });
      else if (r.kind === "add-stop")
        setPhase({ name: "confirm-addstop", parse: r });
      else setPhase({ name: "confirm", parse: r });
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, request]);

  // Resolve the cleave (free — no spend) whenever "now" changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await resolveCleaveAction(tripId, nowSpec);
      if (!cancelled) setCleave(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [tripId, nowSpec]);

  // Only pass `now` to the paid run when a prefix is actually completed.
  const partialNow: NowSpec | undefined =
    cleave?.ok && !cleave.isFullReplan ? nowSpec : undefined;

  const runReplan = async (parse: ConfirmParse) => {
    setPhase({ name: "replanning", label: `${parse.place} → ${fmtDate(parse.date)}` });
    const r = await replanAction(tripId, parse.place, parse.date, parse.targetAnchor, partialNow);
    if (!r.ok) setPhase({ name: "error", message: r.error });
    else {
      setSignature(r.editSignature);
      setPhase({ name: "diff", diff: r.diff });
    }
  };

  const runAddStop = async (parse: AddStopParse, mode: AddStopMode) => {
    setPhase({
      name: "replanning",
      label:
        mode === "add-days"
          ? `Adding ${parse.place} (+1 day)`
          : `Adding ${parse.place} (keeping your dates)`,
    });
    const r = await addStopAction(tripId, parse.place, mode, partialNow);
    if (!r.ok) setPhase({ name: "error", message: r.error });
    else {
      setSignature(r.editSignature);
      setPhase({ name: "diff", diff: r.diff });
    }
  };

  const apply = async () => {
    if (!signature) return;
    setPhase({ name: "applying" });
    const r = await applyReplanAction(tripId, signature);
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

      {(phase.name === "confirm" || phase.name === "confirm-addstop") &&
        cleave?.ok && (
          <PickingUpRow
            cleave={cleave}
            editing={editingNow}
            nowText={nowText}
            onEdit={() => setEditingNow(true)}
            onChange={setNowText}
            onDone={() => setEditingNow(false)}
          />
        )}

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

      {phase.name === "confirm-addstop" && (
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
              icon={<PlusCircle className="w-3.5 h-3.5" />}
              label="Add"
              value={phase.parse.resolvedName}
              hint={phase.parse.dwell > 0 ? `${phase.parse.dwell}-night stay` : "a stop"}
            />
            <FieldRow
              icon={<Route className="w-3.5 h-3.5" />}
              label="Fits"
              value={`between ${phase.parse.prevAnchor} and ${phase.parse.nextAnchor}`}
              hint={`+${phase.parse.addedMi} mi / +${phase.parse.addedHours} h · ${phase.parse.offsetMi} mi off route`}
            />
          </div>

          {phase.parse.farOffRoute && (
            <p style={{ ...VALUE, color: "#E0B57A", paddingTop: 12 }}>
              ⚠ {phase.parse.resolvedName} is {phase.parse.offsetMi} mi off your
              route — adding it is a big detour. Add it anyway?
            </p>
          )}

          {phase.parse.needsChoice ? (
            <>
              <p style={{ ...VALUE, paddingTop: 16 }}>
                Adding {phase.parse.resolvedName} (+{phase.parse.addedMi} mi) —
                how should it fit?
              </p>
              <div className="flex flex-col" style={{ gap: 10, paddingTop: 12 }}>
                <ModeButton
                  title="Keep your dates"
                  detail="Tightens the surrounding days; Vancouver stays the same."
                  onClick={() => runAddStop(phase.parse, "adjust")}
                />
                <ModeButton
                  title="Add a day"
                  detail="Extends the trip end by one day; nothing else compresses."
                  onClick={() => runAddStop(phase.parse, "add-days")}
                />
                <SheetButton onClick={onClose} kind="ghost" label="Cancel" />
              </div>
            </>
          ) : (
            <div className="flex" style={{ gap: 10, paddingTop: 16 }}>
              <SheetButton
                onClick={() => runAddStop(phase.parse, "adjust")}
                kind="primary"
                label={`Add ${phase.parse.place}`}
              />
              <SheetButton onClick={onClose} kind="ghost" label="Cancel" />
            </div>
          )}
          <p style={{ ...LABEL, paddingTop: 12 }}>
            Re-planning regenerates the itinerary — a few minutes. Nothing
            changes until you apply the result.
          </p>
        </>
      )}

      {phase.name === "replanning" && (
        <Busy text={`${phase.label} — routing, generation, audit. A few minutes…`} />
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
            {phase.diff.stopsRenamed.length > 0 && (
              <div style={{ ...VALUE, color: "var(--text-muted)" }}>
                {phase.diff.stopsRenamed.map((r) => `${r.from} → ${r.to}`).join(" · ")}
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

/** "Picking up from Day N — place, date. Right?" with a one-phrase override.
 *  Partial re-plan's front door: it names where the frozen prefix ends so the
 *  user confirms (or corrects) before spending on the tail. */
function PickingUpRow({
  cleave,
  editing,
  nowText,
  onEdit,
  onChange,
  onDone,
}: {
  cleave: Extract<CleaveDisplay, { ok: true }>;
  editing: boolean;
  nowText: string;
  onEdit: () => void;
  onChange: (v: string) => void;
  onDone: () => void;
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 8,
        padding: "10px 14px",
        marginBottom: 14,
        borderRadius: 8,
        backgroundColor: "rgba(200,169,110,0.06)",
        border: "1px solid var(--border-mid)",
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <Navigation className="w-3.5 h-3.5" style={{ color: "var(--amber)" }} />
        <span style={{ ...LABEL, flex: 1 }}>Picking up from</span>
        {!editing && (
          <button
            type="button"
            onClick={onEdit}
            style={{ ...LABEL, color: "var(--amber)", textTransform: "none", letterSpacing: 0 }}
          >
            Change
          </button>
        )}
      </div>
      {editing ? (
        <div className="flex items-center" style={{ gap: 8 }}>
          <input
            autoFocus
            value={nowText}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onDone()}
            placeholder="I'm at Prince George — or “day 9”"
            className="flex-1"
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              backgroundColor: "var(--bg-base)",
              border: "1px solid var(--input-border-focus)",
              color: "var(--text-primary)",
              fontFamily: "var(--ff-sans)",
              fontSize: 13,
            }}
          />
          <button type="button" onClick={onDone} style={{ ...LABEL, color: "var(--amber)" }}>
            Set
          </button>
        </div>
      ) : cleave.isFullReplan ? (
        <span style={VALUE}>The start — re-planning the whole trip.</span>
      ) : (
        <span style={VALUE}>
          Day {cleave.resumeDayNumber} — {cleave.resumePlace}, {fmtDate(cleave.resumeDate)}{" "}
          <span style={{ color: "var(--text-muted)" }}>
            · {cleave.completedCount} day{cleave.completedCount === 1 ? "" : "s"} done stay frozen
          </span>
        </span>
      )}
    </div>
  );
}

/** A full-width mode choice for the add-stop tradeoff (title + rationale). */
function ModeButton({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left transition-colors hover:bg-white/[0.06]"
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid var(--amber-dark)",
        backgroundColor: "rgba(200,169,110,0.08)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--ff-sans)",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </div>
      <div style={{ ...LABEL, textTransform: "none", letterSpacing: 0, marginTop: 2 }}>
        {detail}
      </div>
    </button>
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
