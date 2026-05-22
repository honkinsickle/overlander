import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin Turbopack root. Without this it walks up looking for a lockfile and
  // finds a stray ~/package-lock.json, which breaks Tailwind resolution.
  // Must match `outputFileTracingRoot` below.
  turbopack: { root: path.join(__dirname, "..") },
  // The repo is a monorepo-ish layout: Next lives in `web/` but
  // `planning/reference/alaska-v3.md` (read by lib/events/parse-fixed-events.ts
  // on every home-page render) lives one level up at the repo root.
  // Widen the trace root so includes can reach it.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/**": [
      "./.alaska-snapshot.json",
      "../planning/reference/alaska-v3.md",
    ],
  },
  // Service-worker file headers (per the Next 16 PWA guide). The SW must
  // never be cached by intermediaries or the browser HTTP cache — stale
  // SW scripts mask deploy fixes. Cache-Control here is unrelated to the
  // Cache Storage API the SW itself uses; that's our own offline cache.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
