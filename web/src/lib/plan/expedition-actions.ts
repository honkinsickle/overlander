"use server";

/**
 * The wizard's server-side entry point into the merged YoTrippin pipeline:
 *   form → GenerationInput → preComputeFacts → generateAndAudit →
 *   bakeGeneratedDays → itineraryToTrip → persist → tripId.
 *
 * SAFETY (hard requirements):
 *   - GATED: refuses unless ENABLE_PLANNER_WIZARD=true (dev opt-in).
 *   - TEST-ONLY: refuses to persist unless the app is pointed at the TEST
 *     project — a generation can NEVER write to prod, even if the route were
 *     somehow reached with a prod-configured env.
 *   - SIGNED-IN: refuses without a session. Generation produces an OWNED trip —
 *     a `public.trips` row carrying `owner_id` from the session, so it is
 *     editable and appears in the user's listing
 *     (`docs/decisions/2026-07-27-generation-requires-sign-in.md`). The
 *     page carries the same gate, but that is not enough on its own: per
 *     `web/src/proxy.ts`, Server Actions are POSTs to the page they live on, so
 *     a session that lapses between render and submit still reaches this action.
 */

import { preComputeFacts } from "@/lib/itinerary/facts";
import { generateAndAudit, ItineraryGenerationError } from "@/lib/itinerary/generate";
import { enqueueResolvedPlaces } from "@/lib/itinerary/ingest";
import { bakeGeneratedDays } from "@/lib/itinerary/bake";
import { itineraryToTrip } from "@/lib/itinerary/to-trip";
import { attachHeroPhotos } from "@/lib/imagery/destination-photo";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import {
  currentProjectRef,
  expeditionToGenerationInput,
  isExpeditionWizardEnabled,
  validateExpeditionForm,
  type ExpeditionForm,
} from "./expedition";

export type GenerateResult =
  | { ok: true; tripId: string; days: number; note?: string }
  | { ok: false; error: string };

export async function generateExpeditionTripAction(
  form: ExpeditionForm,
): Promise<GenerateResult> {
  // Gate.
  if (!isExpeditionWizardEnabled()) {
    return { ok: false, error: "The planner wizard is disabled (set ENABLE_PLANNER_WIZARD=true)." };
  }

  // TEST-only guard — the single most important safety check.
  const { ref, label } = currentProjectRef();
  if (label !== "TEST") {
    return {
      ok: false,
      error: `Refusing to run: the app is pointed at ${label} (${ref}), not TEST. Point dev at the TEST project before generating.`,
    };
  }

  // Sign-in guard. Same shape as `node-actions.ts`'s `guard`: explicit
  // getUser, clean error the wizard can render. Deliberately AFTER the flag and
  // TEST-ref checks — those are cheap refusals that should not depend on a
  // session, and the ref check confirms the env is pointed somewhere real
  // before we construct a cookie-backed client.
  //
  // The session is also what makes the write below possible: the trip is
  // inserted into `public.trips` with `owner_id = user.id`, and
  // `trips_insert_owner` checks `auth.uid() = owner_id`.
  //
  // Named `authClient`, not `supabase`: the pipeline below uses a SERVICE-role
  // client under that name. Two differently-privileged clients sharing one
  // identifier is exactly the confusion worth not introducing here.
  const authClient = await createSupabaseServerClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to generate a trip." };

  const invalid = validateExpeditionForm(form);
  if (invalid) return { ok: false, error: invalid };

  const input = expeditionToGenerationInput(form);

  try {
    const facts = await preComputeFacts(input);
    const { audited, dayRoutes, unresolved } = await generateAndAudit(input, facts);

    const supabase = createSupabaseServiceClient();
    const baked = await bakeGeneratedDays(audited, input, supabase, dayRoutes);

    // `payload.id` is a PLACEHOLDER. `public.trips.id` is
    // `uuid default gen_random_uuid()`, so the id does not exist until the
    // insert returns — and the DB column is authoritative regardless:
    // `getUserTrip` overlays `{ ...payload, id: data.id, title: data.title }`,
    // and `updateUserTripPayload` re-restores it on every write. Same
    // convention as forked trips and `finalizeTripAction`.
    // Real per-day + trip hero photos (Wikipedia/Commons by destination
    // name) so a generated trip renders place photos, not blank heroes.
    const trip = await attachHeroPhotos(
      itineraryToTrip("", input, facts, audited, baked, dayRoutes),
    );

    // Persist as an OWNED user trip, not a reference trip
    // (`docs/decisions/2026-07-27-generation-requires-sign-in.md`). Column set
    // matches `app/api/trips/fork/route.ts`, which already produces exactly
    // this shape.
    //
    // `authClient` — the SESSION client from the sign-in guard above — because
    // `trips_insert_owner` is `with check (auth.uid() = owner_id)` and there is
    // no `owner_id` default: RLS validates it, it does not populate it. The
    // service client would bypass RLS and have no `auth.uid()` to check.
    // This is the ONLY call site that changes hands; `bakeGeneratedDays` and
    // `enqueueResolvedPlaces` below keep the service client deliberately.
    //
    // `state: "active"`, NOT the `'draft'` default: `trip-card.tsx` routes
    // `state === "draft"` to `/plan/${id}/${wizardStep}`, a legacy wizard route
    // being removed — a generated trip left at the default would deep-link into
    // a dead surface.
    //
    // `reference_id: null` — a generated trip derives from no reference.
    const { data: inserted, error } = await authClient
      .from("trips")
      .insert({
        owner_id: user.id,
        reference_id: null,
        title: trip.title,
        state: "active",
        payload: trip,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      return { ok: false, error: `Persist failed: ${error?.message ?? "insert returned no row"}` };
    }
    const tripId = inserted.id as string;

    // Corpus feedback (spec §8.3): enqueue this generation's tier-2 live-resolved
    // places as google_resolved source_records so a later `materialize` can
    // promote them (self-densifying). Only reachable on TEST — the guard at the
    // top of this action refuses any non-TEST project. Non-fatal: a corpus-write
    // failure must never fail the user's generation.
    const resolvedPlaces = audited.days.flatMap((d) => d.audit?.resolvedPlaces ?? []);
    if (resolvedPlaces.length > 0) {
      try {
        const enq = await enqueueResolvedPlaces(resolvedPlaces, supabase);
        if (enq.errors.length > 0) console.warn("[ingest] google_resolved partial:", enq);
      } catch (e) {
        console.warn("[ingest] google_resolved enqueue failed (non-fatal):", e);
      }
    }

    return {
      ok: true,
      tripId,
      days: trip.days.length,
      note: unresolved
        ? "Generated, but some anchors couldn't be fully reconciled — review the plan."
        : undefined,
    };
  } catch (err) {
    if (err instanceof ItineraryGenerationError) {
      return { ok: false, error: `Generation failed (${err.code}): ${err.message}` };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown generation error.",
    };
  }
}
