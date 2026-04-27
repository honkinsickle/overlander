"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { finalizeTripAction } from "@/lib/plan/actions";

/**
 * Loader step body. Simulates the planner running through 3 sub-steps
 * and then finalizes the draft into a trip. Purely client-side timing —
 * when real work lands, replace the timers with a resolving Promise.
 */

const STEP_DURATION_MS = 3000;

type SubStep = {
  title: string;
  description: string;
};

const SUB_STEPS: SubStep[] = [
  {
    title: "Analyzing your route",
    description: "Discovering hidden gems and roadside classics",
  },
  {
    title: "Cross-referencing 38M+ trips",
    description: "Finding the best stops for you",
  },
  {
    title: "Matching results to your preferences",
    description: "Filtering out anything that isn't your kind of thing",
  },
];

export function LoaderPanel({ draftId }: { draftId: string }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= SUB_STEPS.length) {
          clearInterval(id);
          void finalizeTripAction(draftId);
          return prev;
        }
        return next;
      });
    }, STEP_DURATION_MS);
    return () => clearInterval(id);
  }, [draftId]);

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <AutopilotMark />
      <Spinner />

      <ul className="flex flex-col gap-4 w-full mt-3">
        {SUB_STEPS.map((s, i) => {
          const state: "done" | "active" | "pending" =
            i < currentStep
              ? "done"
              : i === currentStep
                ? "active"
                : "pending";
          return <SubStepRow key={s.title} step={s} state={state} />;
        })}
      </ul>

      <p className="section-label text-[11px] text-text-muted mt-2 text-center">
        ~10 SECONDS &middot; DO NOT CLOSE THIS WINDOW
      </p>
    </div>
  );
}

function AutopilotMark() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="w-2.5 h-2.5 rounded-full bg-amber"
      />
      <span className="font-sans italic text-lg text-amber">
        autopilot
        <span className="text-xs align-super">™</span>
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="relative w-24 h-24 flex items-center justify-center"
    >
      {/* Soft outer glow */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          boxShadow: "0 0 40px 4px rgba(167,204,253,0.20)",
        }}
      />
      {/* Animated ring: transparent except for a partial arc */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full animate-spin"
        style={{
          borderWidth: "2px",
          borderStyle: "solid",
          borderColor: "var(--input-border-focus)",
          borderTopColor: "transparent",
          borderLeftColor: "transparent",
        }}
      />
      {/* Center dot */}
      <div
        aria-hidden
        className="w-3 h-3 rounded-full"
        style={{
          backgroundColor: "var(--amber)",
          boxShadow: "0 0 16px 2px rgba(200,169,110,0.6)",
        }}
      />
    </div>
  );
}

function SubStepRow({
  step,
  state,
}: {
  step: SubStep;
  state: "done" | "active" | "pending";
}) {
  return (
    <li className="flex items-start gap-3">
      <StateIndicator state={state} />
      <div className="flex flex-col gap-0.5 flex-1">
        <span
          className={
            state === "pending"
              ? "font-sans font-semibold text-text-muted"
              : "font-sans font-semibold text-text-primary"
          }
        >
          {step.title}
        </span>
        <span
          className={
            state === "pending"
              ? "text-xs text-text-muted opacity-60"
              : "text-xs text-text-muted"
          }
        >
          {step.description}
        </span>
      </div>
    </li>
  );
}

function StateIndicator({
  state,
}: {
  state: "done" | "active" | "pending";
}) {
  if (state === "done") {
    return (
      <div
        aria-hidden
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-input-border-focus text-[#051422]"
      >
        <Check className="w-3.5 h-3.5" strokeWidth={3} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <div
        aria-hidden
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 border-2 border-input-border-focus"
      >
        <div className="w-2 h-2 rounded-full bg-input-border-focus" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="w-6 h-6 rounded-full shrink-0 mt-0.5 border border-border-mid"
    />
  );
}
