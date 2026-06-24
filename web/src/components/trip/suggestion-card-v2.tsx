"use client";

import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

/**
 * Suggestion Card v2 — Phase D #1 "Browse the day", updated Location
 * Card design (Paper artboard `Location Card · Category Variants` 1PAV-0).
 *
 * Layout shifts vs the earlier draft:
 *  - Kebab floats top-right of the photo (semi-transparent chip) instead
 *    of sitting in the CTA row.
 *  - Detour info moves OFF the photo INTO the CTA row as a horizontal
 *    pill alongside the Add button. Time-major: `+1h28m  +5.8 MI`.
 *  - Title 19→24px, status 13→16px, description 14→16px.
 *  - Chevron-right gets a 28px rounded outline box.
 *
 * Same chrome across categories; the per-category palette is the only
 * thing that differs.
 */

export type DetourInfo = {
  /** Distance off-route in miles. 0 = on-route. */
  miles: number;
  /** Time delta in minutes. Optional — on-route / day-end statuses
   *  don't need a value. */
  minutes?: number;
  status: "detour" | "on-route" | "day-end";
};

type CategoryPalette = {
  chipBg: string;
  /** Chip border, category label, category icon stroke. */
  accent: string;
  /** Title tint — lighter shade of accent. */
  title: string;
  label: string;
};

const PALETTE: Record<SlideCategoryKey, CategoryPalette> = {
  food:      { chipBg: "#3E2A14", accent: "#F4C95D", title: "#F4DAA0", label: "FOOD" },
  scenic:    { chipBg: "#163E3A", accent: "#5DD4C5", title: "#B5EBE3", label: "SCENIC" },
  camping:   { chipBg: "#0F2E1F", accent: "#6BB280", title: "#A8D4B7", label: "CAMPING" },
  overnight: { chipBg: "#0F2E1F", accent: "#4D9A6E", title: "#A8D4B7", label: "OVERNIGHT" },
  oddity:    { chipBg: "#2A1A3E", accent: "#B589F0", title: "#D8C4F8", label: "ODDITY" },
  fuel:      { chipBg: "#2E1414", accent: "#E26F6F", title: "#F2B5B5", label: "FUEL" },
  attraction:{ chipBg: "#3A2E12", accent: "#E6B422", title: "#F2D98C", label: "ATTRACTION" },
  interest:  { chipBg: "#1C2230", accent: "#8AA0C0", title: "#C4D2E8", label: "POINT OF INTEREST" },
  urban:     { chipBg: "#15263E", accent: "#5B9BD5", title: "#AED0F0", label: "URBAN" },
};

type StatusPalette = {
  /** Outer pill bg. */
  bg: string;
  /** Outer pill border. */
  border: string;
  /** Icon panel bg (slightly darker than border). */
  panelBg: string;
  /** Stroke for the icon inside the panel. */
  iconStroke: string;
  /** Color of the time text. */
  timeColor: string;
  /** Color of the miles text. */
  milesColor: string;
};

const STATUS_PALETTE: Record<DetourInfo["status"], StatusPalette> = {
  // Off-route detour — yellow with chevron-up icon.
  detour: {
    bg: "#1F1B0F",
    border: "rgba(212,172,77,0.68)",
    panelBg: "#997E39",
    iconStroke: "#161819",
    timeColor: "#CFCECE",
    milesColor: "#B6A67C",
  },
  // On-route — green with check icon.
  "on-route": {
    bg: "#0F1F12",
    border: "rgba(77,154,110,0.68)",
    panelBg: "#3E7754",
    iconStroke: "#0F1F12",
    timeColor: "#CFCECE",
    milesColor: "#A8D4B7",
  },
  // End-of-day stop — green with check icon.
  "day-end": {
    bg: "#0F1F12",
    border: "rgba(77,154,110,0.68)",
    panelBg: "#3E7754",
    iconStroke: "#0F1F12",
    timeColor: "#CFCECE",
    milesColor: "#A8D4B7",
  },
};

