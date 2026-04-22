import { Check } from "lucide-react";

/**
 * Toggle chip backed by a hidden checkbox inside a `<label>`.
 * Visual selection state comes from CSS (`has-[input:checked]`); no JS
 * needed for the core UI. The parent form can read `formData.getAll("chipIds")`
 * to collect selections natively.
 *
 * `accent` drives the selected-state border + text color. Callers should
 * pass the category's `--cat-*` token (e.g. `var(--cat-mountain)`).
 */
export function SelectableChip({
  id,
  label,
  accent,
  defaultChecked,
  onChange,
}: {
  id: string;
  label: string;
  accent: string;
  defaultChecked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <label
      className="group inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-input-border bg-input-surface text-sm text-text-muted cursor-pointer hover:border-input-border-hover has-[input:checked]:bg-[var(--chip-accent)]/10 has-[input:checked]:border-[var(--chip-accent)] has-[input:checked]:text-[var(--chip-accent)] has-[input:checked]:font-semibold transition-colors"
      style={{ ["--chip-accent" as string]: accent }}
    >
      <input
        type="checkbox"
        name="chipIds"
        value={id}
        defaultChecked={defaultChecked}
        onChange={onChange}
        className="peer sr-only"
      />
      <Check
        aria-hidden
        className="w-3 h-3 hidden peer-checked:inline-block"
      />
      <span>{label}</span>
    </label>
  );
}
