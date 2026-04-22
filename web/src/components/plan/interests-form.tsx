"use client";

import { useActionState, useMemo, useState } from "react";
import { PlanningCard } from "@/components/plan/planning-card";
import { CategoryCard } from "@/components/plan/category-card";
import { SelectableChip } from "@/components/plan/selectable-chip";
import { categoryStyle } from "@/components/primitives/detail-card";
import {
  saveInterestsAction,
  type FormState,
} from "@/lib/plan/actions";
import { STEP_DISPLAY_NUMBER, STEP_TITLE } from "@/lib/plan/types";
import type { InterestsData } from "@/lib/plan/types";
import { INTEREST_CATEGORIES } from "@/lib/plan/interests";

const INITIAL_STATE: FormState = { error: null };

export function InterestsForm({
  draftId,
  defaults,
}: {
  draftId: string;
  defaults?: InterestsData;
}) {
  const [state, formAction, isPending] = useActionState(
    saveInterestsAction.bind(null, draftId),
    INITIAL_STATE,
  );

  // Selection state owned here so the counters stay in sync with native
  // checkbox changes. Inputs remain uncontrolled (defaultChecked) — we
  // just observe change events to update the displayed counts.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaults?.selectedChipIds ?? []),
  );

  const handleFormChange: React.FormEventHandler<HTMLFormElement> = (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name !== "chipIds" || t.type !== "checkbox") return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (t.checked) n.add(t.value);
      else n.delete(t.value);
      return n;
    });
  };

  const totalSelected = selected.size;
  const pickedCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of INTEREST_CATEGORIES) {
      let n = 0;
      for (const chip of cat.chips) if (selected.has(chip.id)) n++;
      map.set(cat.id, n);
    }
    return map;
  }, [selected]);

  return (
    <form action={formAction} onChange={handleFormChange}>
      <PlanningCard
        displayStep={STEP_DISPLAY_NUMBER.interests}
        title={STEP_TITLE.interests}
        width="wide"
        footer={
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-6 h-6 flex items-center justify-center rounded-full bg-amber text-[#2A1F10] font-sans font-bold text-xs"
                aria-hidden
              >
                {totalSelected}
              </span>
              <span className="font-sans text-sm text-text-primary">
                {totalSelected === 1
                  ? "interest selected"
                  : "interests selected"}
              </span>
              <span className="section-label text-[11px] text-text-muted">
                · ADD AS MANY AS YOU WANT
              </span>
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="font-sans font-semibold text-sm text-input-border-focus hover:underline disabled:opacity-50"
            >
              {totalSelected > 0 ? "Continue" : "Skip"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-text-muted leading-snug">
          Pick what excites you. Autopilot weights recommendations toward
          these categories. You can skip this &mdash; we&rsquo;ll use balanced
          defaults.
        </p>

        <div className="flex flex-col gap-3">
          {INTEREST_CATEGORIES.map((cat) => {
            const accent = categoryStyle[cat.category].accent;
            return (
              <CategoryCard
                key={cat.id}
                category={cat.category}
                icon={cat.icon}
                title={cat.title}
                subtitle={cat.subtitle}
                pickedCount={pickedCountByCategory.get(cat.id) ?? 0}
              >
                {cat.chips.map((chip) => (
                  <SelectableChip
                    key={chip.id}
                    id={chip.id}
                    label={chip.label}
                    accent={accent}
                    defaultChecked={selected.has(chip.id)}
                  />
                ))}
              </CategoryCard>
            );
          })}
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-input-error">
            {state.error}
          </p>
        )}
      </PlanningCard>
    </form>
  );
}
