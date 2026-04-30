"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  type Category,
  categoryStyle,
  categoryIcon,
} from "@/components/primitives/detail-card";
import { CategoryPlanningSlide } from "@/components/demo/category-planning-slide";
import {
  BROWSE_PLACES,
  TRIP_CATEGORY_TO_SLIDE,
} from "@/lib/trip-browse/places";

export type BrowseTarget = {
  category: Category;
  dayNumber: number;
};

const PANEL_WIDTH = 686;
const TRANSITION_MS = 280;

export function CategoryBrowsePanel({
  target,
  onClose,
}: {
  target: BrowseTarget | null;
  onClose: () => void;
}) {
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Push the map column so its left edge meets the panel's right edge. We
  // measure dynamically (subtracting any current marginLeft) so chrome
  // width changes don't silently break the alignment. Cleanup restores
  // the original style on close or unmount.
  useEffect(() => {
    const mapSection = document.querySelector<HTMLElement>(
      'section[aria-label="Map"]',
    );
    if (!mapSection) return;
    mapSection.style.transition = `margin-left ${TRANSITION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    if (open) {
      const cs = getComputedStyle(mapSection);
      const currentMl = parseFloat(cs.marginLeft) || 0;
      const naturalLeft =
        mapSection.getBoundingClientRect().left - currentMl;
      mapSection.style.marginLeft = `${PANEL_WIDTH - naturalLeft}px`;
    } else {
      mapSection.style.marginLeft = "";
    }
    return () => {
      mapSection.style.marginLeft = "";
    };
  }, [open]);

  const style = target ? categoryStyle[target.category] : null;
  const Icon = target ? categoryIcon[target.category] : null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-hidden={!open}
      aria-label={target ? `Browse ${style!.label}` : undefined}
      className="fixed inset-0 z-40 pointer-events-none"
    >

      <aside
        style={{
          width: PANEL_WIDTH,
          transform: open ? "translateX(0)" : `translateX(-${PANEL_WIDTH}px)`,
          transitionProperty: "transform",
          transitionDuration: `${TRANSITION_MS}ms`,
          transitionTimingFunction: "cubic-bezier(0.32, 0.72, 0, 1)",
          backgroundColor: "var(--bg-panel)",
          borderRight: "1px solid var(--border-subtle)",
        }}
        className="absolute inset-y-0 left-0 flex flex-col shadow-2xl pointer-events-auto"
      >
        <header
          className="flex items-center shrink-0"
          style={{
            height: 68,
            paddingLeft: 20,
            paddingRight: 16,
            gap: 12,
            backgroundColor: "var(--bg-base)",
            borderBottom: "1px solid var(--border-mid)",
          }}
        >
          <div
            className="flex items-center justify-center shrink-0 rounded-md"
            style={{
              width: 36,
              height: 36,
              backgroundColor: style?.bg ?? "transparent",
              border: style ? `1px solid ${style.accent}` : undefined,
            }}
          >
            {Icon ? (
              <Icon
                width={18}
                height={18}
                stroke={style!.accent}
                strokeWidth={1.75}
                fill="none"
              />
            ) : null}
          </div>

          <div className="flex flex-col min-w-0 flex-1">
            <span
              className="uppercase truncate"
              style={{
                fontFamily: "var(--ff-display)",
                fontSize: 11,
                lineHeight: "14px",
                fontWeight: 600,
                letterSpacing: "0.18em",
                color: "var(--text-muted)",
              }}
            >
              Browse {target ? `Day ${target.dayNumber}` : ""}
            </span>
            <span
              className="truncate"
              style={{
                fontFamily: "var(--ff-sans)",
                fontSize: 18,
                lineHeight: "22px",
                fontWeight: 700,
                color: style?.accent ?? "var(--text-primary)",
              }}
            >
              {style?.label ?? ""}
            </span>
          </div>

          {/* Close — Paper ANI-0 / slideup-shell parity:
           *  60×60 · bg --bg-card · 1px left border --border-subtle ·
           *  margin-right -12 so it sits flush with the bar edge. */}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ marginRight: -12 }}
            className="flex items-center justify-center shrink-0 w-[60px] h-[60px] bg-bg-card border-l border-border-subtle"
          >
            <ArrowLeft className="w-[22px] h-[22px] text-text-muted" strokeWidth={1.5} />
          </button>
        </header>

        <div
          className="flex-1 overflow-y-auto no-scrollbar"
          style={{ backgroundColor: "var(--bg-base)" }}
        >
          {target ? <PanelBody target={target} /> : null}
        </div>
      </aside>
    </div>
  );
}

function PanelBody({ target }: { target: BrowseTarget }) {
  const slideKey = TRIP_CATEGORY_TO_SLIDE[target.category];
  const places = slideKey
    ? BROWSE_PLACES[target.dayNumber]?.[slideKey] ?? []
    : [];
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!slideKey || places.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          minHeight: "100%",
          padding: 24,
          fontFamily: "var(--ff-mono)",
          fontSize: 12,
          lineHeight: "18px",
          letterSpacing: "0.14em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        No places yet for this category on Day {target.dayNumber}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center"
      style={{ paddingTop: 16, paddingBottom: 16, gap: 16 }}
    >
      {places.map((p) => (
        <div
          key={p.id}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("trip:flyTo", {
                detail: { coords: p.coords, name: p.title },
              }),
            )
          }
          style={{ cursor: "pointer" }}
        >
          <CategoryPlanningSlide
            category={slideKey}
            data={p}
            compact
            expanded={expandedId === p.id}
            onToggle={() =>
              setExpandedId((curr) => (curr === p.id ? null : p.id))
            }
          />
        </div>
      ))}
    </div>
  );
}
