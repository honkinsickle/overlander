import { Info } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Amber info callout — used in Planning steps to give contextual help.
 * See Paper step 03 Vehicle "Automagically tailors elevation, fuel range…".
 */
export function TipCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg"
      style={{
        backgroundColor: "rgba(200,169,110,0.08)",
        border: "1px solid rgba(200,169,110,0.18)",
      }}
    >
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ backgroundColor: "rgba(200,169,110,0.18)" }}
      >
        <Info aria-hidden className="w-3.5 h-3.5 text-amber" />
      </div>
      <div className="flex-1 text-sm text-text-primary leading-snug">
        {children}
      </div>
    </div>
  );
}
