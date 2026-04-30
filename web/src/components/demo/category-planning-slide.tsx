"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Category Planning Slide — TEST canonical (660×544 peek, frosted-glass sheet, labeled CTA pill).
// Mirrors Paper artboards WBU-1 / UTE-1 / W0C-1 / WFW-1 / WJL-1.

const SLIDE_HEIGHT = 544;
const SHEET_TOP_COLLAPSED = 230;
const SHEET_TOP_EXPANDED = 30;
const CTA_CLEARANCE = 80;

const CATEGORY_ACCENT: Record<CategoryKey, string> = {
  oddity: "#D8B4FE",
  food: "#FDBA74",
  scenic: "#2AB5FF",
  camping: "#6ECECE",
  overnight: "#6ECECE",
};

const SHEET_BG = "rgba(39, 35, 32, 0.9)";
const HEADER_BG = "#191816CC";
const BODY_TEXT = "#C8B8AD";
const TITLE_TEXT = "#F4EBE1";
const MUTED = "#A8988D";
const SECTION_LABEL = "#98AC65";
const SECTION_SUBLABEL = "#6F6862";
const DIVIDER = "#4F4E4C";
const PULLQUOTE_BAR = "#C4763B";
const STATUS_PILL_BG = "#C66155";
const CTA_BG = "#915513";
const CTA_BORDER = "#EF8B23";
const TMOBILE_MAGENTA = "#E20074";
const STAR_AMBER = "#C9A268";
const LIVE_GREEN = "#6CB37A";

const ff = {
  sans: "var(--font-barlow), system-ui, sans-serif",
  display: "var(--font-space-grotesk), system-ui, sans-serif",
  mono: "var(--font-space-mono), monospace",
  serif: "var(--font-crimson-text), Georgia, serif",
};

export type CategoryKey = "oddity" | "food" | "scenic" | "camping" | "overnight";

export interface Pill {
  label: string;
  status?: boolean; // true → solid coral status pill, otherwise outlined category pill
}

export interface PlanningSlideData {
  photoUrl: string;
  photoAlt: string;
  title: string;
  pills: Pill[];
  stats: Array<{ label: string; value: ReactNode }>;
  mention: { primary: string; secondary: string };
  description: string;
  pullquote: { text: string; name: string; meta: string };
  placeInfo: {
    address: string;
    phone?: { display: string; href: string };
    website?: { display: string; href: string };
  };
  cta: string;
}

// ── Public exports ──────────────────────────────────────────────────────────

export function CategoryPlanningSlide({
  category,
  data,
  expanded,
  bodyExtras,
}: {
  category: CategoryKey;
  data: PlanningSlideData;
  expanded: boolean;
  bodyExtras?: ReactNode;
}) {
  const accent = CATEGORY_ACCENT[category];
  return (
    <div
      style={{
        position: "relative",
        width: 660,
        height: SLIDE_HEIGHT,
        borderRadius: 8,
        overflow: "clip",
        backgroundImage:
          "linear-gradient(180deg, oklab(20.8% 0.010 0.007) 0%, oklab(25% 0.012 0.019) 100%)",
        fontFamily: ff.sans,
      }}
    >
      <Photo url={data.photoUrl} alt={data.photoAlt} />
      <Sheet expanded={expanded} accent={accent} data={data} bodyExtras={bodyExtras} />
      <CtaPill copy={data.cta} />
    </div>
  );
}

