import { NextResponse } from "next/server";
import { getTrip } from "@/lib/trips/repository";
import { API_LATENCY_MS, sleep } from "@/lib/trips/api-helpers";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await sleep(API_LATENCY_MS);
  const trip = await getTrip(id);
  if (!trip) {
    return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  }
  return NextResponse.json(trip);
}
