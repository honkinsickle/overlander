import type { Day } from "@/lib/trips/types";

/**
 * Day Detail Hero — Paper G85-0 / GDM-0.
 *
 * From `get_computed_styles`:
 *   Hero (GDM-0):  404×175 · radius 6 · overflow clip · oklab gradient
 *   Scrim (GDN-0): absolute inset-0 · linear-gradient 180deg
 *                  rgba(0,0,0,0) 40% → rgba(0,0,0,0.65) 100%
 *   Caption (GDO-0): abs bottom 10 · left 14 · Space Mono 400 · 8/12
 *                    · letter-spacing 2px · uppercase · rgba(255,255,255,0.75)
 *   Tag (GDP-0):     abs bottom 10 · right 14 · Space Mono 400 · 8/12
 *                    · letter-spacing 2px · uppercase · --amber
 *
 * Background precedence: heroImage URL → heroGradient → neutral fallback.
 *
 * Target viewport is iPad Mini landscape (1133×744) where 8px text
 * renders cleanly. Desktop dev views at non-native zoom may trigger
 * browser minimum-font-size clamps — that's a viewing artifact, not a
 * spec error.
 */
export function DayDetailHero({ day }: { day: Day }) {
  const background = day.heroImage
    ? `url(${JSON.stringify(day.heroImage)}) center/cover no-repeat`
    : (day.heroGradient ??
        "linear-gradient(135deg, #1e1f22 0%, #2a2c30 100%)");

  return (
    <div
      className="relative w-[404px] h-[175px] rounded-[6px] overflow-clip shrink-0"
      style={{ background }}
    >
      {/* Scrim — full inset, 40% stop */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.65) 100%)",
        }}
      />
      {day.heroCaption && (
        <span
          className="absolute bottom-[10px] left-[14px] font-mono text-[8px] leading-[12px] uppercase"
          style={{
            letterSpacing: "2px",
            color: "rgba(255,255,255,0.75)",
          }}
        >
          {day.heroCaption}
        </span>
      )}
      {day.heroTag && (
        <span
          className="absolute bottom-[10px] right-[14px] font-mono text-[8px] leading-[12px] uppercase"
          style={{
            letterSpacing: "2px",
            color: "var(--amber)",
          }}
        >
          {day.heroTag}
        </span>
      )}
    </div>
  );
}
