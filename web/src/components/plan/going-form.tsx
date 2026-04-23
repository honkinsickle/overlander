"use client";

import { useActionState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { PlanningCard } from "@/components/plan/planning-card";
import { NavFooter } from "@/components/plan/planning-footer";
import { LocationInput } from "@/components/plan/location-input";
import { ChoiceCard } from "@/components/plan/choice-card";
import { DateRangeInput } from "@/components/plan/date-range-input";
import {
  saveGoingAction,
  type FormState,
} from "@/lib/plan/actions";
import { STEP_DISPLAY_NUMBER, STEP_TITLE } from "@/lib/plan/types";
import type { GoingData } from "@/lib/plan/types";

const INITIAL_STATE: FormState = { error: null };

export function GoingForm({
  draftId,
  defaults,
}: {
  draftId: string;
  defaults?: GoingData;
}) {
  const [state, formAction, isPending] = useActionState(
    saveGoingAction.bind(null, draftId),
    INITIAL_STATE,
  );

  return (
    <form action={formAction}>
      <PlanningCard
        displayStep={STEP_DISPLAY_NUMBER.going}
        title={STEP_TITLE.going}
        footer={<NavFooter disableContinue={isPending} />}
      >
        <section className="flex flex-col gap-2">
          <div className="section-label text-[13px]">Starting Point</div>
          <LocationInput
            name="startLocation"
            placeholder="Where are you starting from?"
            defaultValue={defaults?.startLocation?.label ?? ""}
            required
          />
          <label className="flex items-center gap-2 mt-1 text-sm text-text-primary cursor-pointer">
            <Checkbox
              name="saveStartAsHome"
              defaultChecked={defaults?.saveStartAsHome ?? false}
            />
            <span>Save as home address</span>
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <div className="section-label text-[13px]">Destination</div>
          <LocationInput
            name="destination"
            placeholder="Where are you headed?"
            defaultValue={defaults?.destination?.label ?? ""}
            required
          />
        </section>

        <ChoiceCard
          name="planWith"
          defaultValue={defaults?.planWith ?? "automagically"}
          options={[
            {
              value: "automagically",
              title: (
                <>
                  Plan with{" "}
                  <span className="italic text-amber">Automagically AI</span>
                </>
              ),
              description: "Find the best stops and plans faster.",
            },
            {
              value: "explore",
              title: "Explore and discover stops on your own",
            },
          ]}
        />

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="section-label text-[13px]">Add Dates</span>
            <span className="text-xs text-text-muted italic">Optional</span>
          </div>
          <DateRangeInput
            name="dates"
            defaultStart={defaults?.startDate}
            defaultEnd={defaults?.endDate}
          />
        </section>

        {state.error && (
          <p role="alert" className="text-sm text-input-error">
            {state.error}
          </p>
        )}
      </PlanningCard>
    </form>
  );
}
