import type { ReactNode } from "react";
import type { Category } from "@/components/primitives/detail-card";
import { categoryStyle } from "@/components/primitives/detail-card";

/**
 * Card container for a category's chip group. Renders a tinted circular
 * icon, Space Grotesk heading + sub-label, a right-aligned "N PICKED"
 * counter, and the chip children in a wrapping row.
 *
 * The counter value is owned by the parent (form state) so it stays in
 * sync with native checkbox changes without managing inner state here.
 */
export function CategoryCard({
  category,
  icon: Icon,
  title,
  subtitle,
  pickedCount,
  children,
}: {
  category: Category;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  subtitle: string;
  pickedCount: number;
  children: ReactNode;
}) {
  const { accent, bg } = categoryStyle[category];
  return (
    <section className="flex flex-col gap-3 p-4 rounded-xl border border-border-subtle bg-bg-card">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: bg }}
          >
            <Icon
              aria-hidden
              className="w-4 h-4"
              style={{ color: accent }}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <div
              className="font-display uppercase tracking-[0.08em] text-xs"
              style={{ color: accent }}
            >
              {title}
            </div>
            <div className="text-xs text-text-muted">{subtitle}</div>
          </div>
        </div>
        <span
          className="font-display uppercase tracking-[0.08em] text-[10px] text-text-muted"
          aria-live="polite"
        >
          {pickedCount} PICKED
        </span>
      </header>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}
