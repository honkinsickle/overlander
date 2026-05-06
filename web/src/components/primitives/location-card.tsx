"use client";

import * as React from "react";
import { Plus, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryStyle, type Category } from "./detail-card";

const CATEGORY_EMOJI: Record<Category, string> = {
  fuel: "⛽",
  camping: "⛺",
  mountain: "🏔️",
  urban: "🏙️",
  food: "🍔",
  oddity: "👁️",
  attraction: "⭐",
  neutral: "📍",
};

export type LocationCardProps = {
  category: Category;
  title: string;
  /** Photo URL for the hero zone. */
  photoUrl?: string;
  /** Y-offset (px) applied to the photo for compositional cropping. Negative pulls up. */
  photoOffsetY?: number;
  /** Override the category badge emoji. Defaults from CATEGORY_EMOJI. */
  emoji?: string;
  /** Override the title color. Defaults to `cat.accent`. Paper drift means
   *  variants don't always match their category accent — pass through when
   *  it diverges. */
  titleColor?: string;
  /** Override the category badge background. Defaults to `cat.bg`. */
  badgeBg?: string;
  /** Override the category badge border. Defaults to `cat.accent`. */
  badgeBorder?: string;
  /** Override the CTA background. Defaults to `cat.bg`. */
  ctaBg?: string;
  /** Override the CTA border. Defaults to `cat.accent`. */
  ctaBorder?: string;
  /** Top-left chip — typically `Day 14 / 0.4 mi on route`. */
  dayTag: string;
  /** Top-right affordance — defaults to `Details ↗`. */
  openLabel?: string;
  /** Reliability dial. */
  reliability: { score: number; label: string };
  /** Cost zone — `primary | secondary` above the hero. `primary` optional
   *  for variants like Hotel that show only one cell. */
  cost: {
    primary?: string;
    secondary: string;
    hero: string;
    eta: React.ReactNode;
  };
  /** Trust zone — star + value + count. */
  rating: { value: string; count: string };
  /** CTA copy + handler. */
  ctaLabel: string;
  onCtaClick?: () => void;
  onOpenClick?: () => void;
  className?: string;
};

/**
 * Compact 300×500 browse card — Paper canonical `1E4C-0` (Food).
 * Drives variant tint from `category`; structure is shared across Food,
 * Park (Mountain), Fuel, Camping, Hotel (Urban), etc.
 */
