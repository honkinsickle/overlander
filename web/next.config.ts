import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Make sure the reference-trip snapshot is shipped with the server bundle.
  // `lib/trips/reference.ts` reads it via fs at runtime as the fallback when
  // Supabase is unreachable; without this entry Vercel won't trace it.
  outputFileTracingIncludes: {
    "/**": [".alaska-snapshot.json"],
  },
};

export default nextConfig;
