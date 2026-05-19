import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { DraftTrip } from "./types";

/**
 * Cookie-backed draft store. Replaces the legacy in-memory `DRAFTS`
 * map so anonymous wizard drafts survive across lambda hops on Vercel
 * (where each request can land on a different process with a fresh
 * `globalThis`).
 *
 * Layout: one cookie (`__plan_drafts`) holding `Record<id, DraftTrip>`
 * as JSON. Capped to MAX_DRAFTS (oldest by `createdAt` evicted first)
 * and at SAFE_BYTES of payload to stay well clear of the ~4KB
 * per-cookie limit even with cookie attributes.
 *
 * Reads work in any server context (RSC, Server Action, Route Handler).
 * Writes only work in Server Actions and Route Handlers — RSCs trying
 * to write will throw at the cookies().set() call. The wizard's only
 * RSC caller is the legacy `/plan` entry, which we've converted to a
 * Route Handler.
 */

const COOKIE_NAME = "__plan_drafts";
const MAX_DRAFTS = 5;
const SAFE_BYTES = 3500;
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE_S,
};

type DraftMap = Record<string, DraftTrip>;

export async function readDrafts(): Promise<DraftMap> {
  try {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DraftMap;
  } catch {
    return {};
  }
}

export async function writeDrafts(map: DraftMap): Promise<void> {
  const trimmed = capDrafts(map);
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(trimmed), COOKIE_OPTS);
}

/** Attach the draft-map cookie to an explicit `NextResponse`. Use this
 *  from Route Handlers that return `NextResponse.redirect(...)` —
 *  `cookies().set()` from `next/headers` does not transfer onto a
 *  manually-constructed NextResponse, so the cookie has to be set
 *  directly on the response object. */
export function writeDraftsToResponse(
  response: NextResponse,
  map: DraftMap,
): void {
  const trimmed = capDrafts(map);
  response.cookies.set(COOKIE_NAME, JSON.stringify(trimmed), COOKIE_OPTS);
}

/** Evict oldest drafts (by createdAt) until under MAX_DRAFTS and the
 *  serialized payload fits SAFE_BYTES. Mutates a copy. */
function capDrafts(map: DraftMap): DraftMap {
  const entries = Object.entries(map).sort(
    (a, b) => (b[1].createdAt ?? "").localeCompare(a[1].createdAt ?? ""),
  );
  const kept: DraftMap = {};
  for (const [id, draft] of entries) {
    if (Object.keys(kept).length >= MAX_DRAFTS) break;
    kept[id] = draft;
    if (JSON.stringify(kept).length > SAFE_BYTES) {
      delete kept[id];
      break;
    }
  }
  return kept;
}
