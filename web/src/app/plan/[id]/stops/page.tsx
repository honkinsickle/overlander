import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { PlanningCard } from "@/components/plan/planning-card";
import { NavFooter } from "@/components/plan/planning-footer";
import { getDraft } from "@/lib/plan/repository";
import {
  addStopAction,
  removeStopAction,
  saveStopsAction,
} from "@/lib/plan/actions";
import {
  STEP_DISPLAY_NUMBER,
  STEP_TITLE,
  type PlannedStop,
} from "@/lib/plan/types";
import { backHref, nextHref } from "@/lib/plan/nav";

/**
 * /plan/[id]/stops — "Any places you already plan to visit?"
 *
 * One outer `<form>` defaults to saveStopsAction (the Continue button).
 * Button-level `formAction` overrides drive the side actions:
 *   - The "+" button → addStopAction (also the default submit for Enter)
 *   - Each row's "×" button → removeStopAction
 *
 * That avoids nested forms (HTML-illegal) while keeping mutations as
 * individual server actions. Geocoding is deferred — stops are freeform
 * labels for now.
 */
export default async function StopsStep(
  props: PageProps<"/plan/[id]/stops">,
) {
  const { id } = await props.params;
  const draft = await getDraft(id);
  if (!draft) notFound();

  const stops = draft.stops?.stops ?? [];
  const avoidHighways = draft.stops?.avoidHighways ?? false;
  const skipHref = nextHref(id, "stops") ?? `/plan/${id}/loader`;

  return (
    <form action={saveStopsAction.bind(null, id)}>
      <PlanningCard
        displayStep={STEP_DISPLAY_NUMBER.stops}
        title="Any places you already plan to visit?"
        footer={
          <NavFooter
            backHref={backHref(id, "stops") ?? undefined}
          />
        }
      >
        <p className="text-sm text-text-muted leading-snug">
          Drop in any must-stop waypoints. If you&rsquo;re not sure, skip
          &mdash; you can add stops later.
        </p>

        <div className="form-field flex items-center gap-2 pl-3 pr-0">
          {/* First submit button in the form, so Enter in `label` fires it. */}
          <button
            type="submit"
            formAction={addStopAction.bind(null, id)}
            aria-label="Add stop"
            className="shrink-0 text-text-muted hover:text-text-primary"
          >
            <Plus className="w-4 h-4" />
          </button>
          <input
            name="label"
            type="text"
            placeholder="Add stops"
            maxLength={100}
            className="flex-1 bg-transparent outline-none text-input-value placeholder:text-input-placeholder"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <Checkbox name="avoidHighways" defaultChecked={avoidHighways} />
          <span>Avoid highways</span>
        </label>

        {stops.length > 0 && (
          <ol className="flex flex-col gap-2 mt-1">
            {stops.map((stop, i) => (
              <StopRow
                key={stop.id}
                draftId={id}
                stop={stop}
                index={i + 1}
              />
            ))}
          </ol>
        )}

        <p className="text-center text-xs text-text-muted">
          &mdash; or &mdash;{" "}
          <Link
            href={skipHref}
            className="text-input-border-focus hover:underline"
          >
            Skip this step
          </Link>
        </p>
      </PlanningCard>
    </form>
  );
}

function StopRow({
  draftId,
  stop,
  index,
}: {
  draftId: string;
  stop: PlannedStop;
  index: number;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className="w-6 h-6 rounded-full border border-border-mid flex items-center justify-center text-[11px] font-sans text-text-muted shrink-0"
        aria-hidden
      >
        {index}
      </span>
      <div className="w-10 h-10 rounded flex items-center justify-center bg-bg-nav-btn border border-border-subtle shrink-0">
        <MapPin className="w-4 h-4 text-input-border-focus" />
      </div>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className="font-sans font-bold text-text-primary truncate">
          {stop.label}
        </span>
        {stop.meta && (
          <span className="font-mono text-[11px] tracking-wide text-text-muted truncate">
            {stop.meta}
          </span>
        )}
      </div>
      <button
        type="submit"
        formAction={removeStopAction.bind(null, draftId, stop.id)}
        aria-label={`Remove ${stop.label}`}
        className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-text-primary hover:bg-bg-card shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}
