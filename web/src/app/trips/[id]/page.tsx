/** /trips/[id] children slot. The slideup is rendered by the
 *  app/trips/@modal/[id]/page.tsx parallel slot; the children slot
 *  exists so the URL is a valid route (and so refreshes/deeplinks
 *  resolve the layout's children placeholder, not a 404). */
export default function TripsIdPlaceholder() {
  return null;
}