export function ExpandTrigger({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        paddingBlock: 12,
        paddingInline: 20,
        borderRadius: 9999,
        border: "1px solid rgba(244,235,225,0.18)",
        backgroundColor: "rgba(244,235,225,0.04)",
        color: TITLE_TEXT,
        fontFamily: ff.display,
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      <Chevron up={expanded} />
      {expanded ? "Collapse" : "Expand"}
    </button>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: up ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 240ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
      aria-hidden
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

// ── Sheet + scroll mechanics ────────────────────────────────────────────────

function Photo({ url, alt }: { url: string; alt: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      aria-label={alt}
    />
  );
}

function Sheet({
  expanded,
  accent,
  data,
  bodyExtras,
}: {
  expanded: boolean;
  accent: string;
  data: PlanningSlideData;
  bodyExtras?: ReactNode;
}) {
  const top = expanded ? SHEET_TOP_EXPANDED : SHEET_TOP_COLLAPSED;
  const sheetHeight = SLIDE_HEIGHT - top;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });

  const sync = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScroll({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
  };

  useEffect(() => {
    sync();
  }, [expanded]);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        left: -2,
        top,
        width: 662,
        height: sheetHeight,
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        overflow: "clip",
        backgroundColor: SHEET_BG,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        paddingTop: 14,
        boxShadow: "0 -2px 20px #0000008C, 0 -1px 0 #F4EBE114",
        transition:
          "top 320ms cubic-bezier(0.32, 0.72, 0, 1), height 320ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      <GrabberBar />
      <Grabber />
      <Header accent={accent} title={data.title} pills={data.pills} />
      <ScrollRegion scrollRef={scrollRef} onScroll={sync}>
        <Body accent={accent} data={data} bodyExtras={bodyExtras} />
      </ScrollRegion>
      <ScrollNub scroll={scroll} sheetHeight={sheetHeight} />
    </section>
  );
}

function ScrollRegion({
  scrollRef,
  onScroll,
  children,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <style>{`.cps-scroll::-webkit-scrollbar { display: none; }`}</style>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="cps-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          paddingBottom: CTA_CLEARANCE,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        {children}
      </div>
    </>
  );
}

function GrabberBar() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 14,
        backgroundColor: HEADER_BG,
      }}
    />
  );
}

function Grabber() {
  return (
    <div
      style={{
        position: "absolute",
        left: 295.5,
        top: 7,
        width: 71,
        height: 2,
        borderRadius: 999,
        backgroundColor: "#DDDDDDDE",
      }}
    />
  );
}

function ScrollNub({
  scroll,
  sheetHeight,
}: {
  scroll: { scrollTop: number; scrollHeight: number; clientHeight: number };
  sheetHeight: number;
}) {
  const { scrollTop, scrollHeight, clientHeight } = scroll;
  const maxScroll = scrollHeight - clientHeight;
  if (maxScroll <= 0 || clientHeight === 0) return null;

  const trackTop = 116;
  const trackBottom = sheetHeight - 16;
  const trackHeight = trackBottom - trackTop;
  const ratio = clientHeight / scrollHeight;
  const thumbHeight = Math.max(24, Math.round(trackHeight * ratio));
  const thumbRange = trackHeight - thumbHeight;
  const thumbTop = trackTop + Math.round(thumbRange * (scrollTop / maxScroll));

  return (
    <div
      style={{
        position: "absolute",
        right: 5,
        top: thumbTop,
        width: 2,
        height: thumbHeight,
        borderRadius: 999,
        backgroundColor: "rgba(244, 235, 225, 0.5)",
      }}
    />
  );
}

// ── Header + categories ─────────────────────────────────────────────────────

function Header({ accent, title, pills }: { accent: string; title: string; pills: Pill[] }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        width: 660,
        height: 92,
        paddingTop: 6,
        paddingRight: 24,
        paddingBottom: 0,
        paddingLeft: 24,
        backgroundColor: HEADER_BG,
        borderBottom: `1px solid ${DIVIDER}`,
        boxShadow: "0 2px 3px #00000033",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 497,
          height: 81,
          paddingBlock: 5,
          marginTop: -3,
        }}
      >
        <h1
          style={{
            fontFamily: ff.sans,
            fontWeight: 700,
            fontSize: 26,
            lineHeight: "34px",
            letterSpacing: "-0.01em",
            color: accent,
            margin: 0,
          }}
        >
          {title}
        </h1>
        <Categories pills={pills} accent={accent} />
      </div>
    </header>
  );
}

