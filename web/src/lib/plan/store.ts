/** 12-char URL-safe id. Good enough for anonymous session drafts.
 *
 *  The legacy `DRAFTS` map (globalThis-backed) used to live here too,
 *  but it evaporated between Vercel lambda invocations and lost anon
 *  wizard state in production. Anon drafts now live in a cookie — see
 *  `cookie-store.ts`. */
export function newDraftId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
