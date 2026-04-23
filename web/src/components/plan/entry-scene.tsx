import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Planning Entry Scene — Paper `CR4-0` (from v3-1 / v3-2 / v3-3).
 *
 * Left panel (`CR5-0`, 537×684): Logo + eyebrow + heading + description
 * + "Create a Trip" CTA + browse-expeditions link.
 * Right panel: Map-style stub with recent-trip markers.
 *
 * Rendered full-opacity as the home `/` landing; the `WizardBackdrop`
 * renders the same component with `muted` so the Going / Vehicle / etc.
 * modals sit on top of the scene the user came from.
 */
export function EntryScene({ muted = false }: { muted?: boolean }) {
  return (
    <div
      aria-hidden={muted}
      className={`absolute inset-0 flex ${muted ? "opacity-60 pointer-events-none select-none" : ""}`}
    >
      <EntryLeft muted={muted} />
      <EntryMap />
    </div>
  );
}

function EntryLeft({ muted }: { muted: boolean }) {
  return (
    <div
      className="relative flex flex-col items-center justify-center shrink-0 w-[537px] h-full px-10 py-12 gap-5"
    >
      {/* Logo — Paper CR6-0 · 104×104 · radius 14 · gradient + shadow */}
      <div
        className="flex items-center justify-center w-[104px] h-[104px] rounded-[14px] shrink-0"
        style={{
          background:
            "linear-gradient(135deg, #1e3b34 0%, #2d5045 55%, #c8a96e 100%)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        }}
      >
        <Sparkles className="w-10 h-10 text-text-primary" strokeWidth={1.5} />
      </div>

      {/* Eyebrow — Paper CRD-0 · Space Mono 10/12 · tracking 3px · amber */}
      <span
        className="font-mono"
        style={{
          fontSize: "10px",
          lineHeight: "12px",
          letterSpacing: "3px",
          textTransform: "uppercase",
          color: "var(--amber)",
        }}
      >
        Overland Trip Planner
      </span>

      {/* Heading — Paper CRE-0 · Barlow 700 · 44/46 · −0.01em · text-primary */}
      <h1
        className="text-center"
        style={{
          fontSize: "44px",
          lineHeight: "46px",
          letterSpacing: "-0.01em",
          fontFamily: "var(--ff-sans)",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        Where to today?
      </h1>

      {/* Description — Paper CRF-0 · Barlow 400 · 15/23 · text-muted · 420w */}
      <p
        className="text-center"
        style={{
          width: "420px",
          fontSize: "15px",
          lineHeight: "23px",
          fontFamily: "var(--ff-sans)",
          fontWeight: 400,
          color: "var(--text-muted)",
        }}
      >
        Hey there, I&rsquo;m here to help you plan your next overland
        expedition. Ask me anything — destinations, routes, gear, or pit
        stops.
      </p>

      {/* Create a Trip CTA — Paper CRG-0 / CRK-0 · 52h · rounded-full ·
       *  px 32 · gap 10 · bg --button-primary · border --button-primary-border
       *  · shadow.  Label: Barlow 700 · 14/18 · tracking 0.06em · uppercase. */}
      <Link
        href="/plan"
        tabIndex={muted ? -1 : 0}
        className="flex items-center mt-2 h-[52px] px-8 rounded-full bg-button-primary hover:bg-button-primary-hover border border-button-primary-border"
        style={{
          gap: "10px",
          boxShadow: "0 12px 32px rgba(77,170,255,0.30)",
        }}
      >
        <Sparkles className="w-4 h-4 text-text-primary" strokeWidth={2} />
        <span
          className="uppercase"
          style={{
            fontSize: "14px",
            lineHeight: "18px",
            letterSpacing: "0.06em",
            fontFamily: "var(--ff-sans)",
            fontWeight: 700,
            color: "#FFFFFF",
          }}
        >
          Create a Trip
        </span>
      </Link>

      {/* Browse link — Paper CRL-0 · Barlow 400 · 13/16 · text-muted */}
      <Link
        href="/trip/la-to-portland"
        tabIndex={muted ? -1 : 0}
        className="font-sans text-text-muted hover:text-text-primary"
        style={{ fontSize: "13px", lineHeight: "16px" }}
      >
        or browse past expeditions
      </Link>
    </div>
  );
}

/** Placeholder world-map panel (Paper CRM-0). Real Mapbox can slot in
 *  later; for now a radial-gradient ground + muted grid + "Your World"
 *  tag keeps the scene readable. */
function EntryMap() {
  return (
    <div className="relative flex-1 h-full overflow-hidden bg-bg-map">
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, rgba(61,162,221,0.18) 0%, transparent 55%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute top-6 right-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-card border border-border-subtle">
        <span
          className="w-1.5 h-1.5 rounded-full bg-amber"
          aria-hidden
        />
        <span
          className="font-mono uppercase"
          style={{
            fontSize: "10px",
            letterSpacing: "2px",
            color: "var(--text-muted)",
          }}
        >
          Your World
        </span>
      </div>
    </div>
  );
}