type Props = {
  place: BrowsePlace;
  category: SlideCategoryKey;
  dayNumber: number;
  detour?: DetourInfo;
  status?: { text: string; tone?: "ok" | "warn" };
  onAdd?: () => void;
  onOpen?: () => void;
  onMore?: () => void;
};

export function SuggestionCardV2({
  place,
  category,
  dayNumber,
  detour,
  status,
  onAdd,
  onOpen,
  onMore,
}: Props) {
  const palette = PALETTE[category];
  const addLabel =
    category === "overnight" ? `Book for Tonight` : `Add to Day ${dayNumber}`;

  return (
    <div
      className="relative flex flex-col w-full rounded-md overflow-hidden bg-[#161819] border border-solid"
      style={{ borderColor: "rgba(255,255,255,0.07)" }}
    >
      <Hero photoUrl={place.photoUrl} alt={place.photoAlt} onMore={onMore} />
      <div className="flex flex-col gap-3 pt-[18px] pr-4 pb-3.5 pl-[14px]">
        <TitleRow
          palette={palette}
          title={place.title}
          status={status}
          onOpen={onOpen}
        />
        <p className="font-sans text-base leading-5 text-[#C8CDD1] line-clamp-3">
          {place.description}
        </p>
        <CtaRow
          label={addLabel}
          detour={detour}
          onAdd={onAdd}
        />
      </div>
    </div>
  );
}

// ── Hero (photo + floating kebab) ─────────────────────────────────────

