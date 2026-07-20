"use client";

import { GripVertical } from "lucide-react";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import { type BrowseCardCategory } from "@/lib/trip-browse/palette";
import {
  CategoryIconV2,
  type CategoryIconV2Name,
} from "@/components/icons/category-icons-v2";

/**
 * Category List Card — visual port of Paper "Category 400 List-varaints"
 * (`EBD-0`). A compact 400×82 browse row: a 130×80 photo hero with a 36×36
 * category icon badge, then title (category tint) · "yoTrippin Verified ★"
 * rating · green-dot status line · amber "Details →" link.
 *
 * Category-parameterized — the 9 variants are just the `category` prop. Title
 * and icon badge read the canonical `--cat-{cat}-{title|badge-bg|badge-border}`
 * tokens. (The board only shows the scenic variant, where badge-* and cta-*
 * are identical; badge-* is used here since the row has no CTA button.)
 *
 * Static / presentational — onOpen is a stubbed no-op pending the wiring pass.
 */

// TODO: wire — the Details action opens the detail panel in a later pass.
const noop = () => {};

type Props = {
  /** Only the fields this row renders — any full BrowsePlace satisfies it. */
  place: Pick<
    BrowsePlace,
    "title" | "photoUrl" | "photoAlt" | "rating" | "reviewCount"
  >;
  category: BrowseCardCategory;
  /** Status line, e.g. "Open · 6a–10p". Omit to hide the row. */
  status?: string;
  /** "yoTrippin Verified" provenance line. Default true (per the board). */
  verified?: boolean;
  onOpen?: (e?: React.MouseEvent) => void;
  /** When present, renders a small remove (✕) control top-right. Corridor
   *  passes this only for waypoint-backed tiles — suggestions stay
   *  read-only (Phase 3 editing model). */
  onRemove?: () => void;
  /** Manual-edit mode. When true, the card grows 400->440 and shows an
   *  inert drag handle in a 40px right lane (same convention as the rail).
   *  Off by default. */
  editMode?: boolean;
};

/** Compact a review count: 9300 → "9.3k", 5000 → "5k", 881 → "881". */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

