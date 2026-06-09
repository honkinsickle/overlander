"use client";

import type { CSSProperties } from "react";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import type { CardStats } from "@/lib/trip-browse/card-stats";
import {
  browseCardPalette,
  type BrowseCardCategory,
} from "@/lib/trip-browse/palette";
import {
  CategoryIconV2,
  type CategoryIconV2Name,
} from "@/components/icons/category-icons-v2";

/**
 * Location Browse Card — v2 chrome (Paper "Location Card · 300w /
 * 354w / 410w · category variants (v2)"). Renders 300×455 (2-up panel
 * default), 354×455 (3-up expanded), or 410×455 (day-detail suggested
 * stops). Outer shell + hero size scale with width; everything else is
 * shared.
 *
 * Layout (top to bottom):
 *   - Hero (212h): photo bg with absolute badge (14, 167) and a
 *     top-right kebab. No detour pill, no on-hero category label.
 *   - Body (241h): title in category accent color; status + rating
 *     row; divider; "Adds Xh Xm" + amber "DETAILS →" link; "You'd
 *     arrive at..." sage line; divider; outlined CTA full width.
 */

export type CardWidth = 300 | 354 | 410;

type Props = {
  place: BrowsePlace;
  category: BrowseCardCategory;
  dayNumber: number;
  /** ISO date of the day this card is browsed for. Used to show TODAY's
   *  opening hours (this weekday) rather than the full weekly schedule. */
  dayDate?: string;
  /** 300 = 2-up default; 354 = 3-up expanded. */
  width?: CardWidth;
  stats: CardStats;
  /** Overrides the CTA label (default "Add to Day N" / "Book for tonight").
   *  Top-level search passes "Add to a day" since ADD opens a day picker. */
  addLabel?: string;
  /** Show the "Adds <detour>" + "You'd arrive at…" block. Detour/ETA are
   *  corridor concepts — true for browse cards (a place near today's
   *  route). Pass false for corpus-wide search hits, where any detour
   *  number would be fabricated; the row is omitted instead of faked. */
  showDetour?: boolean;
  onAdd?: (e?: React.MouseEvent) => void;
  onOpen?: (e?: React.MouseEvent) => void;
  onMore?: (e?: React.MouseEvent) => void;
};

const HERO_H = 212;
const CARD_H = 455;
const BODY_PAD_X = 14;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Weekday name (e.g. "Monday") for an ISO date, in UTC to match how the
 *  rest of the app formats `Day.date`. undefined for missing/invalid. */
function weekdayFromISO(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return WEEKDAYS[d.getUTCDay()];
}

/** Compact a Google time-range portion ("9:00 AM – 11:00 PM") to the card
 *  form ("9a–11p"): drop ":00", AM/PM → lowercase a/p, normalize the dash.
 *  Leaves tokens it doesn't recognize untouched (e.g. a bare "12:30" in a
 *  multi-range day). */