function Categories({ pills, accent }: { pills: Pill[]; accent: string }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
      {pills.map((pill) =>
        pill.status ? (
          <span
            key={pill.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              paddingBlock: 5,
              paddingInline: 12,
              borderRadius: 999,
              backgroundColor: STATUS_PILL_BG,
              color: "#F4EBE1",
              fontFamily: ff.sans,
              fontWeight: 600,
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            {pill.label}
          </span>
        ) : (
          <span
            key={pill.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              paddingBlock: 5,
              paddingInline: 10,
              borderRadius: 4,
              backgroundColor: `${accent}1F`,
              border: `1px solid ${accent}52`,
              color: accent,
              fontFamily: ff.sans,
              fontWeight: 400,
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            {pill.label}
          </span>
        ),
      )}
    </div>
  );
}

// ── Body sections ───────────────────────────────────────────────────────────

function Body({
  accent,
  data,
  bodyExtras,
}: {
  accent: string;
  data: PlanningSlideData;
  bodyExtras?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        width: 660,
        gap: 9,
        padding: 0,
      }}
    >
      <Stats stats={data.stats} />
      <Mention {...data.mention} />
      <Description text={data.description} />
      <Pullquote {...data.pullquote} />
      <Tabs accent={accent} />
      <PlaceInfo accent={accent} info={data.placeInfo} />
      {bodyExtras}
    </div>
  );
}

function Stats({ stats }: { stats: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        paddingTop: 3,
        paddingBottom: 2,
        paddingLeft: 24,
        paddingRight: 20,
        width: 660,
        height: 62,
        borderBottom: `1px solid ${DIVIDER}`,
      }}
    >
      {stats.map((s, i) => (
        <Stat
          key={s.label}
          label={s.label}
          first={i === 0}
          right={i < stats.length - 1}
        >
          {s.value}
        </Stat>
      ))}
    </div>
  );
}

function Stat({
  label,
  right,
  first,
  children,
}: {
  label: string;
  right: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        paddingRight: right ? 16 : 0,
        paddingLeft: first ? 0 : 16,
        height: "fit-content",
        borderRight: right ? `1px solid ${DIVIDER}` : "none",
      }}
    >
      <span
        style={{
          fontFamily: ff.display,
          fontWeight: 500,
          fontSize: 13,
          lineHeight: "16px",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: SECTION_LABEL,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

export const statValueStyle: React.CSSProperties = {
  fontFamily: ff.display,
  fontWeight: 400,
  fontSize: 18,
  color: TITLE_TEXT,
  letterSpacing: "0",
};

export function StatValue({ children }: { children: ReactNode }) {
  return <span style={statValueStyle}>{children}</span>;
}

export function StatSubText({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: ff.display, fontWeight: 400, fontSize: 13, color: MUTED }}>
      {children}
    </span>
  );
}

export function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={STAR_AMBER} aria-hidden>
      <path d="M12 2l2.939 6.91L22 9.927l-5.5 4.852L18.182 22 12 18.27 5.818 22 7.5 14.779 2 9.927l7.061-1.017L12 2z" />
    </svg>
  );
}

export function LiveDot() {
  return (
    <span
      style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: LIVE_GREEN }}
    />
  );
}

function Mention({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        paddingLeft: 24,
        paddingRight: 20,
        width: 660,
      }}
    >
      <span
        style={{
          fontFamily: ff.sans,
          fontWeight: 700,
          fontSize: 14,
          lineHeight: "18px",
          color: "#C5BFB9",
        }}
      >
        {primary}
      </span>
      <span
        style={{
          fontFamily: ff.mono,
          fontWeight: 400,
          fontSize: 14,
          lineHeight: "18px",
          color: MUTED,
        }}
      >
        {secondary}
      </span>
    </div>
  );
}

function Description({ text }: { text: string }) {
  return (
    <div style={{ paddingLeft: 24, paddingRight: 24, width: 660 }}>
      <p
        style={{
          fontFamily: ff.sans,
          fontWeight: 400,
          fontSize: 16,
          lineHeight: "24px",
          color: BODY_TEXT,
          margin: 0,
        }}
      >
        {text}
      </p>
    </div>
  );
}

