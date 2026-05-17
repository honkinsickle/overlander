import { SlideupShell } from "@/components/trip/slideup-shell";

/** Loading state for /trips/[id]. Brief §5: "Slideup chrome and ✕
 *  render immediately. Body shows skeleton until trip data resolves."
 *  Mirrors the live 3-column body widths (215 · 440 · flex) from
 *  TripSlideupBody so the layout doesn't reflow when the real data
 *  swaps in. */
export default function TripsModalLoading() {
  return (
    <SlideupShell hidePhase>
      <div className="w-[215px] bg-bg-base border-r border-border-subtle shrink-0 animate-pulse" />
      <section className="w-[440px] bg-bg-panel border-r border-border-subtle shrink-0 p-6 flex flex-col gap-4">
        <div className="h-6 w-2/3 rounded bg-border-subtle animate-pulse" />
        <div className="h-40 w-full rounded bg-border-subtle animate-pulse" />
        <div className="h-4 w-1/2 rounded bg-border-subtle animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-border-subtle animate-pulse" />
      </section>
      <section className="flex-1 min-w-0 bg-bg-base animate-pulse" />
    </SlideupShell>
  );
}
