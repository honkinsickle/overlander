import Link from "next/link";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { TOTAL_DISPLAY_STEPS } from "@/lib/plan/types";

/**
 * Centered card that holds the current step's content. Mimics the Paper
 * "Modal Wrap" but is just a positioned card — no Dialog semantics since
 * the surface is a dedicated route.
 *
 * Use `width="wide"` (720) for Interests; default 520 for everything else.
 */
export function PlanningCard({
  displayStep,
  title,
  width = "standard",
  closeHref = "/",
  children,
  footer,
}: {
  displayStep: number;
  title: string;
  width?: "standard" | "wide";
  closeHref?: string;
  children: ReactNode;
  /** Omit to render the card without a footer row (e.g. the Loader step). */
  footer?: ReactNode;
}) {
  return (
    <article
      className={[
        "flex flex-col gap-5 px-7 py-6 bg-bg-panel border border-border-subtle rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.7)]",
        width === "wide" ? "w-[720px]" : "w-[520px]",
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="section-label text-[11px] text-text-muted">
            STEP {String(displayStep).padStart(2, "0")} /{" "}
            {String(TOTAL_DISPLAY_STEPS).padStart(2, "0")}
          </span>
          <h2 className="font-sans font-bold text-2xl text-amber">{title}</h2>
        </div>
        <Link
          href={closeHref}
          aria-label="Close"
          className="w-9 h-9 flex items-center justify-center rounded-full bg-bg-card border border-border-subtle text-text-primary hover:bg-bg-nav-btn"
        >
          <X className="w-4 h-4" />
        </Link>
      </header>

      <div className="flex flex-col gap-5">{children}</div>

      {footer !== undefined && footer !== null && (
        <footer className="flex items-center justify-end gap-3 pt-2">
          {footer}
        </footer>
      )}
    </article>
  );
}
