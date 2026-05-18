import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { VerticalNav } from "@/components/chrome/vertical-nav";
import { TripCard } from "@/components/trips/trip-card";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listUserTrips } from "@/lib/trips/list-user-trips";

/** Layout for /trips and /trips/[id]. Persistently renders the trip
 *  list so the slideup at /trips/[id] feels anchored to the list it
 *  came from (brief §4: "thin sliver of /trips list peeking at the
 *  very top"). The `modal` parallel slot fills with the slideup when
 *  the URL is /trips/[id]; otherwise it returns null. */
export default async function TripsLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  if (!isConfigured()) {
    redirect("/auth/sign-in?error=supabase_not_configured");
  }

  // TEST MODE: Google sign-in is temporarily disabled. Anonymous
  // viewers can reach /trips. `listUserTrips` falls back to the
  // in-memory anon-trip store when there's no session. Re-enable the
  // user gate when OAuth is back.
  // const supabase = await createSupabaseServerClient();
  // const {
  //   data: { user },
  // } = await supabase.auth.getUser();
  // if (!user) {
  //   redirect("/auth/sign-in?next=/trips");
  // }
  void createSupabaseServerClient;

  const trips = await listUserTrips();

  return (
    <div className="flex w-full h-[100dvh] bg-bg-base text-text-primary overflow-hidden">
      <VerticalNav active="trips" />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-12">
          <header className="flex flex-col gap-2 mb-8">
            <p className="font-mono text-[11px] tracking-[0.18em] text-amber uppercase">
              Your trips
            </p>
            <h1 className="font-display text-4xl leading-tight">
              Where you&apos;ve been, where you&apos;re going.
            </h1>
          </header>

          {trips.length === 0 ? <EmptyState /> : <TripList trips={trips} />}
          {children}
        </div>
      </main>
      {modal}
    </div>
  );
}

function TripList({
  trips,
}: {
  trips: Awaited<ReturnType<typeof listUserTrips>>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {trips.map((trip) => (
        <TripCard key={trip.id} trip={trip} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-bg-panel border border-border-subtle flex items-center justify-center">
        <Plus className="w-7 h-7 text-text-secondary" />
      </div>
      <div className="flex flex-col gap-2 max-w-sm">
        <h2 className="font-display text-2xl">No trips yet.</h2>
        <p className="font-sans text-sm text-text-secondary">
          Start by forking the LA to Deadhorse reference itinerary — or
          plan a new one from scratch.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/trip/la-to-deadhorse"
          className="h-10 px-5 rounded-full bg-amber text-bg-base font-sans text-sm font-medium hover:opacity-90 transition-opacity flex items-center"
        >
          Browse the reference trip
        </Link>
        <Link
          href="/plan"
          className="h-10 px-5 rounded-full border border-border-subtle text-text-primary font-sans text-sm hover:border-amber/60 transition-colors flex items-center"
        >
          Plan a new trip
        </Link>
      </div>
    </div>
  );
}