export function LocationCard({
  category,
  title,
  photoUrl,
  photoOffsetY = -19,
  emoji,
  titleColor,
  badgeBg,
  badgeBorder,
  ctaBg,
  ctaBorder,
  dayTag,
  openLabel = "Details",
  reliability,
  cost,
  rating,
  ctaLabel,
  onCtaClick,
  onOpenClick,
  className,
}: LocationCardProps) {
  const cat = categoryStyle[category];
  const badgeEmoji = emoji ?? CATEGORY_EMOJI[category];

  return (
    <article
      className={cn("flex flex-col overflow-clip", className)}
      style={{
        width: 300,
        height: 500,
        backgroundColor: "#1A1A1A",
        border: "1px solid rgba(255,255,255,0.07)",
        fontSize: 12,
        lineHeight: "16px",
      }}
    >
      {/* Photo zone */}
      <div
        className="relative flex flex-col justify-between flex-shrink-0 overflow-clip"
        style={{ width: 300, height: 210, padding: 14 }}
      >
        {/* Radial-gradient base + photo */}
        <div
          className="absolute inset-0 overflow-clip"
          style={{
            backgroundImage:
              "radial-gradient(circle farthest-corner at 30% 40% in oklab, oklab(63.8% 0.071 0.114) 0%, oklab(31.3% 0.044 0.039) 60%, oklab(17.9% 0.017 0.014) 100%)",
          }}
        >
          {photoUrl && (
            <div
              style={{
                position: "absolute",
                top: photoOffsetY,
                left: 0,
                width: 300,
                height: 300,
                backgroundImage: `url(${photoUrl})`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }}
            />
          )}
        </div>
        {/* Top + bottom gradients to lift the chips and seam the body */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: 0,
            height: 80,
            backgroundImage:
              "linear-gradient(in oklab 180deg, oklab(14.9% -0.001 -0.003 / 65%) 0%, oklab(14.9% -0.001 -0.003 / 0%) 100%)",
          }}
        />
        <div
          className="absolute left-0 right-0"
          style={{
            bottom: -1,
            height: 60,
            backgroundImage:
              "linear-gradient(in oklab 0deg, oklab(17.2% -0.001 -0.002 / 96%) 0%, oklab(17.2% -0.001 -0.002 / 0%) 100%)",
          }}
        />

        {/* Photo header — Day Tag + Open affordance */}
        <div className="relative flex items-start justify-between self-stretch" style={{ gap: 8 }}>
          <span
            className="font-display"
            style={{
              backgroundColor: "rgba(41,36,36,0.85)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 4,
              padding: "4px 10px",
              color: "var(--amber, #C8A96E)",
              fontSize: 10,
              fontWeight: 500,
              lineHeight: "12px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            {dayTag}
          </span>
          <button
            type="button"
            onClick={onOpenClick}
            className="font-display inline-flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: "#0C6741",
              border: "1px solid rgba(80,180,82,0.5)",
              borderRadius: 4,
              padding: "4px 8px 4px 10px",
              gap: 6,
              color: "#FFFFFF",
              fontSize: 10,
              fontWeight: 500,
              lineHeight: "12px",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              cursor: onOpenClick ? "pointer" : "default",
            }}
          >
            {openLabel}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ECEAE4"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ rotate: "47deg", flexShrink: 0 }}
              aria-hidden
            >
              <path d="M7 17 17 7" />
              <path d="M8 7h9v9" />
            </svg>
          </button>
        </div>

        {/* Category badge — emoji on tinted chip */}
        <div
          className="relative flex items-center justify-center flex-shrink-0"
          style={{
            width: 36,
            height: 36,
            backgroundColor: badgeBg ?? cat.bg,
            border: `0.5px solid ${badgeBorder ?? cat.accent}`,
            borderRadius: 4,
            boxShadow: "0 2px 3px rgba(0,0,0,0.2)",
          }}
        >
          <span
            aria-hidden
            style={{
              fontFamily: "system-ui, sans-serif",
              fontSize: 23,
              lineHeight: "28px",
              textShadow: "0 2px 3px rgba(0,0,0,0.2)",
            }}
          >
            {badgeEmoji}
          </span>
        </div>
      </div>

      {/* Body */}
      <div
        className="relative flex flex-col flex-shrink-0"
        style={{
          height: 275,
          paddingTop: 12,
          paddingRight: 20,
          paddingBottom: 22,
          paddingLeft: 13,
          gap: 7,
        }}
      >
        {/* Identity zone — title + reliability */}
        <div className="flex flex-col" style={{ gap: 6 }}>
          <h3
            style={{
              color: titleColor ?? cat.accent,
              fontFamily: "var(--font-barlow-condensed), \"Barlow Condensed\", system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 24,
              lineHeight: "22px",
              letterSpacing: 0,
              margin: 0,
            }}
          >
            {title.trim()}
          </h3>
          <div className="flex items-center" style={{ gap: 7 }}>
            <span
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{
                width: 28,
                height: 28,
                backgroundColor: "rgba(255,255,255,0.07)",
                borderRadius: 4,
                color: "var(--amber-dark, #C77429)",
                fontFamily: "var(--ff-mono), monospace",
                fontWeight: 700,
                fontSize: 12,
                lineHeight: "16px",
              }}
            >
              {reliability.score}
            </span>
            <span
              className="font-display"
              style={{
                color: "var(--amber-dark, #C77429)",
                fontSize: 12,
                lineHeight: "16px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}
            >
              {reliability.label}
            </span>
          </div>
        </div>

        {/* Cost zone */}
        <div className="flex flex-col" style={{ gap: 6 }}>
          <div className="flex flex-col items-start" style={{ gap: 5 }}>
            <div className="flex items-baseline" style={{ gap: 2, paddingRight: 16 }}>
              {cost.primary && (
                <>
                  <span
                    style={{
                      color: "#C8A96E",
                      fontFamily: "var(--ff-sans), system-ui, sans-serif",
                      fontSize: 13,
                      lineHeight: "16px",
                      textTransform: "capitalize",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {cost.primary}
                  </span>
                  <span
                    className="font-display"
                    style={{
                      color: "#86897E",
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: "16px",
                      letterSpacing: "0.06em",
                      flexShrink: 0,
                      paddingInline: 4,
                    }}
                  >
                    |
                  </span>
                </>
              )}
              <span
                style={{
                  color: "#C8A96E",
                  fontFamily: "var(--ff-sans), system-ui, sans-serif",
                  fontSize: 13,
                  lineHeight: "16px",
                  flexShrink: 0,
                }}
              >
                {cost.secondary}
              </span>
            </div>
            <div className="flex flex-col items-start" style={{ gap: 1 }}>
              <span
                className="font-display"
                style={{
                  color: "#CFCECE",
                  fontSize: 20,
                  fontWeight: 700,
                  lineHeight: "24px",
                  letterSpacing: 0,
                }}
              >
                {cost.hero}
              </span>
              <span
                className="font-display"
                style={{
                  color: "#98AC64",
                  fontSize: 13,
                  lineHeight: "18px",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  whiteSpace: "pre-wrap",
                }}
              >
                {cost.eta}
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div
          className="flex-shrink-0"
          style={{ height: 1, backgroundColor: "rgba(255,255,255,0.07)" }}
        />

        {/* Trust zone — star + rating */}
        <div
          className="flex items-center justify-between"
          style={{ paddingTop: 3, paddingBottom: 12 }}
        >
          <div className="flex items-center" style={{ gap: 8 }}>
            <Star
              width={12}
              height={12}
              fill="var(--amber-dark, #C77429)"
              stroke="none"
              style={{ flexShrink: 0 }}
              aria-hidden
            />
            <span
              className="font-display"
              style={{ color: "#ECEAE4", fontSize: 12, lineHeight: "16px", letterSpacing: "0.04em" }}
            >
              {rating.value}
            </span>
            <span
              className="font-display"
              style={{ color: "var(--text-muted, #888888)", fontSize: 11, lineHeight: "14px", letterSpacing: "0.04em" }}
            >
              {rating.count}
            </span>
          </div>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onCtaClick}
          className="absolute font-display inline-flex items-center justify-center"
          style={{
            left: "50%",
            transform: "translateX(-50%)",
            top: 221,
            width: 215,
            padding: "11px 14px",
            gap: 8,
            backgroundColor: ctaBg ?? cat.bg,
            border: `1px solid ${ctaBorder ?? cat.accent}`,
            borderRadius: 4,
            color: "#ECEAE4",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: "16px",
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            cursor: onCtaClick ? "pointer" : "default",
          }}
        >
          <Plus width={12} height={12} stroke="#ECEAE4" strokeWidth={2} aria-hidden style={{ flexShrink: 0 }} />
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}
