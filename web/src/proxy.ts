import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// Same Edge-style hook, new file convention.

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  // Run on every page navigation; skip static + image-opt assets so we
  // don't spend a Supabase round-trip on every prefetched chunk.
  // Note: Server Actions are POSTs to the page they live on, so the
  // matcher implicitly covers them — auth checks still belong inside
  // each Server Action per the proxy docs.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?)$).*)",
  ],
};
