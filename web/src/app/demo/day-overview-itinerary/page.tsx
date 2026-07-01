import {
  DayDetailOverview,
  type OverviewGuide,
  type OverviewPlace,
} from "@/components/trip/day-detail-overview";

/**
 * THROWAWAY scratch route — prototype of the stacked day-detail column:
 * DayDetailOverview (hero → Guides → Top Places) ABOVE a STATIC single-day
 * ITINERARY stand-in, sharing ONE page scroll at the 478px column width.
 *
 * The itinerary portion is a hardcoded VISUAL MOCK — production DayDetail is
 * stateful (all-days, server actions, DnD, own scroll), so it is NOT mounted
 * here. This is only to eyeball the seam + header treatment before touching
 * production. NO production component is modified. Drop before merge.
 *
 * Shared-scroll trick: the column is not height-capped, so DayDetailOverview's
 * baked-in h-full/overflow collapse to content-height and the PAGE scrolls.
 *
 * Anchors: #overview / #guides / #places (inside DayDetailOverview) + #itinerary.
 */

const CDN = "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";

const GUIDES: OverviewGuide[] = [
  {
    title: "Foodies Guide to the Coast",
    description: "Delectable stops — find breakfast, lunch and dinner along the way.",
    byline: "yoTrippin staff",
    imageUrl: `${CDN}/01KV6GTWMQCVFS0ZJXB6TBED9B.png`,
  },
  {
    title: "Places not to miss on-route.",
    description: "Recommendations from like-minded yoTrippin staff.",
    byline: "yoTrippin staff",
    imageUrl: `${CDN}/5ZBSPM9YYA57R1ENM5ZKSJ4R88.jpg`,
  },
];

const PLACES: OverviewPlace[] = [
  {
    category: "food",
    title: "Tartine Bakery",
    description: "Morning pastries and country bread worth the line and the detour.",
    photoAlt: "Bakery display case",
    photoUrl: `${CDN}/3SSAFY1NAPNFE83MH7S3EVXCY4.jpg`,
    rating: 4.9,
    reviewCount: 12200,
    detour: { miles: 6, minutes: 12 },
  },
  {
    category: "urban",
    title: "Pike Place Market",
    description: "Historic public market — chowder, flowers, and the first Starbucks.",
    photoAlt: "Woman on dock",
    photoUrl: `${CDN}/51F3SVN9CW0XQ0J86VC8PP8KTP.jpg`,
    rating: 4.9,
    reviewCount: 12200,
    detour: { miles: 6, minutes: 12 },
  },
  {
    category: "scenic",
    title: "Bixby Creek Bridge",
    description:
      "Iconic span over the Pacific — pull off at the north vista for the classic late-afternoon shot.",
    photoAlt: "Mountain bridge",
    photoUrl: `${CDN}/14WWQ8JJ5B49PQRZS6W7067PJ5.avif`,
    rating: 4.9,
    reviewCount: 12200,
    detour: { miles: 6, minutes: 12 },
  },
];

/**
 * SectionBanner clone. `day-detail-overview.tsx`'s SectionBanner is a local
 * (non-exported) function, so it's replicated here verbatim so the ITINERARY
 * band can be shown in the SAME treatment as Guides / Top Places.
 */
function SectionBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      className="flex flex-col justify-center shrink-0"
      style={{
        height: 64,
        padding: "12px 2px 16px 17px",
        gap: 1,
        borderRadius: 2,
        backgroundColor: "var(--steel-800)",
        boxShadow: "0 2px 3px rgba(0,0,0,0.15)",
      }}
    >
      <span style={{ color: "var(--text-primary)", fontFamily: "var(--ff-sans)", fontWeight: 500, fontSize: 20, lineHeight: "28px" }}>
        {title}
      </span>
      <span style={{ color: "var(--type-300)", fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "14px", letterSpacing: "0.02em" }}>
        {subtitle}
      </span>
    </div>
  );
}

/**
 * COMMENTED ALTERNATE — production's Itinerary band style (from day-detail.tsx).
 * Swap this in place of <SectionBanner title="Itinerary" .../> below to compare
 * the two header treatments in the single column.
 *
 * function ProdItineraryBand() {
 *   return (
 *     <div
 *       className="uppercase"
 *       style={{
 *         backgroundColor: "var(--bg-card)",
 *         fontFamily: "var(--ff-display)",
 *         fontSize: 16,
 *         lineHeight: "24px",
 *         fontWeight: 600,
 *         letterSpacing: "0.19em",
 *         color: "var(--amber-light)",
 *         paddingInline: 17,
 *         paddingBlock: 6,
 *       }}
 *     >
 *       Itinerary
 *     </div>
 *   );
 * }
 */

