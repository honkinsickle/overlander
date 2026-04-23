"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import { DayPicker, type DateRange } from "react-day-picker";
import { format, parseISO } from "date-fns";
import "react-day-picker/style.css";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Date-range picker that renders two fields (Start / End) and a shared
 * two-month calendar in a popover. Both fields trigger the same popover
 * so the user can edit either endpoint in one pass.
 *
 * Hidden inputs submit ISO YYYY-MM-DD strings alongside the form.
 */
export function DateRangeInput({
  name,
  defaultStart,
  defaultEnd,
}: {
  /** Field stem — emits `<name>Start` and `<name>End` as hidden inputs. */
  name: string;
  defaultStart?: string;
  defaultEnd?: string;
}) {
  const [range, setRange] = useState<DateRange | undefined>(() => {
    if (!defaultStart && !defaultEnd) return undefined;
    return {
      from: defaultStart ? parseISO(`${defaultStart}T00:00:00`) : undefined,
      to: defaultEnd ? parseISO(`${defaultEnd}T00:00:00`) : undefined,
    };
  });

  const startLabel = range?.from ? format(range.from, "MMM d, yyyy") : null;
  const endLabel = range?.to ? format(range.to, "MMM d, yyyy") : null;

  return (
    <Popover>
      <div className="flex gap-2">
        <PopoverTrigger
          render={<DateField placeholder="Start" display={startLabel} />}
        />
        <PopoverTrigger
          render={<DateField placeholder="End" display={endLabel} />}
        />
      </div>
      <PopoverContent
        className="w-auto p-3 bg-bg-panel border-border-subtle rounded-xl"
        align="start"
      >
        <DayPicker
          mode="range"
          numberOfMonths={2}
          selected={range}
          onSelect={setRange}
          className="rdp-themed"
        />
      </PopoverContent>
      <input
        type="hidden"
        name={`${name}Start`}
        value={range?.from ? format(range.from, "yyyy-MM-dd") : ""}
      />
      <input
        type="hidden"
        name={`${name}End`}
        value={range?.to ? format(range.to, "yyyy-MM-dd") : ""}
      />
    </Popover>
  );
}

function DateField({
  placeholder,
  display,
  ...props
}: {
  placeholder: string;
  display: string | null;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value">) {
  return (
    <button
      type="button"
      {...props}
      className="form-field flex-1 flex items-center gap-2 text-left"
    >
      <Calendar aria-hidden className="w-3.5 h-3.5 text-text-muted shrink-0" />
      <span
        className={
          display ? "text-input-value" : "text-input-placeholder"
        }
      >
        {display ?? placeholder}
      </span>
    </button>
  );
}
