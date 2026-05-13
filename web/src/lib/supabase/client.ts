"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireUrlAndAnon } from "./env";

/** Singleton browser client. Safe to share across components because
 *  Supabase auth state is keyed off cookies, not in-memory state. */
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const { url, anon } = requireUrlAndAnon();
  browserClient = createBrowserClient(url, anon);
  return browserClient;
}
