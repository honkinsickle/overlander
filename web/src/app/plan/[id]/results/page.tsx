import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, ChevronRight, Plus, Layers } from "lucide-react";
import { getDraft } from "@/lib/plan/repository";
import {
  toggleSuggestionAction,
  finalizeTripAction,
} from "@/lib/plan/actions";
import { RESULTS_SUGGESTIONS, type PlanSuggestion } from "@/lib/plan/suggestions";
import { categoryStyle } from "@/components/primitives/detail-card";
import { backHref } from "@/lib/plan/nav";

/**
 * /plan/[id]/results — split layout (not a centered card).
 *
 * Left column (440w): header + seeded suggestions + AUTOPILOT label + Back/Next
 * Right column: map placeholder. Shares the PlanningLayout's vnav + topbar
 * via WizardBackdrop's "results" branch.
 */
export default async function ResultsStep(
  props: PageProps<"/plan/[id]/results">,
) {
  const { id } = await props.params;
  const draft = await getDraft(id);
  if (!draft) notFound();

  const accepted = new Set(draft.acceptedSuggestionIds ?? []);

  return (
    <div className="absolute inset-0 flex">
      <section
        className="w-[440px] h-full bg-bg-panel border-r border-border-subtle flex flex-col"
        aria-label="Suggestions"
      >
        <header className="flex flex-col gap-1.5 px-6 pt-6 pb-4 border-b border-border-subtle">
          <h1 className="font-sans font-bold text-3xl text-amber leading-tight">
            We&rsquo;ve found your must-see stops
          </h1>
          <p className="text-sm text-text-muted">
            Add these locations to your itinerary, launch your trip to see
            what else you can find.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-4 pb-2 text-center">
            <span className="section-label text-[11px] text-text-muted">
              ADD STOPS
            </span>
          </div>
          <ul className="flex flex-col">
            {RESULTS_SUGGESTIONS.map((s) => (
              <SuggestionRow
                key={s.id}
                draftId={id}
                suggestion={s}
                accepted={accepted.has(s.id)}
              />
            ))}
          </ul>
        </div>

        <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border-subtle">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-text-muted" />
            <span className="section-label text-[11px] text-text-muted">
              AUTOPILOT
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={backHref(id, "results") ?? `/plan/${id}/stops`}
              className="inline-flex items-center h-10 px-5 rounded-full border border-border-mid text-text-primary hover:bg-bg-card font-sans font-semibold text-sm tracking-wide"
            >
              BACK
            </Link>
            <form action={finalizeTripAction.bind(null, id)}>
              <button
                type="submit"
                className="inline-flex items-center h-10 px-5 rounded-full bg-button-primary hover:bg-button-primary-hover border border-button-primary-border text-text-primary font-sans font-semibold text-sm tracking-wide"
              >
                NEXT
              </button>
            </form>
          </div>
        </footer>
      </section>

      <section className="flex-1 h-full bg-bg-map relative" aria-label="Map">
        <div className="absolute inset-0 flex items-center justify-center text-text-muted section-label text-sm">
          Map column
        </div>
      </section>
    </div>
  );
}

function SuggestionRow({
  draftId,
  suggestion,
  accepted,
}: {
  draftId: string;
  suggestion: PlanSuggestion;
  accepted: boolean;
}) {
  const { accent, bg } = categoryStyle[suggestion.category];
  return (
    <li className="flex gap-3 px-6 py-4 border-b border-border-subtle">
      <div
        className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center"
        style={{ backgroundColor: bg }}
      >
        <span
          aria-hidden
          className="font-sans font-bold text-base"
          style={{ color: accent }}
        >
          {suggestion.title.charAt(0)}
        </span>
      </div>
      <div className="flex-1 flex flex-col gap-2 min-w-0">
        <div className="flex flex-col gap-0.5">
          <h3
            className="font-sans font-bold text-base leading-tight"
            style={{ color: accent }}
          >
            {suggestion.title}
          </h3>
          <p className="text-sm text-text-muted leading-snug">
            {suggestion.description}
          </p>
        </div>
        {suggestion.tip && (
          <p className="font-mono text-xs leading-snug text-amber">
            <span aria-hidden>↳ </span>
            {suggestion.tip}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <form action={toggleSuggestionAction.bind(null, draftId, suggestion.id)}>
            <button
              type="submit"
              aria-pressed={accepted}
              className={
                accepted
                  ? "inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full bg-transparent border border-button-primary-border text-input-border-focus font-sans font-semibold text-xs tracking-[0.04em] uppercase"
                  : "inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3 rounded-full bg-button-primary hover:bg-button-primary-hover border border-button-primary-border text-text-primary font-sans font-semibold text-xs tracking-[0.04em] uppercase"
              }
            >
              {accepted ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>{accepted ? "Added" : "Add to trip"}</span>
            </button>
          </form>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm font-sans font-semibold text-text-primary"
            aria-label={`${suggestion.title} details`}
          >
            Details
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}