function Pullquote({ text, name, meta }: { text: string; name: string; meta: string }) {
  return (
    <div
      style={{
        paddingLeft: 24,
        paddingRight: 24,
        width: 660,
        marginTop: 10,
        marginBottom: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", gap: 14 }}>
        <div
          style={{
            width: 2,
            alignSelf: "stretch",
            borderRadius: 2,
            backgroundColor: PULLQUOTE_BAR,
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: ff.serif,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 16,
              lineHeight: "22px",
              color: "#E8D8CC",
              margin: 0,
            }}
          >
            {text}
          </p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontFamily: ff.sans,
                fontWeight: 700,
                fontSize: 13,
                lineHeight: "16px",
                color: TITLE_TEXT,
              }}
            >
              {name}
            </span>
            <span style={{ fontFamily: ff.mono, fontSize: 13, color: "#6A5A52" }}>·</span>
            <span
              style={{
                fontFamily: ff.mono,
                fontWeight: 400,
                fontSize: 13,
                lineHeight: "16px",
                letterSpacing: "0.04em",
                color: "#8A7A70",
              }}
            >
              {meta}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tabs({ accent }: { accent: string }) {
  const tabs = [
    { key: "about", label: "About", active: true },
    { key: "booking", label: "Booking" },
    { key: "reviews", label: "Reviews" },
    { key: "photos", label: "Photos" },
    { key: "mentions", label: "Mentions" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 30,
        marginTop: 6,
        paddingInline: 24,
        width: 660,
        borderBottom: `1px solid ${DIVIDER}`,
      }}
    >
      {tabs.map((t) => (
        <div
          key={t.key}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 3,
            width: 97,
            height: 39,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "inline-block",
              paddingBottom: t.active ? 10 : 12,
              fontFamily: ff.sans,
              fontWeight: t.active ? 700 : 400,
              fontSize: 16,
              lineHeight: "24px",
              color: t.active ? accent : MUTED,
            }}
          >
            {t.label}
          </span>
          {t.active && (
            <div
              style={{
                height: 2,
                alignSelf: "stretch",
                backgroundColor: accent,
                flexShrink: 0,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PlaceInfo({
  accent,
  info,
}: {
  accent: string;
  info: PlanningSlideData["placeInfo"];
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 24,
        paddingInline: 24,
        paddingTop: 20,
        paddingBottom: 20,
        width: 660,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 0", minWidth: 0 }}>
        <Row>
          <PinIcon />
          <span style={infoTextStyle}>{info.address}</span>
        </Row>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: "1 1 0", minWidth: 0 }}>
        {info.phone && (
          <Row>
            <PhoneIcon />
            <a
              href={info.phone.href}
              style={{ ...infoTextStyle, color: accent, textDecoration: "none" }}
            >
              {info.phone.display}
            </a>
          </Row>
        )}
        {info.website && (
          <Row>
            <GlobeIcon />
            <a
              href={info.website.href}
              style={{
                ...infoTextStyle,
                color: accent,
                textDecoration: "none",
                wordBreak: "break-all",
              }}
            >
              {info.website.display}
            </a>
          </Row>
        )}
      </div>
    </div>
  );
}

const infoTextStyle: React.CSSProperties = {
  fontFamily: ff.sans,
  fontWeight: 400,
  fontSize: 14,
  lineHeight: "20px",
  color: BODY_TEXT,
};

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 14 }}>{children}</div>;
}

// ── Body extras (Camping-only) ──────────────────────────────────────────────

function BodySection({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 24,
        paddingBottom: 24,
        width: 660,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 24,
          right: 24,
          height: 1,
          backgroundColor: DIVIDER,
        }}
      />
      {children}
    </section>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: ff.display,
  fontWeight: 500,
  fontSize: 13,
  lineHeight: "16px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: SECTION_LABEL,
};

const sectionSubLabelStyle: React.CSSProperties = {
  fontFamily: ff.display,
  fontWeight: 500,
  fontSize: 11,
  lineHeight: "14px",
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  color: SECTION_SUBLABEL,
};

export function CampingConnectivity() {
  return (
    <BodySection>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={sectionLabelStyle}>CONNECTIVITY</span>
        <span style={sectionSubLabelStyle}>PRESENTED BY</span>
        <span
          style={{
            fontFamily: ff.sans,
            fontWeight: 700,
            fontSize: 12,
            lineHeight: "16px",
            color: "#FFFFFF",
            backgroundColor: TMOBILE_MAGENTA,
            paddingBlock: 2,
            paddingInline: 8,
            borderRadius: 4,
          }}
        >
          T·Mobile
        </span>
      </div>
      <p
        style={{
          fontFamily: ff.sans,
          fontWeight: 400,
          fontSize: 14,
          lineHeight: "20px",
          color: BODY_TEXT,
          margin: 0,
        }}
      >
        T-Mobile is introducing T-Satellite to extend coverage in the outdoors.
      </p>
      <div style={{ display: "flex", gap: 18 }}>
        <Carrier name="T-Mobile" verified={100} />
        <Carrier name="Verizon" verified={108} />
        <Carrier name="AT&T" verified={88} />
      </div>
    </BodySection>
  );
}

function Carrier({ name, verified }: { name: string; verified: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SignalBars />
        <span
          style={{
            fontFamily: ff.sans,
            fontWeight: 700,
            fontSize: 14,
            lineHeight: "18px",
            color: TITLE_TEXT,
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: ff.display,
            fontWeight: 500,
            fontSize: 10,
            lineHeight: "12px",
            letterSpacing: "0.04em",
            color: BODY_TEXT,
            border: `1px solid #2B2B2B`,
            paddingBlock: 1,
            paddingInline: 4,
            borderRadius: 3,
          }}
        >
          5G
        </span>
      </div>
      <span
        style={{
          fontFamily: ff.sans,
          fontWeight: 400,
          fontSize: 13,
          lineHeight: "18px",
          color: SECTION_LABEL,
        }}
      >
        Excellent Coverage
      </span>
      <span
        style={{
          fontFamily: ff.display,
          fontWeight: 400,
          fontSize: 11,
          lineHeight: "14px",
          color: MUTED,
        }}
      >
        Verified by {verified} users
      </span>
      <span
        style={{
          fontFamily: ff.display,
          fontWeight: 400,
          fontSize: 11,
          lineHeight: "14px",
          color: SECTION_SUBLABEL,
        }}
      >
        Last on 4/28/26
      </span>
    </div>
  );
}

function SignalBars() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <rect x="1" y="12" width="3" height="5" fill="#6ECECE" />
      <rect x="6" y="9" width="3" height="8" fill="#6ECECE" />
      <rect x="11" y="6" width="3" height="11" fill="#6ECECE" />
      <rect x="16" y="3" width="2" height="14" fill="#6ECECE" opacity="0.4" />
    </svg>
  );
}

