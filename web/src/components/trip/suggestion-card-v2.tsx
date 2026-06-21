"use client";

import type { BrowsePlace, SlideCategoryKey } from "@/lib/trip-browse/places";

/**
 * Suggestion Card v2 — Phase D #1 "Browse the day".
 *
 * Paper artboards: `Suggestion Card v2 — Category Variants` (1ONG-0),
 * `Browse Day · Side Panel` (1G8Z-0). Shipped as a section inside each
 * day's content in the slideup (brief §13) so this card lives inside
 * DayDetail, not a separate surface.
 *
 * Same chrome across categories; the per-category palette is the only
 * thing that differs (chip bg/border, accent label, title tint). Six
 * color families pulled from scenes that match each category's mood.
 */

export type DetourInfo = {
  /** Distance off-route in miles. 0 = on-route. */
  miles: number;
  /** Time delta in minutes. */
  minutes?: number;
  /** Status word that pairs with the badge color: yellow chevron for
   *  "detour", green check for "on-route" / "day-end". */
  status: "detour" | "on-route" | "day-end";
};

type CategoryPalette = {
  /** Background of the round chip + the dark detour-badge background. */
  chipBg: string;
  /** Accent — chip border, category label, badge border, badge chevron bg. */
  accent: string;
  /** Title tint — lighter shade of the accent. */
  title: string;
  /** Caps label rendered above the title. */
  label: string;
};

const PALETTE: Record<SlideCategoryKey, CategoryPalette> = {
  food:      { chipBg: "#3E2A14", accent: "#F4C95D", title: "#F4DAA0", label: "FOOD" },
  scenic:    { chipBg: "#163E3A", accent: "#5DD4C5", title: "#B5EBE3", label: "SCENIC" },
  camping:   { chipBg: "#0F2E1F", accent: "#4D9A6E", title: "#A8D4B7", label: "CAMPING" },
  overnight: { chipBg: "#0F2E1F", accent: "#4D9A6E", title: "#A8D4B7", label: "OVERNIGHT" },
  oddity:    { chipBg: "#2A1A3E", accent: "#B589F0", title: "#D8C4F8", label: "ODDITY" },
  fuel:      { chipBg: "#2E1414", accent: "#E26F6F", title: "#F2B5B5", label: "FUEL" },
  attraction:{ chipBg: "#3A2E12", accent: "#E6B422", title: "#F2D98C", label: "ATTRACTION" },
  interest:  { chipBg: "#1C2230", accent: "#8AA0C0", title: "#C4D2E8", label: "POINT OF INTEREST" },
  urban:     { chipBg: "#15263E", accent: "#5B9BD5", title: "#AED0F0", label: "URBAN" },
};

/** Yellow (chevron-up, detour) vs green (check, on-route / day-end). */
const STATUS_BADGE: Record<DetourInfo["status"], {
  bg: string; border: string; accent: string; caption: string;
}> = {
  "detour":   { bg: "#1F1B0F", border: "#D4AC4D", accent: "#D4AC4D", caption: "#E2C988" },
  "on-route": { bg: "#0F1F12", border: "#4D9A6E", accent: "#4D9A6E", caption: "#A8D4B7" },
  "day-end":  { bg: "#0F1F12", border: "#4D9A6E", accent: "#4D9A6E", caption: "#A8D4B7" },
};

type Props = {
  place: BrowsePlace;
  category: SlideCategoryKey;
  dayNumber: number;
  detour?: DetourInfo;
  /** Short status line under the title — "Open · closes 5p", "Tours
   *  hourly · last 4p". Optional; omitted when source data lacks it. */
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
      className="flex flex-col w-full rounded-md overflow-hidden bg-[#161819] border border-solid"
      style={{ borderColor: "#FFFFFF12" }}
    >
      <Hero photoUrl={place.photoUrl} alt={place.photoAlt} detour={detour} />
      <div className="flex flex-col gap-3 pt-4 pr-4 pb-3.5 pl-3.5">
        <TitleRow
          palette={palette}
          title={place.title}
          status={status}
          onOpen={onOpen}
        />
        <p className="font-sans text-sm leading-5 text-[#C8CDD1] line-clamp-3">
          {place.description}
        </p>
        <CtaRow label={addLabel} onAdd={onAdd} onMore={onMore} />
      </div>
    </div>
  );
}

