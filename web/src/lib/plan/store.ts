import type { DraftTrip } from "./types";

/**
 * In-memory store for draft trips. Pinned to `globalThis` so RSC and
 * Route Handlers share the same instance (same pattern as trips fixture).
 * Resets on server restart; swap for a persistent store when ready.
 */

type DraftStore = { drafts: Record<string, DraftTrip> };

const globalForDrafts = globalThis as unknown as { __draftStore?: DraftStore };
const store: DraftStore =
  globalForDrafts.__draftStore ??
  (globalForDrafts.__draftStore = { drafts: {} });

export const DRAFTS: Record<string, DraftTrip> = store.drafts;

/** 12-char URL-safe id. Good enough for anonymous session drafts. */
export function newDraftId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
