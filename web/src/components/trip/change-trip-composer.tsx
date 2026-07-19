"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  interpretEditAction,
  executeEditAction,
  addStopAction,
  applyReplanAction,
  discardReplanAction,
  type InterpretActionResult,
  type EditPayload,
} from "@/lib/itinerary/edit-actions";
import type { InterpretResult } from "@/lib/itinerary/interpret";
import type { ClarifyContext } from "@/lib/itinerary/interpret";
import type { NowSpec } from "@/lib/itinerary/partial-replan";
import type { ReplanDiff } from "@/lib/itinerary/plan-diff";
import type { AddStopMode } from "@/lib/itinerary/edit";

/**
 * Living-plan dedicated CHANGE-TRIP box (dev-gated) — a command line with a
 * clear submit boundary, so everything typed is an edit intent (no shared-box
 * routing heuristic). Type anything → interpretEdit reads the intent → either
 * a proposed edit (with the fuzzy reading echoed to confirm), ONE clarifying
 * question (capped), or unsupported.
 *
 * Stage 1 (this): the free path — interpret + clarify + confirm DISPLAY. The
 * paid dispatch (Re-plan → executor → diff → apply) is Stage 2; the button is
 * present but wiring lands then.
 */

const MAX_CLARIFY = 2;

type Phase =
  | { name: "composing" }
  | { name: "interpreting" }
  | { name: "result"; result: InterpretResult }
  | { name: "replanning"; label: string }
  | { name: "diff"; diff: ReplanDiff; editSignature: string }
  | { name: "applying" }
  | { name: "error"; message: string };

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

const EXAMPLES = [
  "move Smithers to the 20th",
  "skip the boring middle",
  "spend more time in the mountains",
  "get to Vancouver a day earlier",
];

