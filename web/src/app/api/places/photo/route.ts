import { NextResponse } from "next/server";

/**
 * Proxy for Google Place Photo URLs. Required because the actual photo
 * fetch needs the API key on every request — exposing the key to the
 * client would let any visitor drain quota. The Google source emits
 * `photoUrl=/api/places/photo?ref=<photo_reference>`; this handler
 * resolves the reference server-side and streams the image bytes back.
 *
 * Photo reference name is the Google-issued `places/<id>/photos/<photoId>`
 * string returned by `places:searchNearby`. We URL-decode and forward to
 * `/v1/{ref}/media`.
 *
 * Cache: 24h immutable. Photo references are stable for the lifetime
 * of the upstream photo, so the browser can hold onto the image safely.
 */
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref");
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!ref) {
    return NextResponse.json({ error: "Missing ref" }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY not configured" },
      { status: 503 },
    );
  }
  // Defense in depth: the ref must look like a Google photo path.
  // Rejects anything that tries to redirect this handler off-host.
  if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(ref)) {
    return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
  }

  const upstream = await fetch(
    `https://places.googleapis.com/v1/${ref}/media?maxHeightPx=800&key=${encodeURIComponent(key)}`,
    { redirect: "follow" },
  );
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, { status: upstream.status });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
