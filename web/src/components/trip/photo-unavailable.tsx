import { Image as ImageIcon } from "lucide-react";

/**
 * Shared photoless fallback. Renders as absolute-inset layers that fill a
 * `position: relative` parent of any size — the STOPS card hero (130×80), the
 * day hero (~462×148), and the trip-overview hero (212 tall) all use it. One
 * shared, non-category-specific asset (`/photo-unavailable-bg.svg`): a blurred
 * generic outdoor placeholder + a legibility scrim + a centered lucide `Image`
 * glyph and "Photo Unavailable" caption.
 *
 * `iconSize` / `captionSize` let a larger hero scale the glyph + caption up
 * (defaults match the compact STOPS card). The rgba scrim / text-shadow are
 * over-image legibility washes (same use as the surrounding photo scrims), not
 * themeable colors, so they stay raw rather than tokenized.
 *
 * Introduced in the CategoryListCard fallback (PR #338); extracted here so the
 * day/overview hero fallback reuses the identical treatment instead of a copy.
 */
export function PhotoUnavailable({
  iconSize = 24,
  captionSize = "var(--text-2xs)",
}: {
  iconSize?: number;
  captionSize?: string;
}) {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundColor: "var(--bg-base)",
          backgroundImage: "url(/photo-unavailable-bg.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(5px)",
          transform: "scale(1.15)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "linear-gradient(to bottom, #00000040, #0000006e)" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ gap: 4, color: "var(--text-primary)" }}
      >
        <ImageIcon size={iconSize} strokeWidth={1.5} />
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontSize: captionSize,
            lineHeight: 1.2,
            letterSpacing: "0.02em",
            textShadow: "0 1px 2px rgba(0,0,0,0.6)",
          }}
        >
          Photo Unavailable
        </span>
      </div>
    </>
  );
}
