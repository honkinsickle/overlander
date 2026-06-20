import * as React from "react";
import {
  X,
  Fuel,
  Tent,
  Building2,
  UtensilsCrossed,
  Eye,
  Star,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mountain category renders the 🏔️ snow-capped mountain emoji rather than a
// lucide stroke icon. Wrapper accepts the same SVGProps shape so it's a
// drop-in for the rest of `categoryIcon`. Size is read from `width` prop or
// the tailwind `w-N` class (1 unit = 4px); falls back to 20.
function MountainEmojiIcon({
  className,
  style,
  width,
}: React.SVGProps<SVGSVGElement>) {
  let size = 20;
  if (typeof width === "number") size = width;
  else if (typeof width === "string") {
    const n = parseInt(width, 10);
    if (!Number.isNaN(n)) size = n;
  } else if (className) {
    const m = /\bw-(\d+(?:\.\d+)?)\b/.exec(className);
    if (m) size = parseFloat(m[1]) * 4;
  }
  return (
    <span
      aria-hidden
      className={className}
      style={{
        ...style,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
      }}
    >
      🏔️
    </span>
  );
}

export type Category =
  | "fuel"
  | "camping"
  | "mountain"
  | "urban"
  | "food"
  | "oddity"
  | "attraction"
  | "neutral";

/** Maps a category to its canonical Category Type tokens: accent → the
 *  `title` role, bg → the `cta-bg` role (per the design-system role map).
 *  Inline styles rather than Tailwind utilities so the category can be
 *  driven by data. Keys keep the data taxonomy (`mountain`/`neutral`); the
 *  artboard's `scenic`/`interest` token *names* are used for their values. */
export const categoryStyle: Record<
  Category,
  { accent: string; bg: string; label: string }
> = {
  fuel:       { accent: "var(--cat-fuel-title)",       bg: "var(--cat-fuel-cta-bg)",       label: "FUEL" },
  camping:    { accent: "var(--cat-camping-title)",    bg: "var(--cat-camping-cta-bg)",    label: "CAMPING" },
  mountain:   { accent: "var(--cat-scenic-title)",     bg: "var(--cat-scenic-cta-bg)",     label: "SIGHTS & LANDMARKS" },
  urban:      { accent: "var(--cat-urban-title)",      bg: "var(--cat-urban-cta-bg)",      label: "URBAN" },
  food:       { accent: "var(--cat-food-title)",       bg: "var(--cat-food-cta-bg)",       label: "FOOD" },
  oddity:     { accent: "var(--cat-oddity-title)",     bg: "var(--cat-oddity-cta-bg)",     label: "ODDITY" },
  attraction: { accent: "var(--cat-attraction-title)", bg: "var(--cat-attraction-cta-bg)", label: "ATTRACTION" },
  neutral:    { accent: "var(--cat-interest-title)",   bg: "var(--cat-interest-cta-bg)",   label: "NEUTRAL" },
};

/** Lucide icon per category — used in the Waypoint Card badge (Paper ALI-0).
 *  Paper uses emoji (🛢 ⛺ 🚕 🏔 👁 🍔 ⭐); these are the closest lucide matches. */
export const categoryIcon: Record<
  Category,
  React.ComponentType<React.SVGProps<SVGSVGElement>>
> = {
  fuel:       Fuel,
  camping:    Tent,
  mountain:   MountainEmojiIcon,
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