export function ChangeTripComposer({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ name: "composing" });
  // The original request + Q/A turns, replayed to the interpreter on a
  // clarify follow-up so it has the full thread.
  const [clarify, setClarify] = useState<ClarifyContext | null>(null);
  const [answer, setAnswer] = useState("");

  const interpret = async (t: string, ctx?: ClarifyContext) => {
    setPhase({ name: "interpreting" });
    const r: InterpretActionResult = await interpretEditAction(tripId, ctx?.originalText ?? t, ctx);
    if (!r.ok) setPhase({ name: "error", message: r.error });
    else setPhase({ name: "result", result: r.result });
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setClarify({ originalText: t, turns: [] });
    interpret(t);
  };

  const answerClarify = (question: string) => {
    const a = answer.trim();
    if (!a || !clarify) return;
    const nextCtx: ClarifyContext = {
      originalText: clarify.originalText,
      turns: [...clarify.turns, { question, answer: a }],
    };
    setClarify(nextCtx);
    setAnswer("");
    interpret(clarify.originalText, nextCtx);
  };

  const router = useRouter();

  /** The confirmed interpretation → dispatch to the executor → the SAME
   *  runGateStage/diff flow (reused wholesale). `now` comes from the utterance
   *  ("I'm at Stewart") when present → partial re-plan. */
  const dispatch = async (r: Extract<InterpretResult, { kind: "edit" }>) => {
    const now: NowSpec | undefined = r.nowPlace ? { atPlace: r.nowPlace } : undefined;
    if (r.type === "add-stop") {
      // add-stop keeps its own two-mode flow.
      await runAddStop(r, "adjust", now);
      return;
    }
    setPhase({ name: "replanning", label: `${r.type}: ${r.place ?? ""}` });
    const payload: EditPayload = {
      type: r.type,
      place: r.place,
      date: r.date,
      dwell: r.dwell,
      nights: r.nights,
    };
    const res = await executeEditAction(tripId, payload, now);
    if (!res.ok) setPhase({ name: "error", message: res.error });
    else setPhase({ name: "diff", diff: res.diff, editSignature: res.editSignature });
  };

  const runAddStop = async (
    r: Extract<InterpretResult, { kind: "edit" }>,
    mode: AddStopMode,
    now?: NowSpec,
  ) => {
    setPhase({ name: "replanning", label: `add ${r.place ?? ""}` });
    const res = await addStopAction(tripId, r.place ?? "", mode, now);
    if (!res.ok) setPhase({ name: "error", message: res.error });
    else setPhase({ name: "diff", diff: res.diff, editSignature: res.editSignature });
  };

  const apply = async (editSignature: string) => {
    setPhase({ name: "applying" });
    const res = await applyReplanAction(tripId, editSignature);
    if (!res.ok) {
      setPhase({ name: "error", message: res.error });
      return;
    }
    router.refresh();
    onClose();
  };

  const keepOriginal = async () => {
    await discardReplanAction(tripId);
    onClose();
  };

  const clarifyCount = clarify?.turns.length ?? 0;

  return (
    <div
      role="dialog"
      aria-label="Change trip"
      className="flex flex-col"
      style={{
        width: 520,
        maxWidth: "92vw",
        padding: 20,
        borderRadius: 14,
        backgroundColor: "var(--bg-panel)",
        border: "1px solid var(--border-mid)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}
    >
      <div className="flex items-center" style={{ gap: 10, paddingBottom: 14 }}>
        <Sparkles className="w-4 h-4" style={{ color: "var(--amber)" }} />
        <span style={{ ...LABEL, flex: 1, color: "var(--amber)" }}>Change this trip</span>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
        </button>
      </div>

      {/* Composer — always visible; the submit boundary is Enter/Send. */}
      <div className="flex items-center" style={{ gap: 8 }}>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Tell me what to change…"
          className="flex-1"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "var(--bg-base)",
            border: "1px solid var(--input-border-focus)",
            color: "var(--text-primary)",
            fontFamily: "var(--ff-sans)",
            fontSize: 14,
          }}
        />
        <button
          type="button"
          onClick={submit}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            backgroundColor: "var(--button-primary)",
            color: "var(--text-primary)",
            fontFamily: "var(--ff-sans)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>

      {phase.name === "composing" && (
        <div className="flex flex-wrap" style={{ gap: 6, paddingTop: 12 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              style={{
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid var(--border-mid)",
                color: "var(--text-muted)",
                fontFamily: "var(--ff-sans)",
                fontSize: 12,
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {phase.name === "interpreting" && (
        <div className="flex items-center" style={{ gap: 10, paddingTop: 16 }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--amber)" }} />
          <span style={{ ...VALUE, color: "var(--text-muted)" }}>Reading your request…</span>
        </div>
      )}

      {phase.name === "error" && (
        <p style={{ ...VALUE, color: "#E08A7A", paddingTop: 16 }}>{phase.message}</p>
      )}

      {phase.name === "result" && phase.result.kind === "clarify" && (
        <div className="flex flex-col" style={{ gap: 10, paddingTop: 16 }}>
          <div style={VALUE}>{phase.result.question}</div>
          {phase.result.partial && (
            <div style={{ ...LABEL, textTransform: "none", letterSpacing: 0 }}>
              {phase.result.partial}
            </div>
          )}
          {clarifyCount < MAX_CLARIFY ? (
            <div className="flex items-center" style={{ gap: 8 }}>
              <input
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && answerClarify(phase.result.kind === "clarify" ? phase.result.question : "")}
                placeholder="Answer…"
                className="flex-1"
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  backgroundColor: "var(--bg-base)",
                  border: "1px solid var(--input-border-focus)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--ff-sans)",
                  fontSize: 14,
                }}
              />
              <button
                type="button"
                onClick={() => answerClarify(phase.result.kind === "clarify" ? phase.result.question : "")}
                style={{ ...LABEL, color: "var(--amber)" }}
              >
                Send
              </button>
            </div>
          ) : (
            <p style={{ ...LABEL, textTransform: "none", letterSpacing: 0 }}>
              Still unclear — try rephrasing the whole change in one line.
            </p>
          )}
        </div>
      )}

      {phase.name === "result" && phase.result.kind === "unsupported" && (
        <p style={{ ...VALUE, color: "var(--text-muted)", paddingTop: 16 }}>
          {phase.result.reason}
        </p>
      )}

      {phase.name === "result" && phase.result.kind === "edit" && (
        <EditConfirmCard result={phase.result} onReplan={() => dispatch(phase.result as Extract<InterpretResult, { kind: "edit" }>)} />
      )}

      {phase.name === "replanning" && (
        <div className="flex items-center" style={{ gap: 10, paddingTop: 16 }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--amber)" }} />
          <span style={{ ...VALUE, color: "var(--text-muted)" }}>
            {phase.label} — routing, generation, audit. A few minutes…
          </span>
        </div>
      )}

      {phase.name === "diff" && (
        <DiffCard
          diff={phase.diff}
          onApply={() => apply(phase.editSignature)}
          onKeep={keepOriginal}
        />
      )}

      {phase.name === "applying" && (
        <div className="flex items-center" style={{ gap: 10, paddingTop: 16 }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--amber)" }} />
          <span style={{ ...VALUE, color: "var(--text-muted)" }}>Applying…</span>
        </div>
      )}
    </div>
  );
}

/** Reuses the ReplanDiff shape produced by runGateStage (same back-end the
 *  arrive-by/add-stop/partial flows use). Apply → applyReplanAction (signature
 *  guard) → slideup re-renders. */
function DiffCard({
  diff,
  onApply,
  onKeep,
}: {
  diff: ReplanDiff;
  onApply: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 8,
        marginTop: 16,
        padding: 16,
        borderRadius: 10,
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-mid)",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      <div style={VALUE}>
        {diff.endpointsHeld.start && diff.endpointsHeld.end
          ? "✓ Start and end dates held"
          : "⚠ Trip endpoints moved"}
      </div>
      {diff.stopsAdded.length > 0 && (
        <div style={{ ...VALUE, color: "#9CD4B0" }}>+ {diff.stopsAdded.join(" · ")}</div>
      )}
      {diff.stopsRemoved.length > 0 && (
        <div style={{ ...VALUE, color: "var(--text-muted)" }}>− {diff.stopsRemoved.join(" · ")}</div>
      )}
      {diff.stopsRenamed.length > 0 && (
        <div style={{ ...VALUE, color: "var(--text-muted)" }}>
          {diff.stopsRenamed.map((r) => `${r.from} → ${r.to}`).join(" · ")}
        </div>
      )}
      <div style={{ ...VALUE, color: "var(--text-muted)" }}>
        Rest days: {diff.layovers.before} → {diff.layovers.after}
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
        {diff.days.map((d) => (
          <div
            key={d.date}
            className="flex"
            style={{ gap: 10, fontFamily: "var(--ff-mono)", fontSize: 12, color: "var(--text-muted)" }}
          >
            <span style={{ width: 84, flexShrink: 0 }}>{fmtDate(d.date)}</span>
            <span style={{ width: 52, flexShrink: 0, textAlign: "right" }}>{d.miles} mi</span>
            <span className="truncate" style={{ color: "var(--text-primary)" }}>{d.label}</span>
          </div>
        ))}
      </div>
      <div className="flex" style={{ gap: 10, paddingTop: 10 }}>
        <button
          type="button"
          onClick={onApply}
          style={{
            padding: "9px 16px",
            borderRadius: 8,
            backgroundColor: "var(--button-primary)",
            color: "var(--text-primary)",
            fontFamily: "var(--ff-sans)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onKeep}
          style={{
            padding: "9px 16px",
            borderRadius: 8,
            border: "1px solid var(--border-mid)",
            color: "var(--text-muted)",
            fontFamily: "var(--ff-sans)",
            fontSize: 14,
          }}
        >
          Keep original
        </button>
      </div>
    </div>
  );
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Shows the interpreted edit + (crucially) the fuzzy-reading echo so the user
 *  confirms the concrete interpretation before any spend. Stage 1: display
 *  only; the [Re-plan] dispatch to executors lands in Stage 2. */
function EditConfirmCard({
  result,
  onReplan,
}: {
  result: Extract<InterpretResult, { kind: "edit" }>;
  onReplan: () => void;
}) {
  const bits: string[] = [];
  if (result.place) bits.push(result.place);
  if (result.date) bits.push(fmtDate(result.date));
  if (result.dwell != null && result.dwell > 0) bits.push(`${result.dwell}-night`);
  if (result.nights != null) bits.push(`+${result.nights} night${result.nights === 1 ? "" : "s"}`);
  if (result.betweenStart || result.betweenEnd)
    bits.push(`between ${result.betweenStart ?? "?"} and ${result.betweenEnd ?? "?"}`);
  if (result.fromHere) bits.push("from here");
  if (result.nowPlace) bits.push(`from ${result.nowPlace}`);

  return (
    <div
      className="flex flex-col"
      style={{
        gap: 8,
        marginTop: 16,
        padding: 16,
        borderRadius: 10,
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-mid)",
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          style={{
            ...LABEL,
            color: "var(--amber)",
            padding: "2px 8px",
            borderRadius: 999,
            border: "1px solid var(--amber-dark)",
          }}
        >
          {result.type}
        </span>
        <span style={VALUE}>{bits.join(" · ")}</span>
      </div>
      {result.interpretation && (
        <div style={{ ...VALUE, color: "var(--text-muted)", fontStyle: "italic" }}>
          Reading this as: {result.interpretation}
        </div>
      )}
      <div className="flex" style={{ gap: 10, paddingTop: 8 }}>
        <button
          type="button"
          onClick={onReplan}
          style={{
            padding: "9px 16px",
            borderRadius: 8,
            backgroundColor: "var(--button-primary)",
            color: "var(--text-primary)",
            fontFamily: "var(--ff-sans)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Re-plan trip
        </button>
        <span style={{ ...LABEL, textTransform: "none", letterSpacing: 0, alignSelf: "center" }}>
          confirm this reading
        </span>
      </div>
    </div>
  );
}
