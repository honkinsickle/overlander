import { NextResponse } from "next/server";
import { readDrafts } from "@/lib/plan/cookie-store";

/**
 * Temporary debug endpoint. Returns the decoded __plan_drafts cookie
 * contents so we can see exactly what's persisted server-side at any
 * point in the wizard. Remove once the going-step persistence bug is
 * understood and fixed.
 */
export async function GET() {
  const drafts = await readDrafts();
  const summary = Object.entries(drafts).map(([id, d]) => ({
    id,
    createdAt: d.createdAt,
    hasGoing: !!d.going,
    going: d.going,
    hasVehicle: !!d.vehicle,
    hasInterests: !!d.interests,
    hasStops: !!d.stops,
  }));
  return NextResponse.json(
    { count: Object.keys(drafts).length, drafts: summary },
    { headers: { "cache-control": "no-store" } },
  );
}