export function CampingAccess() {
  return (
    <BodySection>
      <span style={sectionLabelStyle}>ACCESS</span>
      <div style={{ display: "flex", gap: 18 }}>
        <AccessItem icon={<CarIcon />} title="Drive-In" subtitle="Park next to your site" />
        <AccessItem
          icon={<FootprintsIcon />}
          title="Walk-In"
          subtitle="Park in a lot, walk to your site"
        />
      </div>
    </BodySection>
  );
}

function AccessItem({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flex: 1, minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 8,
          backgroundColor: "rgba(244, 235, 225, 0.04)",
          border: "1px solid #2B2B2B",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: ff.sans,
            fontWeight: 700,
            fontSize: 14,
            lineHeight: "18px",
            color: TITLE_TEXT,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontFamily: ff.sans,
            fontWeight: 400,
            fontSize: 13,
            lineHeight: "18px",
            color: MUTED,
          }}
        >
          {subtitle}
        </span>
      </div>
    </div>
  );
}

export function CampingSiteTypes() {
  return (
    <BodySection>
      <span style={sectionLabelStyle}>SITE TYPES</span>
      <div style={{ display: "flex", gap: 18 }}>
        <SiteType icon={<TentIcon />} label="Tent Sites" />
        <SiteType icon={<CaravanIcon />} label="RV Sites" />
        <SiteType icon={<TentRvIcon />} label="Standard (Tent/RV)" />
        <SiteType icon={<CabinIcon />} label="Tent Cabin" />
      </div>
    </BodySection>
  );
}

