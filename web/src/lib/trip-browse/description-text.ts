/**
 * Display-time sanitizer for `master_place.description` (and any description
 * derived from it — `Waypoint.description`, `BrowsePlace.description`,
 * `CorridorPlace.description`). Some source descriptions arrive with raw
 * HTML (BLM/USFS-style `<p>…</p>`, `<br/>`, `<h2>…`), and React escapes
 * text children so unstripped content renders literal angle brackets
 * on-screen.
 *
 * Block-level break tags (`<br>`, closing `</p>`, `</div>`, `</hN>`, `</li>`)
 * are converted to `\n` so callers that use `white-space: pre-line` (or
 * `whitespace-pre-line` in Tailwind) preserve paragraph structure. Callers
 * that clamp to N lines (`line-clamp-*`) can ignore this and the newlines
 * simply don't affect rendering past the clamp.
 */

const BLOCK_BREAK_RE =
  /<\s*br\s*\/?\s*>|<\s*\/\s*(?:p|div|h[1-6]|li|section|article|blockquote)\s*>/gi;

/** Strip HTML tags + decode common entities. Block breaks become `\n`. */
export function stripDescriptionHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(BLOCK_BREAK_RE, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, " ")
    // Collapse runs of spaces/tabs (but keep newlines).
    .replace(/[ \t]+/g, " ")
    // Collapse 3+ consecutive newlines to a double break (paragraph).
    .replace(/\n{3,}/g, "\n\n")
    // Trim trailing/leading whitespace around each newline pair.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}
