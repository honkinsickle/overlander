import * as React from "react";
import {
  X,
  Fuel,
  Tent,
  Mountain,
  Building2,
  UtensilsCrossed,
  Eye,
  Star,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Category =
  | "fuel"
  | "camping"
  | "mountain"
  | "urban"
  | "food"
  | "oddity"
  | "attraction"
  | "neutral";

/** Maps a category to the --cat-* accent + --cat-*-bg pair. Inline styles
 *  rather than Tailwind utilities so the category can be driven by data. */
export const categoryStyle: Record<
  Category,
  { accent: string; bg: string; label: string }
> = {
  fuel:       { accent: "var(--cat-fuel)",       bg: "var(--cat-fuel-bg)",       label: "FUEL" },
  camping:    { accent: "var(--cat-camping)",    bg: "var(--cat-camping-bg)",    label: "CAMPING" },
  mountain:   { accent: "var(--cat-mountain)",   bg: "var(--cat-mountain-bg)",   label: "MOUNTAIN" },
  urban:      { accent: "var(--cat-urban)",      bg: "var(--cat-urban-bg)",      label: "URBAN" },
  food:       { accent: "var(--cat-food)",       bg: "var(--cat-food-bg)",       label: "FOOD" },
  oddity:     { accent: "var(--cat-oddity)",     bg: "var(--cat-oddity-bg)",     label: "ODDITY" },
  attraction: { accent: "var(--cat-attraction)", bg: "var(--cat-attraction-bg)", label: "ATTRACTION" },
  neutral:    { accent: "var(--cat-neutral)",    bg: "var(--cat-neutral-bg)",    label: "NEUTRAL" },
};

/** Lucide icon per category — used in the Waypoint Card badge (Paper ALI-0).
 *  Paper uses emoji (🛢 ⛺ 🚕 🏔 👁 🍔 ⭐); these are the closest lucide matches. */
export const categoryIcon: Record<
  Category,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  fuel:       Fuel,
  camping:    Tent,
  mountain:   Mountain,
  urban:      Building2,
  food:       UtensilsCrossed,
  oddity:     Eye,
  attraction: Star,
  neutral:    MapPin,
};

export type DetailCardProps = {
  category: Category;
  title: string;
  subtitle?: string;
  /** Optional hero content (image, map, etc). */
  hero?: React.ReactNode;
  /** Where the close button navigates/dispatches. */
  closeHref?: string;
  onClose?: () => void;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Detail card used as the Location Detail surface in the map column.
 * Category tint drives hero + accent color; body is composable.
 *
 * Use `.form-field`, buttons, and <DetailSection> inside for consistency.
 */
export function DetailCard({
  category,
  title,
  subtitle,
  hero,
  closeHref,
  onClose,
  children,
  className,
}: DetailCardProps) {
  const cat = categoryStyle[category];

  return (
    <article
      className={cn(
        "flex flex-col bg-bg-panel border border-border-subtle rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.7)] overflow-hidden",
        className,
      )}
    >
      <div
        className="relative flex items-end h-44 p-4"
        style={{
          background: hero
            ? undefined
            : `linear-gradient(135deg, ${cat.bg} 0%, color-mix(in srgb, ${cat.bg} 60%, #000) 100%)`,
        }}
      >
        {hero ?? null}
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-display text-[10px] tracking-[0.06em] uppercase"
          style={{
            backgroundColor: "rgba(17,18,20,0.75)",
            borderColor: "rgba(255,255,255,0.08)",
            color: cat.accent,
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: cat.accent }}
          />
          {cat.label}
        </span>
        {(closeHref || onClose) && (
          <CloseButton closeHref={closeHref} onClose={onClose} />
        )}
      </div>

      <header className="flex flex-col gap-1 px-5 pt-4 pb-2">
        <h2
          className="font-sans text-xl font-bold leading-tight"
          style={{ color: cat.accent }}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-text-muted">{subtitle}</p>
        )}
      </header>

      <div className="flex flex-col gap-3 px-5 pb-5">{children}</div>
    </article>
  );
}

function CloseButton({
  closeHref,
  onClose,
}: {
  closeHref?: string;
  onClose?: () => void;
}) {
  const className =
    "absolute top-3 right-3 flex items-center justify-center w-8 h-8 rounded-full bg-black/50 border border-white/10 text-text-primary hover:bg-black/70";
  if (closeHref) {
    return (
      <a href={closeHref} aria-label="Close" className={className}>
        <X className="w-3.5 h-3.5" />
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className={className}
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

/** Amber callout used inside DetailCard for `↳`-style notes. */
export function DetailTip({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2.5 rounded-[10px]"
      style={{
        backgroundColor: "rgba(200,169,110,0.08)",
        borderColor: "rgba(200,169,110,0.18)",
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <span
        aria-hidden
        className="font-mono text-amber shrink-0 mt-0.5"
        style={{ color: "var(--amber)" }}
      >
        ↳
      </span>
      <div className="flex-1 font-mono text-xs leading-[18px] text-amber">
        {children}
      </div>
    </div>
  );
}

/** 3-up stat tiles row (DETOUR / STOP TIME / ETA etc). */
export function DetailStats({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="flex gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex-1 flex flex-col gap-0.5 px-3 py-2.5 bg-bg-card border border-border-subtle rounded-[10px]"
        >
          <span className="section-label text-[10px] tracking-[0.08em] text-text-muted">
            {item.label}
          </span>
          <span className="font-sans text-base font-bold text-text-primary">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
