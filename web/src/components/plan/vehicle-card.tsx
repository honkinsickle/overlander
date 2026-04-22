import { ThumbsUp, Car } from "lucide-react";
import type { Vehicle } from "@/lib/vehicles/types";
import { vehicleTitle } from "@/lib/vehicles/types";

/**
 * Selectable vehicle row. The whole card is a `<label>` wrapping a
 * hidden checkbox named `vehicleIds`; the form can submit multiple.
 * Visual state driven by `has-[input:checked]:` (no JS).
 */
export function VehicleCard({
  vehicle,
  defaultChecked,
}: {
  vehicle: Vehicle;
  defaultChecked?: boolean;
}) {
  return (
    <label className="group flex items-center gap-3 p-3 rounded-lg border border-input-border bg-input-surface cursor-pointer hover:border-input-border-hover has-[input:checked]:border-input-border-focus has-[input:checked]:bg-input-surface-filled transition-colors">
      <input
        type="checkbox"
        name="vehicleIds"
        value={vehicle.id}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <div className="w-10 h-10 rounded flex items-center justify-center bg-bg-nav-btn border border-border-subtle shrink-0">
        <Car aria-hidden className="w-5 h-5 text-input-border-focus" />
      </div>
      <div className="flex-1 flex flex-col gap-0.5">
        <span className="font-sans font-bold text-text-primary">
          {vehicleTitle(vehicle)}
        </span>
        <span className="font-mono text-[11px] tracking-wide text-text-muted">
          {vehicle.capabilities.join(" · ")}
        </span>
      </div>
      <ThumbsUp
        aria-hidden
        className="w-4 h-4 shrink-0 text-text-muted peer-checked:text-amber peer-checked:fill-amber/25 transition-colors"
      />
    </label>
  );
}