function Hero({
  photoUrl,
  alt,
  onMore,
}: {
  photoUrl?: string;
  alt: string;
  onMore?: () => void;
}) {
  return (
    <div
      className="relative h-40 shrink-0 bg-cover bg-center bg-[#1F1F1F]"
      style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}
      role="img"
      aria-label={alt}
    >
      {/* Soft bottom-fade so the card transition into content reads. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(22,24,25,0) 0%, rgba(22,24,25,0) 45%, rgba(22,24,25,0.6) 100%)",
        }}
      />
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          aria-label="More options"
          className="absolute top-1 right-1 flex items-center justify-center w-11 h-11 rounded-md border border-solid hover:bg-[rgba(31,41,45,0.95)] transition-colors"
          style={{
            background: "rgba(31,41,45,0.8)",
            borderColor: "rgba(255,255,255,0.49)",
            color: "rgba(217,221,225,0.83)",
          }}
        >
          <KebabIcon />
        </button>
      )}
    </div>
  );
}

// ── Title row (chip + label + title + status + chevron) ──────────────

function TitleRow({
  palette,
  title,
  status,
  onOpen,
}: {
  palette: CategoryPalette;
  title: string;
  status?: { text: string; tone?: "ok" | "warn" };
  onOpen?: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <CategoryChip palette={palette} />
      <div className="flex flex-col grow min-w-0 pt-px gap-1.5">
        <span
          className="font-mono font-bold text-[10px] leading-3"
          style={{ letterSpacing: "0.14em", color: palette.accent }}
        >
          {palette.label}
        </span>
        <h3
          className="font-sans font-bold text-2xl leading-[22px]"
          style={{ letterSpacing: "0.005em", color: palette.title }}
        >
          {title}
        </h3>
        {status && (
          <div className="flex items-center pt-0.5 gap-1.5">
            <span
              className="shrink-0 rounded-full w-1.5 h-1.5"
              style={{
                background: status.tone === "warn" ? "#E89058" : "#6BE26F",
              }}
            />
            <span className="font-sans text-base leading-4 text-[#A8B0B6]">
              {status.text}
            </span>
          </div>
        )}
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${title}`}
          className="flex items-center justify-center shrink-0 mt-1.5 w-7 h-7 rounded-[3px] text-[#6E7478] hover:text-text-primary"
          style={{ outline: "1px solid #6E7478" }}
        >
          <ChevronRightIcon />
        </button>
      )}
    </div>
  );
}

function CategoryChip({ palette }: { palette: CategoryPalette }) {
  return (
    <div
      className="flex items-center justify-center shrink-0 rounded-full w-11 h-11 border border-solid"
      style={{
        background: palette.chipBg,
        borderColor: palette.accent,
        boxShadow: "0 2px 3px rgba(0,0,0,0.4)",
      }}
    >
      <CategoryIcon color={palette.accent} label={palette.label} />
    </div>
  );
}

// ── CTA row (detour pill + Add button) ────────────────────────────────

function CtaRow({
  label,
  detour,
  onAdd,
}: {
  label: string;
  detour?: DetourInfo;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center pt-1 gap-2.5">
      {detour && <DetourPill detour={detour} />}
      <button
        type="button"
        onClick={onAdd}
        className="flex grow items-center justify-center h-11 rounded-md gap-2 bg-[#2A4A7F] border border-solid border-[#3D6BB3] hover:bg-[#3D6BB3] transition-colors px-3"
      >
        <PlusIcon />
        <span className="font-sans font-bold text-white text-[15px] leading-[18px]">
          {label}
        </span>
      </button>
    </div>
  );
}

function DetourPill({ detour }: { detour: DetourInfo }) {
  const palette = STATUS_PALETTE[detour.status];
  const timeLabel = formatTime(detour);
  const milesLabel = formatMiles(detour);
  return (
    <div
      className="flex shrink-0 h-11 rounded-md overflow-hidden border border-solid"
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <div
        className="flex items-center justify-center shrink-0 w-[30px]"
        style={{ background: palette.panelBg }}
      >
        {detour.status === "detour" ? (
          <ChevronUpIcon stroke={palette.iconStroke} />
        ) : (
          <CheckIcon stroke={palette.iconStroke} />
        )}
      </div>
      <div className="flex h-full items-center gap-2 px-2">
        <span
          className="shrink-0 font-bold text-[15px] leading-[18px]"
          style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            color: palette.timeColor,
          }}
        >
          {timeLabel}
        </span>
        <span
          className="shrink-0 text-[13px] leading-[16px]"
          style={{
            fontFamily: '"Space Grotesk", system-ui, sans-serif',
            color: palette.milesColor,
          }}
        >
          {milesLabel}
        </span>
      </div>
    </div>
  );
}

function formatTime(detour: DetourInfo): string {
  if (detour.status === "on-route") return "On route";
  if (detour.status === "day-end") return "Day-end";
  const m = detour.minutes ?? 0;
  if (m < 60) return `+${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `+${h}h` : `+${h}h${r}m`;
}

function formatMiles({ miles }: DetourInfo): string {
  const sign = miles >= 0 ? "+" : "";
  const value = miles % 1 === 0 ? miles.toFixed(0) : miles.toFixed(1);
  return `${sign}${value} MI`;
}

// ── Icons ─────────────────────────────────────────────────────────────

function ChevronUpIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 18 C 7 18, 7 6, 12 6 S 17 18, 21 18" />
    </svg>
  );
}

function CheckIcon({ stroke }: { stroke: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

/** Per-category glyph for the chip. */
function CategoryIcon({ color, label }: { color: string; label: string }) {
  const stroke = color;
  switch (label) {
    case "FOOD":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 8h1a3 3 0 0 1 0 6h-1" />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
          <line x1="6" y1="2" x2="6" y2="5" />
          <line x1="10" y1="2" x2="10" y2="5" />
          <line x1="14" y1="2" x2="14" y2="5" />
        </svg>
      );
    case "SCENIC":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 20 9 9 13 15 16 11 21 20" />
          <circle cx="17" cy="6" r="1.5" />
        </svg>
      );
    case "CAMPING":
    case "OVERNIGHT":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 20 L12 4 L21 20 Z" />
          <path d="M10 20 L12 14 L14 20" />
        </svg>
      );
    case "ODDITY":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <ellipse cx="12" cy="12" rx="10" ry="6" />
        </svg>
      );
    case "FUEL":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="10" height="18" rx="1" />
          <line x1="6" y1="7" x2="12" y2="7" />
          <path d="M14 9 h4 v9 a2 2 0 0 1 -2 2 a2 2 0 0 1 -2 -2 V9z" />
          <path d="M16 4 v3" />
        </svg>
      );
    default:
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.75">
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
  }
}