export default function DayOverviewItineraryDemo() {
  return (
    <main className="flex min-h-screen" style={{ backgroundColor: "var(--bg-map)" }}>
      {/* Single stacked column, 478px. No height cap → page is the one scroll. */}
      <div style={{ width: "var(--rail-column-w)", backgroundColor: "var(--bg-base)" }}>
        {/* Overview — #overview / #guides / #places live inside it. */}
        <DayDetailOverview
          routeLabel="Los Angeles, CA → Portland, OR"
          heroImageUrl={`${CDN}/3QYT8N00ZJVQPDYZQS725QNH9M.avif`}
          heroAlt="Los Angeles to Portland"
          guidesSubtitle="Created by the yoTrippin Staff: Los Angeles,CA - Portland, OR"
          guides={GUIDES}
          placesSubtitle="Across your full route: Los Angeles,CA - Portland, OR"
          places={PLACES}
          dayNumber={2}
        />

        {/* ── ITINERARY (static single-day stand-in) ────────────────────── */}
        <section id="itinerary" className="flex flex-col items-center">
          {/* Visible header-style flag (prototype-only chrome). */}
          <div
            style={{
              width: "var(--rail-card-w)",
              margin: "12px 0",
              padding: "6px 10px",
              border: "1px dashed var(--amber)",
              borderRadius: 4,
              color: "var(--amber)",
              fontFamily: "var(--ff-mono)",
              fontSize: 11,
              lineHeight: "15px",
            }}
          >
            ⚠ PROTOTYPE — ITINERARY header shown in the SectionBanner treatment
            (matches Guides / Top Places). Production uses a different
            uppercase-amber band; see ProdItineraryBand comment to compare.
          </div>

          {/* Content column — 462px, same 8px gutter as the Overview sections. */}
          <div style={{ width: "var(--rail-card-w)" }} className="flex flex-col">
            {/* ITINERARY band — SectionBanner treatment (chosen for cohesion). */}
            <SectionBanner title="Itinerary" subtitle="Los Angeles, CA → Littlefield, AZ" />

            {/* Day header + route sub-label. */}
            <div className="flex flex-col" style={{ paddingInline: 15, paddingTop: 14, gap: 2 }}>
              <span
                style={{
                  fontFamily: "var(--ff-display-condensed)",
                  fontWeight: 700,
                  fontStretch: "condensed",
                  fontSize: 22,
                  lineHeight: "25px",
                  color: "var(--text-primary)",
                }}
              >
                Day 1 — Fri, Jun 12
              </span>
              <span style={{ fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "18px", color: "var(--type-300)" }}>
                Los Angeles, CA — Littlefield, AZ
              </span>
            </div>

            {/* Day hero image. */}
            <div className="flex justify-center" style={{ paddingTop: 14, paddingInline: 15 }}>
              <div
                role="img"
                aria-label="Day 1 hero"
                style={{
                  width: "100%",
                  height: 180,
                  borderRadius: 3,
                  border: "1px solid var(--border-subtle)",
                  backgroundImage: `url(${CDN}/3QYT8N00ZJVQPDYZQS725QNH9M.avif)`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            </div>

            {/* 📍 WAYPOINTS sub-label. */}
            <div
              className="uppercase"
              style={{
                fontFamily: "var(--ff-mono)",
                fontSize: 13,
                lineHeight: "18px",
                letterSpacing: "0.14em",
                color: "var(--text-muted)",
                paddingInline: 15,
                paddingTop: 16,
                paddingBottom: 8,
              }}
            >
              📍 Waypoints
            </div>

            {/* One waypoint card — Shell · fuel · Google. */}
            <div
              className="flex items-center"
              style={{
                gap: 12,
                marginInline: 15,
                padding: 10,
                borderRadius: 6,
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div
                className="flex items-center justify-center shrink-0"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  backgroundColor: "var(--cat-fuel-cta-bg)",
                  border: "0.5px solid var(--cat-fuel-cta-border)",
                  fontSize: 18,
                }}
              >
                ⛽
              </div>
              <div className="flex flex-col" style={{ gap: 2 }}>
                <span style={{ fontFamily: "var(--ff-sans)", fontWeight: 600, fontSize: 15, lineHeight: "20px", color: "var(--cat-fuel-title)" }}>
                  Shell
                </span>
                <span style={{ fontFamily: "var(--ff-mono)", fontSize: 12, lineHeight: "16px", letterSpacing: "0.04em", color: "var(--text-muted)" }}>
                  fuel · Google
                </span>
              </div>
            </div>

            {/* Add Waypoints CTA (static). */}
            <div style={{ padding: 15 }}>
              <button
                type="button"
                className="w-full"
                style={{
                  height: 44,
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-card)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--ff-sans)",
                  fontSize: 14,
                }}
              >
                Add Waypoints
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
