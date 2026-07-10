import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/env";
import { bakeCorridors, hasBakedCorridors } from "@/lib/trips/bake-corridors";
import type { Trip } from "@/lib/trips/types";

/** Fork a reference trip into the authed user's trips row.
 *
 *  Body: { reference_id: string }
 *  Returns: { id: string } — the new user-trip id.
 *
 *  RLS does the heavy lifting:
 *    - reference_trips_public_read lets us read the payload.
 *    - trips_insert_owner enforces auth.uid() === owner_id on insert.
 *  We use the per-request server client (cookie-backed) so auth.uid()
 *  resolves to the caller. */
export async function POST(request: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  let body: { reference_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const referenceId = body.reference_id;
  if (typeof referenceId !== "string" || !referenceId) {
    return NextResponse.json({ error: "missing_reference_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: ref, error: refError } = await supabase
    .from("reference_trips")
    .select("title, payload")
    .eq("id", referenceId)
    .maybeSingle();

  if (refError || !ref) {
    return NextResponse.json({ error: "reference_not_found" }, { status: 404 });
  }

  // Ensure the stored payload carries corridors so the fork is editable and
  // renders full (not the degraded two-node fallback). Two paths:
  //   - Reseeded reference (already baked): copy VERBATIM — no re-derive.
  //     This is the hot path once the reference is precompute-and-persisted;
  //     re-baking here would waste ~7-10s AND clobber the baked corridors.
  //   - Legacy spine-less source (no corridorCities): bake now — the safety
  //     net for pre-engine payloads (and any lacking routePolyline resolves
  //     to a no-op, never a throw). Inline + fails soft.
  // recomputeDay / add-waypoint then operate on the stored corridors, so a
  // forked trip behaves like a wizard-finalize trip either way.
  const source = ref.payload as Trip;
  const baked = hasBakedCorridors(source)
    ? source
    : await bakeCorridors(source, supabase);

  const { data: inserted, error: insertError } = await supabase
    .from("trips")
    .insert({
      owner_id: user.id,
      reference_id: referenceId,
      title: ref.title,
      state: "active",
      payload: baked,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: inserted.id });
}
