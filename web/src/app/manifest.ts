import type { MetadataRoute } from "next";

/**
 * PWA manifest. Next 16 file-convention; Next emits the linked
 * `<link rel="manifest">` in `<head>` automatically.
 *
 * `theme_color` and `background_color` match `--bg-base` in
 * `globals.css` so the iPad standalone shell matches the in-app
 * chrome with no flash.
 *
 * Icons are placeholders (solid amber, no glyph) until a real
 * mark lands. Three sizes cover the install affordances we care
 * about: Apple-touch-icon 180×180, PWA 192×192 (small home-screen
 * + manifest minimum), 512×512 (high-density home-screen + splash).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Overlander",
    short_name: "Overlander",
    description: "Plan overland trips with confidence.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0b0c",
    theme_color: "#0a0b0c",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