function SiteType({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flex: 1,
        minWidth: 0,
        alignItems: "flex-start",
      }}
    >
      <div style={{ width: 24, height: 24, color: MUTED }}>{icon}</div>
      <span
        style={{
          fontFamily: ff.sans,
          fontWeight: 400,
          fontSize: 13,
          lineHeight: "18px",
          color: BODY_TEXT,
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function CampingFeatures() {
  return (
    <BodySection>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={sectionLabelStyle}>FEATURES</span>
        <span style={sectionSubLabelStyle}>FOR CAMPERS</span>
      </div>
      <div style={{ display: "flex", gap: 18 }}>
        <Feature icon={<AccessibilityIcon />} label="ADA Access" />
        <Feature icon={<TrashIcon />} label="Trash" />
        <Feature icon={<PicnicTableIcon />} label="Picnic Table" />
        <Feature icon={<FirewoodIcon />} label="Firewood" sublabel="Available" />
      </div>
    </BodySection>
  );
}

function Feature({
  icon,
  label,
  sublabel,
}: {
  icon: ReactNode;
  label: string;
  sublabel?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 12, flex: 1, minWidth: 0, alignItems: "flex-start" }}>
      <div style={{ width: 22, height: 22, color: MUTED, flexShrink: 0 }}>{icon}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
        <span
          style={{
            fontFamily: ff.sans,
            fontWeight: 400,
            fontSize: 13,
            lineHeight: "18px",
            color: BODY_TEXT,
          }}
        >
          {label}
        </span>
        {sublabel && (
          <span
            style={{
              fontFamily: ff.sans,
              fontWeight: 400,
              fontSize: 12,
              lineHeight: "16px",
              color: MUTED,
            }}
          >
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────────

function PinIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={MUTED}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={MUTED}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={MUTED}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  );
}

function FootprintsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 16v-2.38c0-.97-.04-1.91-.69-2.65A4 4 0 0 1 7 4c1.93 0 3.5 1.79 3.5 4 0 1.5-.7 2.5-1.5 3.5L7.5 14H4z" />
      <path d="M20 20v-2.38c0-.97.04-1.91.69-2.65A4 4 0 0 0 17 8c-1.93 0-3.5 1.79-3.5 4 0 1.5.7 2.5 1.5 3.5l1.5 2.5H20z" />
      <path d="M16 17h4v3h-4z" />
      <path d="M4 13h4v3H4z" />
    </svg>
  );
}

function TentIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 21 14 3" />
      <path d="M20.5 21 10 3" />
      <path d="M15.5 21 12 15l-3.5 6" />
      <path d="M2 21h20" />
    </svg>
  );
}

function CaravanIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 17v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6h2v3H2z" />
      <circle cx="8" cy="17" r="2" />
      <path d="M9 7v6" />
      <path d="M14 13h4" />
    </svg>
  );
}

function TentRvIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 19 8 8l3 5" />
      <path d="M9 19 11 15l3 4" />
      <path d="M13 19v-6a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v6" />
      <circle cx="17" cy="19" r="1.5" />
      <path d="M2 19h20" />
    </svg>
  );
}

function CabinIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 21V10l9-7 9 7v11" />
      <path d="M9 21v-7h6v7" />
    </svg>
  );
}

function AccessibilityIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="16" cy="4" r="1" />
      <path d="m18 19 1-7-6 1" />
      <path d="m5 8 3-3 5.5 3-2.36 3.5" />
      <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
      <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

function PicnicTableIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 9h20" />
      <path d="M2 13h20" />
      <path d="M5 9 4 21" />
      <path d="m19 9 1 12" />
      <path d="M9 9v12" />
      <path d="M15 9v12" />
    </svg>
  );
}

function FirewoodIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8h18" />
      <path d="M3 12h18" />
      <path d="M3 16h18" />
      <path d="m6 4 2 4" />
      <path d="m11 4 2 4" />
      <path d="m16 4 2 4" />
      <path d="m6 16 2 4" />
      <path d="m11 16 2 4" />
      <path d="m16 16 2 4" />
    </svg>
  );
}

// ── CTA pill ────────────────────────────────────────────────────────────────

function CtaPill({ copy }: { copy: string }) {
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        position: "absolute",
        right: 25,
        top: 475,
        height: 50,
        borderRadius: 9999,
        backgroundColor: CTA_BG,
        border: `1px solid ${CTA_BORDER}`,
        boxShadow: "4px 2px 3px #00000047",
        cursor: "pointer",
        color: "#FFFFFF",
        padding: "0 24px",
      }}
    >
      <svg
        width="25"
        height="25"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span
        style={{
          fontFamily: ff.sans,
          fontWeight: 400,
          fontSize: 17,
          lineHeight: "22px",
        }}
      >
        {copy}
      </span>
    </button>
  );
}
