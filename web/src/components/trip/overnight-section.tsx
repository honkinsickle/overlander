"use client";

import { useTransition } from "react";
import { Check, ChevronRight } from "lucide-react";
import { BottomSheet } from "@/components/primitives/bottom-sheet";
import { pickOvernightAction } from "@/lib/trips/actions";
import type { Day, Overnight } from "@/lib/trips/types";

/**
 * Overnight section — shows the currently picked overnight as a trigger,
 * opens a BottomSheet listing picked + alternatives. Clicking a row
 * promotes it via `pickOvernightAction`; `revalidatePath` then refreshes
 * the center column.
 */
export function OvernightSection({
  tripId,
  day,
}: {
  tripId: string;
  day: Day;
}) {
  if (!day.overnight) return null;
  const { selected, alternatives } = day.overnight;
  const total = 1 + alternatives.length;

  return (
    <BottomSheet
      title="Overnight options"
      subtitle={`${day.label.toUpperCase()} · ${total} MATCHES`}
      trigger={
        <button
          type="button"
          className="flex items-center justify-between px-4 py-3 bg-bg-card border border-border-subtle rounded text-left hover:border-border-mid"
        >
          <span className="flex flex-col gap-0.5">
            <span className="section-label text-xs text-text-muted">
              Overnight
            </span>
            <span className="font-sans font-bold text-text-primary">
              {selected.name}
            </span>
          </span>
          <span className="flex items-center gap-2 text-text-muted">
            <span className="text-xs font-mono">More options</span>
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
      }
    >
      <ul className="flex flex-col">
        {[selected, ...alternatives].map((o, i) => (
          <OvernightRow
            key={o.id}
            tripId={tripId}
            dayId={day.id}
            overnight={o}
            picked={i === 0}
          />
        ))}
      </ul>
    </BottomSheet>
  );
}

function OvernightRow({
  tripId,
  dayId,
  overnight,
  picked,
}: {
  tripId: string;
  dayId: string;
  overnight: Overnight;
  picked: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const handlePick = () => {
    if (picked || isPending) return;
    startTransition(async () => {
      await pickOvernightAction(tripId, dayId, overnight.id);
    });
  };

  return (
    <li className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={handlePick}
        disabled={picked || isPending}
        className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-bg-card disabled:cursor-default disabled:hover:bg-transparent"
      >
        <div className="flex-1 flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-sans font-bold text-text-primary">
              {overnight.name}
            </span>
            {picked && (
              <span className="px-1.5 py-0.5 rounded-sm bg-cat-camping text-[9px] font-mono tracking-[0.06em] text-[#051814]">
                PICKED
              </span>
            )}
          </div>
          <span className="text-xs text-text-muted">
            {overnight.type} · {overnight.detourMiles} mi detour ·{" "}
            {overnight.cost}
            {overnight.notes ? ` · ${overnight.notes}` : ""}
          </span>
        </div>
        <div
          className="w-7 h-7 flex items-center justify-center rounded bg-bg-nav-btn border border-border-subtle shrink-0"
          aria-hidden
        >
          {picked ? (
            <Check className="w-3.5 h-3.5 text-input-border-focus" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-input-border-focus" />
          )}
        </div>
      </button>
    </li>
  );
}
