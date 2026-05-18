/** Returns a Mapbox Static API URL centered on `coords`. Used for the
 *  per-day hero image inside the slideup — each day's start city.
 *
 *  Defaults to `mapbox/satellite-streets-v12` so the snapshot reads as
 *  a recognizable place rather than an abstract map. The token is
 *  public (NEXT_PUBLIC_MAPBOX_TOKEN) and ships to the browser anyway
 *  for mapbox-gl, so embedding it in the URL is fine. */
export function mapboxStaticForCoords(
  coords: [number, number],
  opts: {
    zoom?: number;
    width?: number;
    height?: number;
    style?: string;
  } = {},
): string {
  const {
    zoom = 9,
    width = 800,
    height = 500,
    style = "mapbox/satellite-streets-v12",
  } = opts;
  const [lng, lat] = coords;
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  return `https://api.mapbox.com/styles/v1/${style}/static/${lng},${lat},${zoom}/${width}x${height}@2x?access_token=${token}`;
}

/** Returns a Mapbox Static URL with the trip route drawn as a polyline
 *  overlay, auto-fit to bounds. Used for the trip-level hero so the
 *  image conveys "this is the trip" rather than just one endpoint.
 *
 *  `encodedPolyline` must be a Google-format polyline (precision 5),
 *  which is what `lib/routing/polyline.ts:encodePolyline` produces.
 *  It is URL-encoded so the special characters survive the request. */
export function mapboxStaticForRoute(
  encodedPolyline: string,
  opts: {
    width?: number;
    height?: number;
    style?: string;
    /** Stroke color (hex w/o #). Default = amber `c8a96e`. */
    strokeColor?: string;
    /** Stroke width in pixels. */
    strokeWidth?: number;
    /** Stroke alpha in [0, 1]. */
    strokeAlpha?: number;
    /** Padding around the polyline in the rendered image. Accepts a
     *  single number (all sides) or a `top,right,bottom,left` string.
     *  Default keeps a 40px ring with extra bottom padding so the
     *  southern endpoint sits above the stats overlay in
     *  TripDetailHeader (overlay covers ~85px at the bottom). */
    padding?: number | string;
  } = {},
): string {
  const {
    width = 800,
    height = 500,
    style = "mapbox/satellite-streets-v12",
    strokeColor = "c8a96e",
    strokeWidth = 3,
    strokeAlpha = 0.9,
    padding = "40,40,160,40",
  } = opts;
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  // Path overlay format:
  //   path-{width}+{color}-{alpha}({url-encoded polyline})
  // `auto` fits the camera to the overlay's bounds (with padding).
  const overlay = `path-${strokeWidth}+${strokeColor}-${strokeAlpha}(${encodeURIComponent(encodedPolyline)})`;
  return `https://api.mapbox.com/styles/v1/${style}/static/${overlay}/auto/${width}x${height}@2x?padding=${padding}&access_token=${token}`;
}
