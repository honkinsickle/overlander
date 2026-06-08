import { NextResponse } from "next/server";
import { hydratePlacesByIds } from "@/lib/trip-browse/hydrate";

/**
 * POST /api/places/hydrate  { ids: string[] }  →  { places: BrowsePlace[] }
 *
 * Hydrates a list of master_place IDs (the thin output of the Typesense
 * matcher in `lib/search`) into full BrowsePlace cards. The read + projection
 * live in `lib/trip-browse/hydrate` (`hydratePlacesByIds`) so this route and
 * the top-level `/api/search-area` route project corpus rows identically.
 */

const MAX_IDS = 50;

function parseIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const ids = (body as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  if (!ids.every((x): x is string => typeof x === "string" && x.length > 0)) {
    return null;
  }
  // De-dupe while preserving the caller's (Typesense-ranked) order.
  return Array.from(new Set(ids)).slice(0, MAX_IDS);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = parseIds(body);
  if (ids === null) {
    return NextResponse.json(
      { error: "Body must be { ids: string[] }" },
      { status: 400 },
    );
  }
  if (ids.length === 0) {
    return NextResponse.json({ places: [] });
  }

  try {
    const places = await hydratePlacesByIds(ids);
    return NextResponse.json({ places });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "hydrate failed" },
      { status: 502 },
    );
  }
}
