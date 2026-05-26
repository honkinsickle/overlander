import { SlideupShell } from "@/components/trip/slideup-shell";

/** Renders when /trips/[id]/page.tsx calls notFound() (no such trip in
 *  public.trips for this user). Brief §7 copy: "Trip not found. Pick
 *  another from the list." Slideup chrome + ✕ still work so the user
 *  can dismiss back to /trips. */
export default function TripsModalNotFound() {
  return (
    <SlideupShell>
      <div className="flex-1 flex items-center justify-center px-8">
        <p className="font-sans text-base text-text-muted text-center max-w-md">
          Trip not found. Pick another from the list.
        </p>
      </div>
    </SlideupShell>
  );
}
