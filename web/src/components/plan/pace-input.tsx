"use client";

import { useState } from "react";
import { PACE_BOUNDS, type Pace } from "@/lib/plan/types";

/** Pace input: segmented hours/miles toggle + a range slider. Emits two
 *  hidden form fields (`paceKind`, `paceValue`) that saveGoingAction
 *  parses. Slider re-renders on toggle to apply the new mode's bounds
 *  and default value. */
export function PaceInput({ defaults }: { defaults?: Pace }) {
  const [kind, setKind] = useState<Pace["kind"]>(defaults?.kind ?? "hours");
  const bounds = PACE_BOUNDS[kind];
  const initial =
    defaults && defaults.kind === kind ? defaults.value : bounds.default;
  const [value, setValue] = useState<number>(initial);

  const unitLabel = kind === "hours" ? "hrs" : "mi";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="section-label text-[13px]">
          How many {kind === "hours" ? "hours" : "miles"} a day do you want to
          drive?
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="inline-flex rounded overflow-hidden border border-border-subtle">
          <button
            type="button"
            onClick={() => {
              setKind("hours");
              setValue(PACE_BOUNDS.hours.default);
            }}
            aria-pressed={kind === "hours"}
            className={
              kind === "hours"
                ? "px-3 h-9 text-xs font-mono bg-text-primary text-bg-base"
                : "px-3 h-9 text-xs font-mono text-text-secondary hover:text-text-primary"
            }
          >
            HOURS
          </button>
          <button
            type="button"
            onClick={() => {
              setKind("miles");
              setValue(PACE_BOUNDS.miles.default);
            }}
            aria-pressed={kind === "miles"}
            className={
              kind === "miles"
                ? "px-3 h-9 text-xs font-mono bg-text-primary text-bg-base"
                : "px-3 h-9 text-xs font-mono text-text-secondary hover:text-text-primary"
            }
          >
            MILES
          </button>
        </div>

        <output className="font-mono text-sm text-text-primary tabular-nums">
          {value} {unitLabel}
        </output>
      </div>

      <input
        type="range"
        min={bounds.min}
        max={bounds.max}
        step={kind === "hours" ? 1 : 25}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        aria-label={`Daily ${kind} of driving`}
        className="w-full accent-amber cursor-pointer"
      />
      <div className="flex justify-between font-mono text-[10px] text-text-muted tabular-nums">
        <span>
          {bounds.min} {unitLabel}
        </span>
        <span>
          {bounds.max} {unitLabel}
        </span>
      </div>

      {/* Hidden form fields posted to saveGoingAction. */}
      <input type="hidden" name="paceKind" value={kind} />
      <input type="hidden" name="paceValue" value={value} />
    </section>
  );
}