function Hero({
  photoUrl,
  alt,
  detour,
}: {
  photoUrl?: string;
  alt: string;
  detour?: DetourInfo;
}) {
  return (
    <div
      className="relative h-40 shrink-0 bg-cover bg-center bg-[#1F1F1F]"
      style={photoUrl ? { backgroundImage: `url(${photoUrl})` } : undefined}
      role="img"
      aria-label={alt}
    >
      {/* Bottom-fade so cards in a column read as separated. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(22,24,25,0) 0%, rgba(22,24,25,0) 45%, rgba(22,24,25,0.85) 100%)",
        }}
      />
      {detour && <DetourBadge detour={detour} />}
    </div>
  );
}

function DetourBadge({ detour }: { detour: DetourInfo }) {
  const { miles, minutes, status } = detour;
  const colors = STATUS_BADGE[status];
  const captionText =
    status === "on-route"
      ? "ON ROUTE"
      : status === "day-end"
        ? "DAY-END"
        : minutes !== undefined
          ? `+${minutes} MIN`
          : "";
  return (
    <div
      className="absolute top-3 right-3 flex rounded-lg overflow-hidden border border-solid"
      style={{ background: colors.bg, borderColor: colors.border }}
    >
      <div
        className="flex items-center justify-center px-2.5"
        style={{ background: colors.accent }}
      >
        {status === "detour" ? (
          <ChevronUpIcon stroke={colors.bg} />
        ) : (
          <CheckIcon stroke={colors.bg} />
        )}
      </div>
      <div className="flex flex-col py-2 px-3.5">
        <span className="font-mono font-bold text-white text-[22px] leading-6">
          {`${miles >= 0 ? "+" : ""}${miles % 1 === 0 ? miles.toFixed(0) : miles.toFixed(1)} MI`}
        </span>
        <span
          className="font-mono font-bold text-[10px] leading-3"
          style={{ letterSpacing: "0.14em", color: colors.caption }}
        >
          {captionText}
        </span>
      </div>
    </div>
  );
}

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
      <div className="flex flex-col grow min-w-0 pt-px gap-1">
        <span
          className="font-mono font-bold text-[10px] leading-3"
          style={{ letterSpacing: "0.14em", color: palette.accent }}
        >
          {palette.label}
        </span>
        <h3
          className="font-sans font-bold text-[19px] leading-[22px] truncate"
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
            <span className="font-sans text-[13px] leading-4 text-[#A8B0B6]">
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
          className="flex items-center justify-center shrink-0 mt-1.5 w-7 h-7 text-[#6E7478] hover:text-text-primary"
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

function CtaRow({
  label,
  onAdd,
  onMore,
}: {
  label: string;
  onAdd?: () => void;
  onMore?: () => void;
}) {
  return (
    <div className="flex items-center pt-1 gap-2.5">
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center justify-center grow h-11 rounded-md gap-2 bg-[#2A4A7F] border border-solid border-[#3D6BB3] hover:bg-[#3D6BB3] transition-colors"
      >
        <PlusIcon />
        <span className="font-sans font-bold text-white text-[15px] leading-[18px]">
          {label}
        </span>
      </button>
      <button
        type="button"
        onClick={onMore}
        aria-label="More options"
        className="flex items-center justify-center shrink-0 rounded-md w-11 h-11 border border-solid border-[#FFFFFF1A] text-[#8E969C] hover:text-text-primary"
      >
        <KebabIcon />
      </button>
    </div>
  );
}

// ── Icons (inlined to keep this file self-contained) ──────────────────

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

/** Per-category icon. The category chip is the same shape across
 *  categories; only the glyph + color changes. Uses the same lucide
 *  vocab as the existing app pins. */
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
          <path d="M12 2 a 10 10 0 0 1 10 10 a 10 10 0 0 1 -10 10 a 10 10 0 0 1 -10 -10 a 10 10 0 0 1 10 -10 z" />
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
