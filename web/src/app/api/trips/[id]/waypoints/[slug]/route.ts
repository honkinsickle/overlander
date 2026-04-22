import { NextResponse } from "next/server";
import { getWaypoint } from "@/lib/trips/repository";
import { API_LATENCY_MS, sleep } from "@/lib/trips/api-helpers";

/**
 * GET /api/trips/[id]/waypoints/[slug]
 *
 * Dev-only debug flags (ignored in production):
 *   ?simulate=error   → returns 500
 *   ?simulate=timeout → sleeps 5s then returns 504
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; slug: string }> },
) {
  const { id, slug } = await context.params;
  const url = new URL(req.url);
  const simulate = url.searchParams.get("simulate");
  const isDev = process.env.NODE_ENV === "development";

  if (isDev && simulate === "error") {
    await sleep(API_LATENCY_MS);
    return NextResponse.json(
      { error: "Simulated server error", tripId: id, slug },
      { status: 500 },
    );
  }

  if (isDev && simulate === "timeout") {
    await sleep(5000);
    return NextResponse.json(
      { error: "Simulated timeout", tripId: id, slug },
      { status: 504 },
    );
  }

  await sleep(API_LATENCY_MS);
  const waypoint = await getWaypoint(id, slug);
  if (!waypoint) {
    return NextResponse.json(
      { error: "Waypoint not found", tripId: id, slug },
      { status: 404 },
    );
  }
  return NextResponse.json(waypoint);
}
