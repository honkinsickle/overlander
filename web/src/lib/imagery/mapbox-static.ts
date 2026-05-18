/** Returns a Mapbox Static API URL centered on `coords`. Used for
 *  user-trip hero images (trip card on /trips + per-day hero inside
 *  the slideup) until proper photo curation lands.
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
