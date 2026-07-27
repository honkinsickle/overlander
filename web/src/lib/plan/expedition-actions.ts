"use server";

/**
 * The wizard's server-side entry point into the merged YoTrippin pipeline:
 *   form → GenerationInput → preComputeFacts → generateAndAudit →
 *   bakeGeneratedDays → itineraryToTrip → persist → tripId.
 *
 * SAFETY (hard requirements):
 *   - GATED: refuses unless ENABLE_PLANNER_WIZARD=true (dev opt-in).
 *   - SIGNED-IN: refuses without a session. Generation produces an OWNED trip —
 *     a `public.trips` row carrying `owner_id` from the session, so it is
 *     editable and appears in the user's listing
 *     (`docs/decisions/2026-07-27-generation-requires-sign-in.md`). The
 *     page carries the same gate, but that is not enough on its own: per
 *     `web/src/proxy.ts`, Server Actions are POSTs to the page they live on, so
 *     a session that lapses between render and submit still reaches this action.
 *
 * The action-level TEST-ONLY refusal is GONE (2026-07-27). It existed because
 * generation used to upsert into `reference_trips` — the curated-content table —
 * under a SERVICE-ROLE client, unauthenticated and RLS-bypassing. Refusing to run
 * against prod was correct for that shape. It no longer describes this action:
 * the trip write is now a session-scoped insert into `public.trips` with
 * `owner_id` from `getUser()`, validated by `trips_insert_owner`
 * (`auth.uid() = owner_id`). A user can only ever create their own row.
 *
 * ONE service-role write survives and KEEPS a TEST-only gate — the corpus
 * write-back below. See the comment at that call site; the gate moved rather
 * than disappeared, because that path's blast radius is unchanged.
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

  // Sign-in guard. Same shape as `node-actions.ts`'s `guard`: explicit
  // getUser, clean error the wizard can render. Deliberately AFTER the flag
  // check — that is a cheap refusal that should not depend on a session.
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
    // `state: "active"`, NOT the `'draft'` default. The original reason —
    // `trip-card.tsx` deep-linking `state === "draft"` into the legacy wizard —
    // no longer applies (as of 2026-07-27 every card opens `/trips/<id>`), but
    // the choice stands on its own: a generated trip is finished, not a
    // half-filled wizard draft, and `state` is what `/trips` renders it as.
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
    // promote them (self-densifying). Non-fatal: a corpus-write failure must
    // never fail the user's generation.
    //
    // TEST-ONLY, and this gate is LOAD-BEARING — do not fold it into the removal
    // of the action-level rail. Unlike the trip insert above, this is a
    // SERVICE-ROLE write to a SHARED, curated table: `upsert_source_record` is
    // SECURITY INVOKER and `source_record` has RLS enabled with zero policies, so
    // it only works under the service client and bypasses nothing else's rules.
    // The blast radius the old rail protected is therefore unchanged HERE.
    //
    // `ingest.ts`'s own docstring states the invariant this preserves: "a PROD
    // corpus write would need a SEPARATE deliberate gate (its own flag + a PROD
    // field_precedence apply)". Neither exists yet, and PROD carries zero
    // google_resolved rows. Dropping this check would silently turn every prod
    // generation into an unreviewed write to prod curated data — see
    // `docs/decisions/2026-07-23-corpus-writeback-dormant.md`
    // ("generation-triggered prod corpus writes need earned trust first").
    //
    // Promotion to `master_place` stays a manual `npm run -w data materialize`
    // either way; this gate governs CAPTURE, not promotion.
    const { label: projectLabel } = currentProjectRef();
    const resolvedPlaces =
      projectLabel === "TEST"
        ? audited.days.flatMap((d) => d.audit?.resolvedPlaces ?? [])
        : [];
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
