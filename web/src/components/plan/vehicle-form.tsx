"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { PlanningCard } from "@/components/plan/planning-card";
import { NavFooter } from "@/components/plan/planning-footer";
import { VehicleCard } from "@/components/plan/vehicle-card";
import { TipCard } from "@/components/plan/tip-card";
import {
  saveVehicleAction,
  type FormState,
} from "@/lib/plan/actions";
import {
  STEP_DISPLAY_NUMBER,
  STEP_TITLE,
  type VehicleData,
} from "@/lib/plan/types";
import type { Vehicle } from "@/lib/vehicles/types";

const INITIAL_STATE: FormState = { error: null };

export function VehicleForm({
  draftId,
  defaults,
  vehicles,
}: {
  draftId: string;
  defaults?: VehicleData;
  vehicles: Vehicle[];
}) {
  const [state, formAction, isPending] = useActionState(
    saveVehicleAction.bind(null, draftId),
    INITIAL_STATE,
  );

  const defaultSelected = new Set(defaults?.vehicleIds ?? []);

  return (
    <form action={formAction}>
      <PlanningCard
        displayStep={STEP_DISPLAY_NUMBER.vehicle}
        title={STEP_TITLE.vehicle}
        footer={
          <NavFooter
            backHref={`/plan/${draftId}/going`}
            disableContinue={isPending}
          />
        }
      >
        <p className="text-sm text-text-muted leading-snug">
          Knowing your vehicle helps Autopilot give smarter suggestions to
          shape the perfect road trip for you.
        </p>

        <section className="flex flex-col gap-3">
          <div className="section-label text-[13px]">Your Vehicles</div>

          <input
            type="number"
            name="milesPerDay"
            min={1}
            max={2000}
            defaultValue={defaults?.milesPerDay ?? ""}
            placeholder="How many miles a day?"
            className="form-field w-full"
          />

          <div className="flex flex-col gap-2">
            {vehicles.map((v) => (
              <VehicleCard
                key={v.id}
                vehicle={v}
                defaultChecked={defaultSelected.has(v.id)}
              />
            ))}
          </div>

          <AddVehicleStub />
        </section>

        <TipCard>
          Automagically tailors elevation, fuel range, and off-road
          suggestions to your vehicle&rsquo;s capabilities.
        </TipCard>

        {state.error && (
          <p role="alert" className="text-sm text-input-error">
            {state.error}
          </p>
        )}
      </PlanningCard>
    </form>
  );
}

/** Placeholder — the real add-vehicle flow is its own surface. */
function AddVehicleStub() {
  return (
    <button
      type="button"
      className="flex items-center justify-center gap-2 h-11 rounded-lg border border-dashed border-border-mid text-text-primary hover:bg-bg-card"
      onClick={() =>
        // eslint-disable-next-line no-alert
        alert("Add-vehicle flow ships in a later phase.")
      }
    >
      <Plus className="w-4 h-4" />
      <span className="font-sans text-sm">Add another vehicle</span>
    </button>
  );
}
