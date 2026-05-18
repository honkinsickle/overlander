"use client";

import type { CSSProperties } from "react";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import {
  browseCardPalette,
  type BrowseCardCategory,
} from "@/lib/trip-browse/palette";
import {
  CategoryIcon,
  type CategoryIconName,
} from "@/components/icons/category-icons";

/**
 * Location Browse Card — Paper-aligned chrome for the Browse panel.
 *
 * Artboards: `Location Card · 300w · category variants` (1PZX-0),
 * `Location Card · 300 / 356 / 410 widths` (1PIF-0). Renders three sizes
 * driven by the `width` prop; inner padding/layout is flex-based and
 * adapts to the outer width.
 *
 * Layout:
 *   - Outer rounded card, 6px radius, #161819 bg, 1px translucent border
 *   - Hero (160h) with bg image + bottom fade
 *     - Full-bleed detour pill pinned to the top of the hero
 *     - Circular 44×44 category icon badge floated bottom-left of hero
 *     - Uppercase CATEGORY label next to the badge
 *   - Body: title (palette.titleLight) + status row + description + CTA row
 *   - CTA row: "Add to Day N" (flex:1) + 44×44 ellipsis "More" button
 */

export type CardWidth = 300 | 356 | 410;

/** Detour stat shown in the pill at the top of the hero. */
export type DetourInfo =
  | { onRoute: true }
  | { onRoute?: false; time: string; distanceMi: number };

type Props = {
  place: BrowsePlace;
  category: BrowseCardCategory;
  dayNumber: number;
  /** 300 = 2-up in 655w panel; 356 = 3-up expanded; 410 = 1-up in DayDetail. */
  width?: CardWidth;
  detour: DetourInfo;
  /** Status line under the title — e.g. "Open · 8a–7p", "Reserved · $33/night". */
  status?: { text: string };
  onAdd?: () => void;
  onOpen?: () => void;
  onMore?: () => void;
};

