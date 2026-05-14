// Centralized env access for Supabase. Lets callers ask `isConfigured()`
// instead of repeating `!!process.env.NEXT_PUBLIC_SUPABASE_URL` everywhere.
// During the identity-sprint scaffold these may all be unset; downstream
// code (getAlaskaTrip snapshot fallback, lazy auth surfaces) handles that.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function requireUrlAndAnon(): { url: string; anon: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in web/.env.local",
    );
  }
  return { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY };
}

export function requireServiceRole(): { url: string; service: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase service env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local",
    );
  }
  return { url: SUPABASE_URL, service: SUPABASE_SERVICE_ROLE_KEY };
}
