"use client";

import type { BrowsePlace } from "@/lib/trip-browse/places";
import { type BrowseCardCategory } from "@/lib/trip-browse/palette";
import {
  CategoryIconV2,
  type CategoryIconV2Name,
} from "@/components/icons/category-icons-v2";

/**
 * Day Detail Overview — visual port of Paper "Day Detail Overview" (`EP3-0`).
 *
 * Pure presentational: takes props, renders the design, knows nothing about
 * the rail or any parent state. One long scrolling column, fixed at
 * `--rail-card-w` (462px), with three anchored sections the rail nav will
 * scroll to later:
 *   - #overview  — hero (route-pair over a photo)
 *   - #guides    — banner + two guide tiles + MORE GUIDES
 *   - #places    — banner + numbered place cards + MORE PLACES TO VISIT
 *
 * All interactions are stubbed no-ops (// TODO: wire).
 */

// TODO: wire — Add-to-Day, More Guides, More Places are a later pass.
const noop = () => {};

export type OverviewGuide = {
  title: string;
  description: string;
  /** e.g. "yoTrippin staff" */
  byline: string;
  imageUrl?: string;
};

export type OverviewPlace = Pick<
  BrowsePlace,
  "title" | "photoUrl" | "photoAlt" | "description" | "rating" | "reviewCount"
> & {
  category: BrowseCardCategory;
  detour: { miles: number; minutes?: number };
  verified?: boolean;
};

type Props = {
  /** Route-pair shown over the hero, e.g. "Los Angeles, CA → Portland, OR". */
  routeLabel: string;
  heroImageUrl?: string;
  heroAlt?: string;
  guidesSubtitle: string;
  guides: OverviewGuide[];
  placesSubtitle: string;
  places: OverviewPlace[];
  /** Drives the "Add to Day N" CTA label on place cards. */
  dayNumber: number;
};

export function DayDetailOverview({
  routeLabel,
  heroImageUrl,
  heroAlt = "",
  guidesSubtitle,
  guides,
  placesSubtitle,
  places,
  dayNumber,
}: Props) {
  return (
    <div
      className="flex flex-col shrink-0 h-full overflow-y-auto no-scrollbar"
      style={{ width: "var(--rail-card-w)", backgroundColor: "var(--bg-base)" }}
    >
      {/* ── Overview (hero) ─────────────────────────────────── */}
      <section id="overview" className="shrink-0 px-[7px] pt-[11px]">
        <Hero routeLabel={routeLabel} imageUrl={heroImageUrl} alt={heroAlt} />
      </section>

      {/* ── Guides ──────────────────────────────────────────── */}
      <section id="guides" className="shrink-0 flex flex-col pt-3">
        <SectionBanner title="Guides" subtitle={guidesSubtitle} />
        <div className="flex gap-[13px] px-[10px] pt-[11px]">
          {guides.map((g) => (
            <GuideTile key={g.title} guide={g} />
          ))}
        </div>
        <MoreButton label="More guides" />
      </section>

      {/* ── Places ──────────────────────────────────────────── */}
      <section id="places" className="shrink-0 flex flex-col pt-3">
        <SectionBanner title="Top Places to Visit" subtitle={placesSubtitle} />
        <div className="flex flex-col pt-[11px]">
          {places.map((p, i) => (
            <PlaceCard key={p.title} place={p} n={i + 1} dayNumber={dayNumber} />
          ))}
        </div>
        <MoreButton label="More places to visit" />
      </section>
    </div>
  );
}

/* ── Hero ──────────────────────────────────────────────────── */

function Hero({
  routeLabel,
  imageUrl,
  alt,
}: {
  routeLabel: string;
  imageUrl?: string;
  alt: string;
}) {
  return (
    <div
      role="img"
      aria-label={alt || routeLabel}
      className="relative overflow-clip"
      style={{
        height: 212,
        borderRadius: 3,
        border: "1px solid var(--border-subtle)", // FLAG: board uses #1E1E1D (opaque)
        backgroundColor: "var(--bg-card)",
        backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Bottom scrim so the label reads over the photo. FLAG: raw black alpha
       *  (scrim, matches LocationBrowseCard convention). */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0"
        style={{ height: 158, background: "linear-gradient(to top, rgba(0,0,0,0.70), transparent)" }}
      />
      <div
        className="absolute left-[34px] bottom-[18px]"
        style={{
          color: "var(--text-primary)",
          fontFamily: "var(--ff-sans)",
          fontWeight: 700,
          fontSize: 24,
          lineHeight: "27px",
        }}
      >
        {routeLabel}
      </div>
    </div>
  );
}

/* ── Section banner (Guides / Places headers) ──────────────── */

function SectionBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="flex flex-col justify-center shrink-0"
      style={{
        height: 64,
        padding: "12px 2px 16px 17px",
        gap: 1,
        borderRadius: 2,
        backgroundColor: "var(--steel-800)", // FLAG: board uses #243543 (no exact token)
        boxShadow: "0 2px 3px rgba(0,0,0,0.15)",
      }}
    >
      <span
        style={{
          color: "var(--text-primary)",
          fontFamily: "var(--ff-sans)",
          fontWeight: 500,
          fontSize: 20,
          lineHeight: "28px",
        }}
      >
        {title}
      </span>
      <span
        style={{
          color: "var(--type-300)", // FLAG: board uses #B1AFAF (near --type-300)
          fontFamily: "var(--ff-sans)",
          fontSize: 13,
          lineHeight: "14px",
          letterSpacing: "0.02em",
        }}
      >
        {subtitle}
      </span>
    </div>
  );
}