function compactHourText(text: string): string {
  return text
    .replace(/(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?/g, (_m, h, min, ap) =>
      min === "00" ? `${h}${ap.toLowerCase()}` : `${h}:${min}${ap.toLowerCase()}`,
    )
    .replace(/\s*[–—-]\s*/g, "–")
    .trim();
}

/** Derive the card status line — TODAY's opening hours — from a real hours
 *  value. Returns "Open {range}" / "Closed" / "Open 24/7", or undefined
 *  when the shape can't be parsed safely (omit, never guess).
 *
 *  Handles the two real shapes that reach the card:
 *   - federated raw "24/7" → "Open 24/7"
 *   - Google `regularOpeningHours.weekdayDescriptions` joined with "; "
 *     ("Monday: 9:00 AM – 11:00 PM; Tuesday: Closed; …") → today's entry.
 *  Anything else (arbitrary OSM `opening_hours` strings; NPS arrays, which
 *  are already dropped upstream) → undefined. Uses the regular weekly
 *  schedule only (we don't fetch holiday/special hours). */
function todaysHours(value: string, weekday?: string): string | undefined {
  const v = value.trim();
  if (/^(open\s+)?24\s*\/\s*7$/i.test(v) || /^open 24 hours$/i.test(v)) {
    return "Open 24/7";
  }
  if (weekday && new RegExp(`\\b${weekday}\\s*:`, "i").test(v)) {
    const entry = v
      .split(/;\s*/)
      .find((e) => new RegExp(`^${weekday}\\s*:`, "i").test(e.trim()));
    if (!entry) return undefined;
    const portion = entry.slice(entry.indexOf(":") + 1).trim();
    if (/closed/i.test(portion)) return "Closed";
    if (/open 24 hours|24\s*\/\s*7/i.test(portion)) return "Open 24/7";
    const compact = compactHourText(portion);
    return compact ? `Open ${compact}` : undefined;
  }
  return undefined;
}

export function LocationBrowseCard({
  place,
  category,
  dayNumber,
  dayDate,
  width = 300,
  stats,
  addLabel,
  showDetour = true,
  onAdd,
  onOpen,
  onMore,
}: Props) {
  const palette = browseCardPalette[category];
  const ctaLabel =
    addLabel ??
    (category === "hotel" ? "Book for tonight" : `Add to Day ${dayNumber}`);
  // Federated (master_place) rows carry real provenance pills (incl. the
  // "MVUM corridor" status pill) and a "Federated from <sources>" mention.
  const isFederated = place.source === "master_place";
  // Status line = TODAY's opening hours (the browsed day's weekday), never
  // the full week and never a hardcoded placeholder:
  //   - real hours present → "Open 9a–11p" / "Closed" / "Open 24/7", or
  //     omitted if the shape can't be parsed safely (no guess).
  //   - no hours + lodging category → "Open 24/7" (the one safe default;
  //     NOT applied to camp/viewpoint/fuel, where it would be false).
  const rawHours = place.stats.find((s) => s.label === "HOURS")?.value;
  const hoursStatus = rawHours
    ? todaysHours(rawHours, weekdayFromISO(dayDate))
    : category === "hotel"
      ? "Open 24/7"
      : undefined;
  // Real rating + price from the source (Google live results). Both omitted
  // when the place carries none — shown only when real, never fabricated.
  const rating =
    typeof place.rating === "number"
      ? {
          value: place.rating.toFixed(1),
          count:
            typeof place.reviewCount === "number"
              ? place.reviewCount
              : undefined,
        }
      : undefined;
  // Detour is a real distance-based estimate — the "~" marks it approximate
  // on live cards ("Adds ~32m"). Federated cards keep their existing label.
  const addsLabel = isFederated
    ? stats.cost.hero
    : stats.cost.hero.replace(/^Adds\s+/, "Adds ~");

  return (
    <div
      className="flex flex-col overflow-clip rounded-md bg-[#161819] border border-solid"
      style={{ width, height: CARD_H, borderColor: "#FFFFFF12" }}
    >
      <Hero
        photoUrl={place.photoUrl}
        alt={place.photoAlt}
        category={category}
        badgeBg={palette.badgeBg}
        badgeBorder={palette.badgeBorder}
        onMore={onMore}
      />
      <div
        className="flex flex-col flex-1 min-h-0"
        style={{ paddingInline: BODY_PAD_X, paddingTop: 14, paddingBottom: 14 }}
      >
        <div style={{ flexShrink: 0 }}>
          <Title text={place.title} color={palette.titleColor} />
          {isFederated ? (
            <FederatedMeta
              pills={place.pills}
              mention={place.mention}
              hours={hoursStatus}
            />
          ) : (
            <StatusRow
              status={hoursStatus}
              rating={rating}
              priceTier={place.priceTier}
            />
          )}
        </div>
        <Divider marginBottom={9} />
        {(showDetour || onOpen) && (
          <>
            <div
              className="flex flex-col"
              style={{ minHeight: 24, flexShrink: 0, gap: 2 }}
            >
              {/* The "Adds <detour>" text is day-relative — shown only on
               *  near-route browse cards (showDetour). On corpus-wide search
               *  it would be fabricated, so it is omitted; the DETAILS link
               *  stays so the detail panel is still reachable. */}
              <AddsRow
                addsText={showDetour ? addsLabel : undefined}
                onOpen={onOpen}
              />
            </div>
            <Divider />
          </>
        )}
        <Cta
          label={ctaLabel}
          bg={palette.ctaBg}
          border={palette.ctaBorder}
          onClick={onAdd}
        />
      </div>
    </div>
  );
}

function Hero({
  photoUrl,
  alt,
  category,
  badgeBg,
  badgeBorder,
  onMore,
}: {
  photoUrl?: string;
  alt: string;
  category: BrowseCardCategory;
  badgeBg: string;
  badgeBorder: string;
  onMore?: (e?: React.MouseEvent) => void;
}) {
  const bgStyle: CSSProperties = photoUrl
    ? {
        backgroundImage: `url(${photoUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : { backgroundColor: badgeBg };
  return (
    <div
      role="img"
      aria-label={alt}
      className="relative shrink-0"
      style={{ height: HERO_H, ...bgStyle }}
    >
      <div
        className="absolute flex items-center justify-center"
        style={{
          left: 14,
          top: 167,
          width: 36,
          height: 36,
          borderRadius: 6,
          backgroundColor: badgeBg,
          border: `0.5px solid ${badgeBorder}`,
          boxShadow: "0 2px 3px #00000066",
        }}
      >
        <CategoryIconV2 category={category as CategoryIconV2Name} size={22} />
      </div>
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          aria-label="More options"
          className="absolute flex items-center justify-center"
          style={{
            top: 10,
            right: 10,
            width: 40,
            height: 40,
            borderRadius: 4,
            backgroundColor: "#0000007A",
            border: "1px solid #FFFFFF1F",
          }}
        >
          <KebabIcon />
        </button>
      )}
    </div>
  );
}

function Title({ text, color }: { text: string; color: string }) {
  return (
    <h3
      className="line-clamp-2"
      style={{
        color,
        fontFamily:
          "var(--font-barlow-condensed), system-ui, sans-serif",
        fontWeight: 700,
        fontStretch: "condensed",
        fontSize: 24,
        lineHeight: "25px",
        letterSpacing: "0.005em",
      }}
    >
      {text}
    </h3>
  );
}

/** Live-card status + rating + price row. Every part is optional and only
 *  rendered when a REAL value is present — no fabricated status string,
 *  star rating, or price. Renders nothing (no empty row, no dangling
 *  divider) when all are absent. */
function StatusRow({
  status,
  rating,
  priceTier,
}: {
  status?: string;
  rating?: { value: string; count?: number };
  priceTier?: 1 | 2 | 3 | 4;
}) {
  if (!status && !rating && !priceTier) return null;
  return (
    <div
      className="flex items-center justify-between"
      style={{ marginTop: 6, gap: 12 }}
    >
      {status ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            aria-hidden
            className="size-1.5 rounded-full shrink-0"
            style={{ backgroundColor: "#6BE26F" }}
          />
          <span
            className="truncate"
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 400,
              fontSize: 14,
              lineHeight: "16px",
              color: "#A8B0B6",
            }}
          >
            {status}
          </span>
        </div>
      ) : null}
      {rating || priceTier ? (
        <div
          className="flex items-center gap-2 shrink-0"
          style={{ marginLeft: "auto" }}
        >
          {rating ? (
            <div className="flex items-center gap-1">
              <StarIcon />
              <span
                style={{
                  fontFamily: "var(--ff-display)",
                  fontWeight: 400,
                  fontSize: 14,
                  lineHeight: "16px",
                  letterSpacing: "0.04em",
                  color: "#A8B0B6",
                }}
              >
                {rating.value}
              </span>
              {rating.count !== undefined ? (
                <span
                  style={{
                    fontFamily: "var(--ff-display)",
                    fontWeight: 400,
                    fontSize: 11,
                    lineHeight: "12px",
                    letterSpacing: "0.04em",
                    color: "#888888",
                  }}
                >
                  ({rating.count})
                </span>
              ) : null}
            </div>
          ) : null}
          {priceTier ? (
            <span
              aria-label={`Price level ${priceTier} of 4`}
              style={{
                fontFamily: "var(--ff-display)",
                fontWeight: 600,
                fontSize: 13,
                lineHeight: "16px",
                letterSpacing: "0.06em",
                color: "#98AC64",
              }}
            >
              {"$".repeat(priceTier)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Provenance row for federated (master_place) cards. Renders the place's
 *  pills — the legality/category chips like "Dispersed Camping" and the
 *  highlighted "MVUM corridor" status pill — plus the "Federated from
 *  <sources>" mention. Replaces the live card's StatusRow (hardcoded
 *  category status + fabricated star rating), neither of which applies to
 *  a federated row that has empty stats[]. */
function FederatedMeta({
  pills,
  mention,
  hours,
}: {
  pills: { label: string; status?: boolean }[];
  mention: { primary: string; secondary: string };
  /** Real opening-hours string from master_place.hours. Federated rows
   *  carry no rating/price, so hours is the only metric shown — and only
   *  when present. */
  hours?: string;
}) {
  return (
    <div className="flex flex-col" style={{ marginTop: 6, gap: 6 }}>
      {pills.length > 0 && (
        <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
          {pills.map((p, i) => (
            <span
              key={`${p.label}-${i}`}
              className="inline-flex items-center"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 11,
                lineHeight: "14px",
                letterSpacing: "0.04em",
                padding: "2px 7px",
                borderRadius: 4,
                color: p.status ? "#0F1410" : "#A8B0B6",
                backgroundColor: p.status ? "#6BE26F" : "#FFFFFF14",
                border: p.status ? "none" : "1px solid #FFFFFF1F",
                fontWeight: p.status ? 700 : 400,
              }}
            >
              {p.label}
            </span>
          ))}
        </div>
      )}
      {hours ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            aria-hidden
            className="size-1.5 rounded-full shrink-0"
            style={{ backgroundColor: "#6BE26F" }}
          />
          <span
            className="truncate"
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 400,
              fontSize: 14,
              lineHeight: "16px",
              color: "#A8B0B6",
            }}
          >
            {hours}
          </span>
        </div>
      ) : null}
      {mention.secondary && (
        <span
          className="truncate"
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 400,
            fontSize: 12,
            lineHeight: "16px",
            color: "#888888",
          }}
        >
          {mention.primary} {mention.secondary}
        </span>
      )}
    </div>
  );
}

function Divider({
  marginTop = 12,
  marginBottom = 12,
}: {
  marginTop?: number;
  marginBottom?: number;
}) {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        backgroundColor: "#FFFFFF12",
        marginTop,
        marginBottom,
        flexShrink: 0,
      }}
    />
  );
}

function AddsRow({
  addsText,
  onOpen,
}: {
  addsText?: string;
  onOpen?: (e?: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {addsText ? (
        <span
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 400,
            fontSize: 18,
            lineHeight: "24px",
            color: "#FFFFFF",
          }}
        >
          {addsText}
        </span>
      ) : (
        <span />
      )}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-1.5 shrink-0"
          style={{
            fontFamily: "var(--ff-display)",
            fontWeight: 500,
            fontSize: 12,
            lineHeight: "16px",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#C8A96E",
          }}
        >
          Details
          <ArrowRight />
        </button>
      )}
    </div>
  );
}

function Cta({
  label,
  bg,
  border,
  onClick,
}: {
  label: string;
  bg: string;
  border: string;
  onClick?: (e?: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded mt-auto self-center shrink-0"
      style={{
        width: 232,
        height: 44,
        backgroundColor: bg,
        border: `1px solid ${border}`,
        color: "#ECEAE4",
        fontFamily: "var(--ff-display)",
        fontWeight: 600,
        fontSize: 13,
        lineHeight: "16px",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      <PlusIcon />
      {label}
    </button>
  );
}

function StarIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="#C8A96E"
      stroke="#C8A96E"
      strokeWidth={1}
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.1 8.6 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.6 12 2" />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#C8A96E"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ECEAE4"
      strokeWidth={2.5}
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
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="#D9DDE0"
    >
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}
