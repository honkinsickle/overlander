import { ThumbsUp } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Amber-tinted card with radio-group rows. Each row is a full-width
 * `<label>` wrapping a hidden radio; `peer-checked:` variants drive the
 * visual state so the whole thing submits natively with no JS.
 *
 * Matches Paper's "Plan with Automagically AI" / "Explore on your own"
 * pattern from step 02. Accepts rich `title` / `description` ReactNodes
 * so callers can style individual phrases (e.g. amber italic brand name).
 */
export type ChoiceOption = {
  value: string;
  title: ReactNode;
  description?: ReactNode;
};

export function ChoiceCard({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: ChoiceOption[];
  defaultValue?: string;
}) {
  return (
    <fieldset
      className="flex flex-col gap-1 rounded-xl p-3"
      style={{
        backgroundColor: "rgba(200,169,110,0.06)",
        border: "1px solid rgba(200,169,110,0.18)",
      }}
    >
      {options.map((opt) => (
        <label
          key={opt.value}
          className="group flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-amber/10 has-[input:checked]:bg-amber/10"
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            defaultChecked={defaultValue === opt.value}
            className="peer sr-only"
          />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="font-sans text-sm text-text-primary">
              {opt.title}
            </div>
            {opt.description && (
              <div className="text-xs text-text-muted">{opt.description}</div>
            )}
          </div>
          <ThumbsUp
            aria-hidden
            className="w-4 h-4 shrink-0 mt-0.5 text-text-muted peer-checked:text-amber peer-checked:fill-amber/25 transition-colors"
          />
        </label>
      ))}
    </fieldset>
  );
}