export function CategoryListCard({
  place,
  category,
  status,
  verified = true,
  onOpen,
  onRemove,
  editMode = false,
}: Props) {
  const badgeBg = `var(--cat-${category}-badge-bg)`;
  const badgeBorder = `var(--cat-${category}-badge-border)`;

  return (
    <div
      onClick={onOpen}
      className="relative flex items-start overflow-clip rounded-md"
      style={{ width: editMode ? 440 : 400, gap: 13, backgroundColor: "var(--bg-card)" }}
    >
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${place.title} from day`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute flex items-center justify-center"
          style={{
            top: 2,
            right: 2,
            width: 24,
            height: 24,
            color: "var(--text-muted)",
          }}
        >
          <RemoveX />
        </button>
      )}
      {/* Hero — photo (category-color fallback) + icon badge. */}
      <div
        role="img"
        aria-label={place.photoAlt}
        className="relative shrink-0"
        style={{
          width: 130,
          height: 80,
          backgroundColor: badgeBg,
          backgroundImage: place.photoUrl ? `url(${place.photoUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Top scrim so the badge reads over bright photos (oklab gradient in
         *  the board, approximated in sRGB). */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: "linear-gradient(to bottom, #00000066, transparent 60%)",
          }}
        />
        <span
          className="absolute flex items-center justify-center"
          style={{
            left: 5,
            top: 4,
            width: 36,
            height: 36,
            borderRadius: 6,
            backgroundColor: badgeBg,
            border: `0.5px solid ${badgeBorder}`,
            boxShadow: "0 2px 3px #00000066",
          }}
        >
          <CategoryIconV2 category={category as CategoryIconV2Name} size={22} />
        </span>
      </div>

      {/* Content — title / verified / status + Details. */}
      <div
        className="flex flex-col min-w-0"
        style={{ width: 244, gap: 2, paddingTop: 4 }}
      >
        <h3
          className="line-clamp-1"
          style={{
            color: `var(--cat-${category}-title)`,
            fontFamily: "var(--ff-display-condensed)",
            fontWeight: 700,
            fontStretch: "condensed",
            fontSize: 22,
            lineHeight: "23px",
            letterSpacing: "0.005em",
          }}
        >
          {place.title}
        </h3>

        <VerifiedMeta
          show={verified}
          rating={place.rating}
          reviewCount={place.reviewCount}
        />

        <div className="flex items-start justify-between" style={{ gap: 8 }}>
          {status ? (
            <div className="flex items-start min-w-0" style={{ gap: 7 }}>
              <span
                aria-hidden
                className="shrink-0 rounded-full"
                style={{ width: 6, height: 6, marginTop: 5, backgroundColor: "#6BE26F" }}
              />
              {/* Full note — wraps so the inline context reads (gold shows it in
                 full: "fine for GX470, not RVs", "cinnamon buns worth the stop").
                 Short browse statuses ("Open · 6a–10p") stay one line. */}
              <span
                style={{
                  color: "#A8B0B6",
                  fontFamily: "var(--ff-display)",
                  fontSize: 14,
                  lineHeight: "16px",
                }}
              >
                {status}
              </span>
            </div>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (onOpen ?? noop)(e);
            }}
            className="flex items-center shrink-0"
            style={{
              gap: 4,
              color: "var(--amber)",
              fontFamily: "var(--ff-display)",
              fontSize: 14,
              lineHeight: "18px",
            }}
          >
            Details
            <ArrowOut />
          </button>
        </div>
      </div>

      {/* Drag handle lane — edit mode only. Inert (no drag wired). Same
       *  dotted GripVertical + muted styling as the rail day cards. */}
      {editMode && (
        <div
          aria-hidden
          className="flex items-center justify-center shrink-0 self-stretch"
          style={{ width: 40 }}
        >
          <GripVertical
            size={18}
            strokeWidth={1.75}
            style={{ color: "var(--text-muted)" }}
          />
        </div>
      )}
    </div>
  );
}

/** "yoTrippin Verified ★ 4.7 (9.3k)" — star + rating only when a real rating
 *  is present; the count only when present. */
function VerifiedMeta({
  show,
  rating,
  reviewCount,
}: {
  show: boolean;
  rating?: number;
  reviewCount?: number;
}) {
  if (!show && rating === undefined) return null;
  const monoBase = {
    fontFamily: "var(--ff-mono)",
    letterSpacing: "0.04em",
  } as const;
  return (
    <div className="flex items-center" style={{ gap: 4, height: 20 }}>
      {show && (
        <span
          className="shrink-0"
          style={{ ...monoBase, color: "var(--type-300)", fontSize: 12, lineHeight: "16px" }}
        >
          yoTrippin Verified
        </span>
      )}
      {rating !== undefined && (
        <>
          <StarIcon />
          <span
            className="shrink-0"
            style={{ ...monoBase, color: "var(--type-300)", fontSize: 12, lineHeight: "16px" }}
          >
            {rating.toFixed(1)}
          </span>
          {reviewCount !== undefined && (
            <span
              className="shrink-0"
              style={{ ...monoBase, color: "var(--text-muted)", fontSize: 11, lineHeight: "14px" }}
            >
              ({formatCount(reviewCount)})
            </span>
          )}
        </>
      )}
    </div>
  );
}

function StarIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      className="shrink-0"
      style={{ overflow: "visible" }}
      fill="var(--amber-dark)"
    >
      <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
    </svg>
  );
}

/** Small ✕ for the waypoint-tile remove control. */
function RemoveX() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

/** Arrow-out (↗, rotated 45°) — matches the board's Details affordance. */
function ArrowOut() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      className="shrink-0"
      style={{ overflow: "visible", rotate: "45deg" }}
      fill="none"
      stroke="var(--text-primary)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