export function LocationBrowseCard({
  place,
  category,
  dayNumber,
  width = 300,
  detour,
  status,
  onAdd,
  onOpen,
  onMore,
}: Props) {
  const palette = browseCardPalette[category];
  const addLabel = category === "hotel" ? "Book for tonight" : `Add to Day ${dayNumber}`;

  // Fixed heights for the grid widths so rows align cleanly regardless
  // of title/description length: 300→396, 356→372. 410 (1-up DayDetail
  // slot) stays fit-content since it doesn't share a row with peers.
  const cardHeight = width === 300 ? 396 : width === 356 ? 372 : undefined;
  return (
    <div
      className="flex flex-col overflow-clip rounded-md bg-[#161819] border border-solid"
      style={{ width, height: cardHeight, borderColor: "#FFFFFF12" }}
    >
      <Hero
        photoUrl={place.photoUrl}
        alt={place.photoAlt}
        category={category}
        palette={palette}
        detour={detour}
      />
      <div className="flex flex-col gap-3 px-[14px] pt-[10px] pb-[14px] flex-1 min-h-0">
        <TitleRow
          title={place.title}
          titleColor={palette.titleLight}
          status={status}
          onOpen={onOpen}
        />
        <p className="font-sans text-[16px] leading-5 text-[#C8CDD1] line-clamp-3 flex-1 min-h-0">
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
  category,
  palette,
  detour,
}: {
  photoUrl?: string;
  alt: string;
  category: BrowseCardCategory;
  palette: (typeof browseCardPalette)[BrowseCardCategory];
  detour: DetourInfo;
}) {
  // No-photo fallback: linear gradient from the category's icon bg
  // (darker tint of the accent) into the card body bg. Gives the empty
  // hero a category-themed feel and ensures the icon badge has contrast.
  const bgStyle: CSSProperties = photoUrl
    ? { backgroundImage: `url(${photoUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { backgroundImage: `linear-gradient(180deg, ${palette.iconBg} 0%, #161819 100%)` };
  return (
    <div
      role="img"
      aria-label={alt}
      className="relative h-40 shrink-0"
      style={bgStyle}
    >
      {/* Bottom fade so the icon badge + label sit on a darker pocket. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(22,24,25,0) 0%, rgba(22,24,25,0) 45%, rgba(22,24,25,1) 100%)",
        }}
      />
      <DetourPill detour={detour} accent={palette.accent} />
      <IconBadge category={category} palette={palette} />
      <span
        className="absolute font-mono font-bold uppercase"
        style={{
          left: 62,
          top: 123,
          color: palette.accent,
          fontSize: 15,
          letterSpacing: "0.14em",
          lineHeight: "12px",
        }}
      >
        {palette.label}
      </span>
    </div>
  );
}

function DetourPill({
  detour,
  accent,
}: {
  detour: DetourInfo;
  accent: string;
}) {
  const time = detour.onRoute ? "+0" : detour.time;
  const dist = detour.onRoute ? "/ ON ROUTE" : `/ ${detour.distanceMi.toFixed(1)} MI`;
  return (
    <div
      className="absolute left-[2px] right-[2px] top-[2px] flex items-center justify-center rounded-md bg-[#0E1F12]"
      style={{ height: 30 }}
    >
      <span
        className="font-display"
        style={{ color: accent, fontSize: 18, lineHeight: "24px" }}
      >
        {time}
      </span>
      <span
        className="font-display ml-[5px]"
        style={{ color: "#B6A67C", fontSize: 18, lineHeight: "12px" }}
      >
        {dist}
      </span>
    </div>
  );
}

function IconBadge({
  category,
  palette,
}: {
  category: BrowseCardCategory;
  palette: (typeof browseCardPalette)[BrowseCardCategory];
}) {
  return (
    <div
      className="absolute flex items-center justify-center rounded-full border border-solid shadow-[0_2px_3px_rgba(0,0,0,0.4)]"
      style={{
        left: 11,
        top: 107,
        width: 44,
        height: 44,
        backgroundColor: palette.iconBg,
        borderColor: palette.accent,
      }}
    >
      <CategoryIcon
        category={category as CategoryIconName}
        size={22}
        stroke={palette.accent}
      />
    </div>
  );
}

function TitleRow({
  title,
  titleColor,
  status,
  onOpen,
}: {
  title: string;
  titleColor: string;
  status?: { text: string };
  onOpen?: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col grow min-w-0 pt-px gap-1.5">
        <h3
          className="font-sans font-bold line-clamp-2"
          style={{
            color: titleColor,
            fontSize: 24,
            letterSpacing: "0.005em",
            lineHeight: "25px",
          }}
        >
          {title}
        </h3>
        {status && (
          <div className="flex items-center gap-1.5 pt-px">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-[#6BE26F] shrink-0"
            />
            <span className="font-sans text-[16px] leading-4 text-[#A8B0B6]">
              {status.text}
            </span>
          </div>
        )}
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open details"
          className="flex items-center justify-center rounded-[3px] mt-1.5 size-7 shrink-0 outline outline-1 outline-[#6E7478] hover:bg-white/5"
        >
          <ChevronRight />
        </button>
      )}
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
    <div className="flex items-center gap-2.5 pt-1">
      <button
        type="button"
        onClick={onAdd}
        className="flex flex-1 items-center justify-center gap-1 h-11 rounded-md border border-solid bg-[#2A4A7FD4] border-[#3D6BB3] text-white font-sans font-bold text-[15px] leading-[18px] hover:bg-[#3D6BB3]"
      >
        <PlusIcon />
        {label}
      </button>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          aria-label="More options"
          className="flex items-center justify-center size-11 shrink-0 rounded-md border border-solid border-[#FFFFFF1A] hover:bg-white/5"
        >
          <KebabIcon />
        </button>
      )}
    </div>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E969C" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}
