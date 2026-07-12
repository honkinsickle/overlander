/**
 * Bare passthrough layout for /trip/[id].
 *
 * The trip surface (page.tsx) now mounts the full-viewport slideup
 * (`SlideupShell`, `fixed inset-0`), and the day rail + map live inside
 * `TripSlideupBody` — so this layout no longer owns the 3-column chrome it
 * used to (that would double the map and cover it with the sheet). Kept as
 * a thin segment boundary for the `/trip/[id]/ask` child, which brings its
 * own `ChatLayout`.
 */
export default function TripLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