/* ── Guide tile ────────────────────────────────────────────── */

function GuideTile({ guide }: { guide: OverviewGuide }) {
  return (
    <div className="flex flex-col" style={{ width: 240 }}>
      <div
        role="img"
        aria-label={guide.title}
        className="shrink-0 overflow-clip"
        style={{
          width: 240,
          height: 150,
          borderRadius: 10,
          border: "1px solid var(--border-subtle)", // FLAG: board uses #1E1E1D
          backgroundColor: "var(--bg-card)",
          backgroundImage: guide.imageUrl ? `url(${guide.imageUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <span
        style={{
          marginTop: 14,
          color: "var(--text-primary)",
          fontFamily: "var(--ff-sans)",
          fontWeight: 700,
          fontSize: 20,
          lineHeight: "24px",
        }}
      >
        {guide.title}
      </span>
      <span
        style={{
          marginTop: 8,
          color: "var(--type-100)", // FLAG: board uses #DEDEDE (near --type-100)
          fontFamily: "var(--ff-sans)",
          fontSize: 14,
          lineHeight: "20px",
        }}
      >
        {guide.description}
      </span>
      <div className="flex items-center" style={{ marginTop: 14, gap: 10 }}>
        <span
          className="shrink-0 rounded-full"
          style={{
            width: 18,
            height: 18,
            backgroundColor: "var(--amber)",
            border: "1.5px solid var(--bg-base)",
          }}
        />
        <span
          style={{
            color: "var(--amber-light)", // FLAG: board uses #FDBA74 (brighter orange, no token)
            fontFamily: "var(--ff-mono)",
            fontSize: 12,
            lineHeight: "16px",
          }}
        >
          {guide.byline}
        </span>
      </div>
    </div>
  );
}

/* ── MORE … button (shared by Guides + Places) ─────────────── */

function MoreButton({ label }: { label: string }) {
  return (
    <div className="flex justify-center pt-[11px]">
      <button
        type="button"
        onClick={noop}
        className="flex items-center justify-center shrink-0"
        style={{
          gap: 8,
          height: 38,
          padding: "11px 21px",
          borderRadius: 4,
          backgroundColor: "var(--steel-800)", // FLAG: board uses #24354F (= --cat-scenic-badge-bg value; no generic token)
          border: "0.5px solid var(--focus)", // FLAG: board uses #A6C9F9 (near --focus)
          boxShadow: "0 2px 3px rgba(0,0,0,0.20)",
        }}
      >
        <PinIcon />
        <span
          className="uppercase"
          style={{
            color: "var(--text-primary)",
            fontFamily: "var(--ff-display)",
            fontSize: 12,
            lineHeight: "16px",
            letterSpacing: "0.1em",
          }}
        >
          {label}
        </span>
        <ArrowRight />
      </button>
    </div>
  );
}

/* ── Place card (420-list row + numbered pin) ──────────────── */

function PlaceCard({
  place,
  n,
  dayNumber,
}: {
  place: OverviewPlace;
  n: number;
  dayNumber: number;
}) {
  const { category } = place;
  const ctaBg = `var(--cat-${category}-cta-bg)`;
  const ctaBorder = `var(--cat-${category}-cta-border)`;
  const meta =
    place.rating !== undefined ? `${place.rating.toFixed(1)}` : undefined;
  const off = [
    `+${place.detour.miles} mi`,
    place.detour.minutes !== undefined ? `+${place.detour.minutes} min off-route` : null,
    `Day ${dayNumber}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="relative shrink-0 self-center" style={{ width: 404, paddingBlock: 6 }}>
      {/* Numbered pin, overhanging the card's left edge. */}
      <div className="absolute z-10" style={{ left: -18, top: 12, width: 40, height: 40 }}>
        <NumberedPin n={n} />
      </div>

      <article
        onClick={noop}
        className="flex flex-col overflow-clip"
        style={{
          minHeight: 190,
          padding: "10px 15px 11px 40px",
          borderRadius: 6,
          backgroundColor: "color-mix(in srgb, var(--grounds-850) 40%, transparent)",
          border: "1px solid var(--border-strong)",
        }}
      >
        {/* Badge + title + verified. */}
        <div className="flex items-start" style={{ gap: 8 }}>
          <span
            className="flex items-center justify-center shrink-0"
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              backgroundColor: ctaBg,
              border: `0.5px solid ${ctaBorder}`,
              boxShadow: "0 2px 3px #00000066", // FLAG: raw shadow (matches LocationBrowseCard)
            }}
          >
            <CategoryIconV2 category={category as CategoryIconV2Name} size={22} />
          </span>
          <div className="flex flex-col min-w-0" style={{ gap: 2, paddingTop: 1 }}>
            <span
              className="line-clamp-1"
              style={{
                color: `var(--cat-${category}-title)`,
                fontFamily: "var(--ff-display-condensed)",
                fontWeight: 700,
                fontStretch: "condensed",
                fontSize: 22,
                lineHeight: "25px",
                letterSpacing: "0.005em",
              }}
            >
              {place.title}
            </span>
            <div className="flex items-center" style={{ gap: 4, height: 20 }}>
              {(place.verified ?? true) && (
                <span style={metaMono}>yoTrippin Verified</span>
              )}
              {meta !== undefined && (
                <>
                  <Star />
                  <span style={metaMono}>{meta}</span>
                  {place.reviewCount !== undefined && (
                    <span style={{ ...metaMono, color: "var(--text-muted)", fontSize: 11, lineHeight: "14px" }}>
                      ({formatCount(place.reviewCount)})
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Thumbnail + description over CTA. */}
        <div className="flex" style={{ gap: 6, marginTop: 14 }}>
          <div
            role="img"
            aria-label={place.photoAlt}
            className="shrink-0"
            style={{
              width: 119,
              height: 82,
              borderRadius: 3,
              backgroundColor: ctaBg,
              backgroundImage: place.photoUrl ? `url(${place.photoUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="flex flex-col justify-between min-w-0" style={{ height: 82 }}>
            <p
              className="line-clamp-3"
              style={{
                color: "var(--type-300)", // FLAG: board uses #C2C7CB (near --type-300)
                fontFamily: "var(--ff-sans)",
                fontSize: 13,
                lineHeight: "17px",
              }}
            >
              {place.description}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                noop();
              }}
              className="flex items-center justify-center self-start gap-1 rounded shrink-0"
              style={{
                height: 23,
                padding: "0 17px 0 22px",
                backgroundColor: ctaBg,
                outline: `1px solid ${ctaBorder}`,
                color: "var(--text-primary)",
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                lineHeight: "16px",
              }}
            >
              <Plus />
              Add to Day {dayNumber}
            </button>
          </div>
        </div>

        <span
          style={{
            marginTop: 12,
            color: "var(--amber)",
            fontFamily: "var(--ff-mono)",
            fontSize: 11,
            lineHeight: "14px",
          }}
        >
          {off}
        </span>
      </article>
    </div>
  );
}

const metaMono = {
  color: "var(--type-300)",
  fontFamily: "var(--ff-mono)",
  fontSize: 12,
  lineHeight: "16px",
  letterSpacing: "0.04em",
  flexShrink: 0,
} as const;

/** 9300 → "9.3k", 5000 → "5k", 881 → "881". */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

/* ── Icons ─────────────────────────────────────────────────── */

function Star() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0" style={{ overflow: "visible" }} fill="var(--amber-dark)">
      <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
    </svg>
  );
}

function Plus() {
  return (
    <svg width="10" height="10" viewBox="0 0 20 20" className="shrink-0" style={{ overflow: "visible" }} fill="none" stroke="var(--text-primary)" strokeWidth={2} strokeLinecap="round">
      <path d="M10 4.167v11.666" />
      <path d="M4.166 10h11.668" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="19" height="20" viewBox="0 0 19 20" className="shrink-0" style={{ overflow: "visible" }}>
      <path
        d="M9.5 0.647C5.32 0.647 1.9 4.129 1.9 8.389 1.9 13.87 9.5 19.353 9.5 19.353 9.5 19.353 17.1 13.87 17.1 8.389 17.1 4.129 13.68 0.647 9.5 0.647Z"
        fill="var(--pin)"
      />
    </svg>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 15.272 15.272" className="shrink-0" style={{ overflow: "visible" }} fill="none" stroke="var(--text-primary)" strokeOpacity={0.8} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <line x1="3.18" y1="7.636" x2="12.089" y2="7.636" />
      <polyline points="7.634 3.182 12.089 7.636 7.634 12.09" />
    </svg>
  );
}

/** Orange map-pin with a centered number — the place-ranking gutter marker. */
function NumberedPin({ n }: { n: number }) {
  return (
    <div className="relative" style={{ width: 40, height: 40 }}>
      <svg width="40" height="40" viewBox="0 0 40 40" className="absolute inset-0" style={{ overflow: "visible" }}>
        <path
          d="M20 1.291C11.2 1.291 4 8.258 4 16.774 4 27.742 20 38.71 20 38.71 20 38.71 36 27.742 36 16.774 36 8.258 28.8 1.291 20 1.291Z"
          fill="var(--pin)"
        />
      </svg>
      <span
        className="absolute inset-x-0 text-center"
        style={{
          top: 3,
          color: "#FFFFFF", // FLAG: raw white (no white token); pin numeral
          fontFamily: "var(--ff-sans)",
          fontWeight: 700,
          fontSize: 18,
          lineHeight: "28px",
        }}
      >
        {n}
      </span>
    </div>
  );
}
